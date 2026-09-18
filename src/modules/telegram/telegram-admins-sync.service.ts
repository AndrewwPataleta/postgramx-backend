import type { QueryDeepPartialEntity } from '../../core/typeorm.types';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { ServiceError } from '../../core/service-error';
import { ChannelEntity } from '../channels/entities/channel.entity';
import {
  ChannelMembershipEntity,
  TelegramAdminStatus,
} from '../channels/entities/channel-membership.entity';
import {
  ChannelTelegramAdminEntity,
  TelegramAdminRole,
} from '../channels/entities/channel-telegram-admin.entity';
import { ChannelStatus } from '../channels/types/channel-status.enum';
import { ChannelRole } from '../channels/types/channel-role.enum';
import {
  TelegramChatErrorCode,
  TelegramChatMember,
  TelegramChatService,
  TelegramChatServiceError,
} from './telegram-chat.service';
import { TelegramMessengerService } from './telegram-messenger.service';
import { User } from '../auth/entities/user.entity';
import { TelegramI18nService } from './i18n/telegram-i18n.service';
import { ADVISORY_LOCKS, CRON, ENV } from '../../common/constants';
import { getEnvString } from '../../common/utils/env';

export enum TelegramAdminsSyncErrorCode {
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  BOT_FORBIDDEN = 'BOT_FORBIDDEN',
}

export class TelegramAdminsSyncError extends ServiceError<TelegramAdminsSyncErrorCode> {
  constructor(code: TelegramAdminsSyncErrorCode) {
    super(code);
  }
}

type TelegramAdminSnapshot = {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  telegramRole: TelegramAdminRole;
  permissionsSnapshot: Record<string, unknown> | null;
};

@Injectable()
export class TelegramAdminsSyncService {
  private readonly logger = new Logger(TelegramAdminsSyncService.name);

  constructor(
    private readonly telegramChatService: TelegramChatService,
    private readonly telegramMessengerService: TelegramMessengerService,
    private readonly telegramI18nService: TelegramI18nService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelTelegramAdminEntity)
    private readonly adminRepository: Repository<ChannelTelegramAdminEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  @Cron(getEnvString(ENV.TELEGRAM_ADMIN_SYNC_CRON, CRON.TELEGRAM_ADMIN_SYNC))
  async syncVerifiedChannelsByCron(): Promise<void> {
    const acquired = await this.tryAdvisoryLock(
      ADVISORY_LOCKS.TELEGRAM_ADMINS_SYNC,
    );
    if (!acquired) {
      return;
    }

    try {
      const batch = Number(
        this.configService.get('TELEGRAM_ADMIN_SYNC_BATCH') ?? 50,
      );
      const channels = await this.channelRepository.find({
        where: {
          status: ChannelStatus.VERIFIED,
          telegramChatId: Not(IsNull()),
          isDisabled: false,
        },
        order: { updatedAt: 'DESC' },
        take: Math.max(1, batch),
      });

      for (const channel of channels) {
        try {
          await this.syncChannelAdmins(channel.id);
        } catch (error) {
          this.logger.warn(
            `Failed channel admins sync for ${channel.id} - ${String(error)}`,
          );
        }
      }
    } finally {
      await this.releaseAdvisoryLock(ADVISORY_LOCKS.TELEGRAM_ADMINS_SYNC);
    }
  }

  async syncChannelAdmins(channelId: string): Promise<void> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel || !channel.telegramChatId) {
      throw new TelegramAdminsSyncError(
        TelegramAdminsSyncErrorCode.CHANNEL_NOT_FOUND,
      );
    }

    let admins: TelegramChatMember[];
    try {
      admins = await this.telegramChatService.getChatAdministrators(
        channel.telegramChatId,
      );
    } catch (error) {
      throw this.mapTelegramError(error);
    }

    const now = new Date();
    const mappedAdmins = admins
      .filter((admin) => !admin.user?.is_bot)
      .map((admin) => this.toSnapshot(admin));

    const activeDbAdmins = await this.adminRepository.find({
      where: { channelId: channel.id, isActive: true },
    });

    const dbById = new Map(
      activeDbAdmins.map((admin) => [String(admin.telegramUserId), admin]),
    );
    const tgById = new Map(
      mappedAdmins.map((admin) => [admin.telegramUserId, admin]),
    );

    const addedAdmins = mappedAdmins.filter(
      (admin) => !dbById.has(admin.telegramUserId),
    );
    const removedAdmins = activeDbAdmins.filter(
      (admin) => !tgById.has(String(admin.telegramUserId)),
    );

    const upserts = mappedAdmins.map((admin) => ({
      channelId: channel.id,
      telegramUserId: admin.telegramUserId,
      username: admin.username,
      firstName: admin.firstName,
      lastName: admin.lastName,
      isBot: false,
      telegramRole: admin.telegramRole,
      permissionsSnapshot: admin.permissionsSnapshot,
      isActive: true,
      lastSeenAt: now,
    }));

    await this.dataSource.transaction(async (manager) => {
      if (upserts.length > 0) {
        await manager
          .getRepository(ChannelTelegramAdminEntity)
          .upsert(upserts as QueryDeepPartialEntity<ChannelTelegramAdminEntity>[], ['channelId', 'telegramUserId']);
      }

      if (removedAdmins.length > 0) {
        await manager
          .createQueryBuilder()
          .update(ChannelTelegramAdminEntity)
          .set({ isActive: false })
          .where('channelId = :channelId', { channelId: channel.id })
          .andWhere('telegramUserId IN (:...removedIds)', {
            removedIds: removedAdmins.map((admin) => admin.telegramUserId),
          })
          .execute();
      }

      await this.updateMembershipsForSync(
        manager.getRepository(ChannelMembershipEntity),
        channel,
        addedAdmins,
        removedAdmins,
        now,
      );
    });

    if (addedAdmins.length > 0 || removedAdmins.length > 0) {
      await this.notifyOwnerAboutChanges(channel, addedAdmins, removedAdmins);
    }

    await this.notifyOwnerLostAdminRightsIfNeeded(channel, tgById, now);
  }

  private async updateMembershipsForSync(
    membershipRepo: Repository<ChannelMembershipEntity>,
    channel: ChannelEntity,
    addedAdmins: TelegramAdminSnapshot[],
    removedAdmins: ChannelTelegramAdminEntity[],
    now: Date,
  ): Promise<void> {
    const impactedTelegramUserIds = Array.from(
      new Set([
        ...addedAdmins.map((admin) => admin.telegramUserId),
        ...removedAdmins.map((admin) => String(admin.telegramUserId)),
      ]),
    );

    if (impactedTelegramUserIds.length === 0) {
      return;
    }

    const [memberships, linkedUsers] = await Promise.all([
      membershipRepo.find({
        where: {
          channelId: channel.id,
          telegramUserId: In(impactedTelegramUserIds),
        },
      }),
      this.userRepository.find({
        where: {
          telegramId: In(addedAdmins.map((admin) => admin.telegramUserId)),
        },
      }),
    ]);

    const membershipByTelegramId = new Map(
      memberships
        .filter((membership) => membership.telegramUserId)
        .map((membership) => [String(membership.telegramUserId), membership]),
    );
    const linkedUserByTelegramId = new Map(
      linkedUsers
        .filter((user) => Boolean(user.telegramId))
        .map((user) => [String(user.telegramId), user]),
    );

    const toSave: ChannelMembershipEntity[] = [];

    for (const removedAdmin of removedAdmins) {
      const membership = membershipByTelegramId.get(
        String(removedAdmin.telegramUserId),
      );
      if (!membership) {
        continue;
      }

      if (membership.role === ChannelRole.OWNER) {
        membership.telegramAdminStatus = null;
        membership.isActive = true;
        membership.lastRecheckAt = now;
        toSave.push(membership);
        continue;
      }

      membership.telegramAdminStatus = null;
      membership.canReviewDeals = false;
      membership.isActive = false;
      membership.lastRecheckAt = now;
      membership.permissionsUpdatedAt = now;
      toSave.push(membership);
    }

    for (const addedAdmin of addedAdmins) {
      const existing = membershipByTelegramId.get(addedAdmin.telegramUserId);

      if (!existing) {
        const linkedUser = linkedUserByTelegramId.get(
          addedAdmin.telegramUserId,
        );
        const created = membershipRepo.create({
          channelId: channel.id,
          userId: linkedUser?.id ?? null,
          role: ChannelRole.MODERATOR,
          telegramUserId: addedAdmin.telegramUserId,
          telegramAdminStatus:
            addedAdmin.telegramRole === TelegramAdminRole.CREATOR
              ? TelegramAdminStatus.CREATOR
              : TelegramAdminStatus.ADMINISTRATOR,
          permissionsSnapshot: addedAdmin.permissionsSnapshot,
          isActive: true,
          isManuallyDisabled: false,
          canReviewDeals: true,
          lastRecheckAt: now,
          permissionsUpdatedAt: now,
        });
        toSave.push(created);
        continue;
      }

      existing.telegramAdminStatus =
        addedAdmin.telegramRole === TelegramAdminRole.CREATOR
          ? TelegramAdminStatus.CREATOR
          : TelegramAdminStatus.ADMINISTRATOR;
      existing.permissionsSnapshot = addedAdmin.permissionsSnapshot;
      existing.lastRecheckAt = now;

      if (!existing.userId) {
        const linkedUser = linkedUserByTelegramId.get(
          addedAdmin.telegramUserId,
        );
        if (linkedUser) {
          existing.userId = linkedUser.id;
        }
      }

      if (!existing.isManuallyDisabled && existing.role !== ChannelRole.OWNER) {
        existing.isActive = true;
        existing.canReviewDeals = true;
        existing.permissionsUpdatedAt = now;
      }

      toSave.push(existing);
    }

    if (toSave.length > 0) {
      await membershipRepo.save(toSave);
    }
  }

  private async notifyOwnerAboutChanges(
    channel: ChannelEntity,
    addedAdmins: TelegramAdminSnapshot[],
    removedAdmins: ChannelTelegramAdminEntity[],
  ): Promise<void> {
    const owner = await this.userRepository.findOne({
      where: { id: channel.ownerUserId },
    });
    if (!owner?.telegramId) {
      return;
    }

    const lang =
      await this.telegramMessengerService.resolveLanguageForTelegramId(
        owner.telegramId,
      );
    const cta = this.telegramI18nService.t(
      lang,
      'telegram.moderators.changed.cta_manage',
    );

    const addedList = addedAdmins.length
      ? addedAdmins.map((admin) => this.renderAdminRow(admin)).join('\n')
      : '-';
    const removedList = removedAdmins.length
      ? removedAdmins
          .map((admin) =>
            this.renderAdminRow({
              telegramUserId: String(admin.telegramUserId),
              username: admin.username,
              firstName: admin.firstName,
              lastName: admin.lastName,
            }),
          )
          .join('\n')
      : '-';

    const changesSections: string[] = [];

    if (addedAdmins.length > 0) {
      const addedTitle = this.telegramI18nService.t(
        lang,
        'telegram.moderators.changed.added',
      );
      changesSections.push(`${addedTitle}\n${addedList}`);
    }

    if (removedAdmins.length > 0) {
      const removedTitle = this.telegramI18nService.t(
        lang,
        'telegram.moderators.changed.removed',
      );
      changesSections.push(`${removedTitle}\n${removedList}`);
    }

    await this.telegramMessengerService.sendText(
      owner.telegramId,
      'telegram.moderators.changed.title',
      {
        channelRef: this.buildChannelRef(channel),
        changes: changesSections.join('\n\n'),
        cta,
      },
      { lang },
    );
  }

  private async notifyOwnerLostAdminRightsIfNeeded(
    channel: ChannelEntity,
    tgById: Map<string, TelegramAdminSnapshot>,
    now: Date,
  ): Promise<void> {
    const owner = await this.userRepository.findOne({
      where: { id: channel.ownerUserId },
    });
    if (!owner?.telegramId) {
      return;
    }

    const ownerTelegramId = String(owner.telegramId);
    const hasOwnerRights = tgById.has(ownerTelegramId);
    if (hasOwnerRights) {
      return;
    }

    const ownerMembership = await this.membershipRepository.findOne({
      where: {
        channelId: channel.id,
        userId: owner.id,
        role: ChannelRole.OWNER,
      },
    });

    if (!ownerMembership || ownerMembership.telegramAdminStatus === null) {
      return;
    }

    ownerMembership.telegramAdminStatus = null;
    ownerMembership.isActive = true;
    ownerMembership.lastRecheckAt = now;
    await this.membershipRepository.save(ownerMembership);

    await this.telegramMessengerService.sendText(
      owner.telegramId,
      'telegram.moderators.owner_lost_rights',
      {
        channelRef: this.buildChannelRef(channel),
        miniAppUrl: this.telegramMessengerService.buildMiniAppUrl(),
      },
    );

    const adminAlertsChatId = this.configService.get<string>(
      'ADMIN_ALERTS_CHAT_ID',
    );
    if (adminAlertsChatId) {
      await this.telegramMessengerService.sendText(
        adminAlertsChatId,
        'telegram.moderators.owner_lost_rights_admin_alert',
        {
          channelRef: this.buildChannelRef(channel),
          ownerUserId: owner.id,
          telegramChatId: channel.telegramChatId,
        },
        { lang: 'en' },
      );
    }
  }

  private buildChannelRef(channel: ChannelEntity): string {
    return `@${channel.username} - ${channel.title}`;
  }

  private renderAdminRow(admin: {
    telegramUserId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  }): string {
    const name = [admin.firstName, admin.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const handle = admin.username
      ? `@${admin.username}`
      : name || `id:${admin.telegramUserId}`;
    return `- ${handle} - ${admin.telegramUserId}`;
  }

  private toSnapshot(admin: TelegramChatMember): TelegramAdminSnapshot {
    return {
      telegramUserId: String(admin.user?.id),
      username: admin.user?.username ?? null,
      firstName: admin.user?.first_name ?? null,
      lastName: admin.user?.last_name ?? null,
      telegramRole:
        admin.status === 'creator'
          ? TelegramAdminRole.CREATOR
          : TelegramAdminRole.ADMINISTRATOR,
      permissionsSnapshot: this.buildRightsSnapshot(admin),
    };
  }

  private mapTelegramError(error: unknown): TelegramAdminsSyncError | unknown {
    if (!(error instanceof TelegramChatServiceError)) {
      return error;
    }

    if (error.code === TelegramChatErrorCode.BOT_FORBIDDEN) {
      return new TelegramAdminsSyncError(
        TelegramAdminsSyncErrorCode.BOT_FORBIDDEN,
      );
    }

    if (error.code === TelegramChatErrorCode.CHANNEL_NOT_FOUND) {
      return new TelegramAdminsSyncError(
        TelegramAdminsSyncErrorCode.CHANNEL_NOT_FOUND,
      );
    }

    return new TelegramAdminsSyncError(
      TelegramAdminsSyncErrorCode.BOT_FORBIDDEN,
    );
  }

  private buildRightsSnapshot(admin: TelegramChatMember) {
    return {
      can_post_messages: admin.can_post_messages ?? false,
      can_edit_messages: admin.can_edit_messages ?? false,
      can_delete_messages: admin.can_delete_messages ?? false,
      can_invite_users: admin.can_invite_users ?? false,
      can_promote_members: admin.can_promote_members ?? false,
    };
  }

  private async tryAdvisoryLock(key: string): Promise<boolean> {
    const result = await this.dataSource.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) as locked',
      [key],
    );
    return Boolean(result?.[0]?.locked);
  }

  private async releaseAdvisoryLock(key: string): Promise<void> {
    await this.dataSource.query('SELECT pg_advisory_unlock(hashtext($1))', [
      key,
    ]);
  }
}

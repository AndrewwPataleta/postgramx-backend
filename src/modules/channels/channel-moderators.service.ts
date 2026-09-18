import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChannelEntity } from './entities/channel.entity';
import { ChannelMembershipEntity } from './entities/channel-membership.entity';
import { ChannelTelegramAdminEntity } from './entities/channel-telegram-admin.entity';
import { ChannelRole } from './types/channel-role.enum';
import { User } from '../auth/entities/user.entity';
import { ChannelAdminRecheckService } from './guards/channel-admin-recheck.service';
import { ChannelErrorCode } from './types/channel-error-code.enum';
import { ChannelServiceError } from './errors/channel-service.error';

export type ChannelModeratorItem = {
  userId: string | null;
  telegramUserId: string | null;
  role: ChannelRole.OWNER | ChannelRole.MODERATOR;
  isActive: boolean;
  isManuallyDisabled: boolean;
  canReviewDeals: boolean;
  telegramAdminStatus?: string | null;
  displayName: string;
  username?: string | null;
  avatar?: string | null;
  lastRecheckAt?: string | null;
};

@Injectable()
export class ChannelModeratorsService {
  constructor(
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
    @InjectRepository(ChannelTelegramAdminEntity)
    private readonly telegramAdminRepository: Repository<ChannelTelegramAdminEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly channelAdminRecheckService: ChannelAdminRecheckService,
  ) {}

  async listModerators(
    channelId: string,
    userId: string,
  ): Promise<{
    channel: {
      id: string;
      username: string;
      title: string;
      ownerUserId: string;
    };
    items: ChannelModeratorItem[];
  }> {
    await this.requireChannelOwner(channelId, userId, true);

    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found.');
    }

    const memberships = await this.membershipRepository.find({
      where: {
        channelId,
        role: ChannelRole.MODERATOR,
      },
      order: { updatedAt: 'DESC' },
    });

    const userIds = memberships
      .map((membership) => membership.userId)
      .filter((value): value is string => Boolean(value));
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds) } })
      : [];
    const userMap = new Map(users.map((user) => [user.id, user]));

    return {
      channel: {
        id: channel.id,
        username: channel.username,
        title: channel.title,
        ownerUserId: channel.ownerUserId,
      },
      items: memberships.map((membership) =>
        this.mapMembershipToModeratorItem(
          membership,
          membership.userId ? userMap.get(membership.userId) : undefined,
        ),
      ),
    };
  }

  async setReviewEnabled(
    channelId: string,
    userId: string,
    targetUserId: string,
    canReviewDeals: boolean,
  ): Promise<ChannelModeratorItem> {
    const membership = await this.membershipRepository.findOne({
      where: { channelId, userId: targetUserId },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found.');
    }

    return this.setReviewEnabledForMembership(
      channelId,
      userId,
      membership,
      canReviewDeals,
    );
  }

  async setReviewEnabledByTelegramUser(
    channelId: string,
    userId: string,
    telegramUserId: string,
    canReviewDeals: boolean,
  ): Promise<ChannelModeratorItem> {
    const membership = await this.membershipRepository.findOne({
      where: { channelId, telegramUserId },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found.');
    }

    return this.setReviewEnabledForMembership(
      channelId,
      userId,
      membership,
      canReviewDeals,
    );
  }

  async requireChannelOwner(
    channelId: string,
    userId: string,
    verifyTelegramRights = false,
  ): Promise<void> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found.');
    }

    if (channel.ownerUserId !== userId) {
      throw new ForbiddenException('Access denied.');
    }

    const membership = await this.membershipRepository.findOne({
      where: { channelId, userId, isActive: true, isManuallyDisabled: false },
    });

    if (!membership || membership.role !== ChannelRole.OWNER) {
      throw new ForbiddenException('Access denied.');
    }

    if (!verifyTelegramRights) {
      return;
    }

    const ownerUser = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!ownerUser?.telegramId) {
      throw new ChannelServiceError(ChannelErrorCode.NOT_ADMIN_ANYMORE);
    }

    await this.channelAdminRecheckService.requireChannelRights({
      channelId,
      userId,
      telegramId: Number(ownerUser.telegramId),
      required: { anyAdmin: true, allowManager: false },
    });
  }

  async requireCanReviewDeals(
    channelId: string,
    userId: string,
    telegramUserId?: string | number | null,
  ): Promise<void> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });
    if (!channel) {
      throw new ChannelServiceError(ChannelErrorCode.CHANNEL_NOT_FOUND);
    }

    const membership = await this.membershipRepository.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      if (channel.ownerUserId === userId) {
        await this.requireOwnerCanReviewDealsWithoutMembership(
          channelId,
          userId,
          telegramUserId,
        );
        return;
      }

      throw new ChannelServiceError(ChannelErrorCode.USER_NOT_MEMBER);
    }

    if (membership.isManuallyDisabled) {
      throw new ChannelServiceError(ChannelErrorCode.MEMBERSHIP_DISABLED);
    }

    if (!membership.isActive) {
      throw new ChannelServiceError(ChannelErrorCode.MEMBERSHIP_INACTIVE);
    }

    if (![ChannelRole.OWNER, ChannelRole.MODERATOR].includes(membership.role)) {
      throw new ChannelServiceError(ChannelErrorCode.USER_NOT_ADMIN);
    }

    if (
      membership.role === ChannelRole.MODERATOR &&
      !membership.canReviewDeals
    ) {
      throw new ChannelServiceError(ChannelErrorCode.USER_NOT_ADMIN);
    }

    const resolvedTelegramUserId =
      telegramUserId ?? membership.telegramUserId ?? null;
    if (!resolvedTelegramUserId) {
      throw new ChannelServiceError(ChannelErrorCode.NOT_ADMIN_ANYMORE);
    }

    await this.channelAdminRecheckService.requireChannelRights({
      channelId,
      userId,
      telegramId: Number(resolvedTelegramUserId),
      required: { anyAdmin: true, allowManager: true },
    });
  }

  private async requireOwnerCanReviewDealsWithoutMembership(
    channelId: string,
    userId: string,
    telegramUserId?: string | number | null,
  ): Promise<void> {
    const ownerUser = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'telegramId'],
    });

    const resolvedTelegramUserId =
      telegramUserId ?? ownerUser?.telegramId ?? null;
    if (!resolvedTelegramUserId) {
      throw new ChannelServiceError(ChannelErrorCode.NOT_ADMIN_ANYMORE);
    }

    await this.channelAdminRecheckService.requireChannelRights({
      channelId,
      userId,
      telegramId: Number(resolvedTelegramUserId),
      required: { anyAdmin: true, allowManager: true },
    });

    await this.membershipRepository.save(
      this.membershipRepository.create({
        channelId,
        userId,
        role: ChannelRole.OWNER,
        isActive: true,
        isManuallyDisabled: false,
        canReviewDeals: true,
        telegramUserId: String(resolvedTelegramUserId),
      }),
    );
  }

  private async setReviewEnabledForMembership(
    channelId: string,
    userId: string,
    membership: ChannelMembershipEntity,
    canReviewDeals: boolean,
  ): Promise<ChannelModeratorItem> {
    await this.requireChannelOwner(channelId, userId, true);

    if (membership.role === ChannelRole.OWNER) {
      throw new BadRequestException(
        'Owner review permission cannot be changed.',
      );
    }

    if (
      !membership.isActive ||
      !membership.telegramAdminStatus ||
      !membership.telegramUserId
    ) {
      throw new ChannelServiceError(ChannelErrorCode.MODERATOR_NOT_ADMIN);
    }

    const activeTelegramAdmin = await this.telegramAdminRepository.findOne({
      where: {
        channelId,
        telegramUserId: membership.telegramUserId,
        isActive: true,
      },
    });
    if (!activeTelegramAdmin) {
      throw new ChannelServiceError(ChannelErrorCode.MODERATOR_NOT_ADMIN);
    }

    membership.canReviewDeals = canReviewDeals;
    membership.permissionsUpdatedAt = new Date();

    const saved = await this.membershipRepository.save(membership);

    const user = saved.userId
      ? await this.userRepository.findOne({ where: { id: saved.userId } })
      : null;

    return this.mapMembershipToModeratorItem(saved, user ?? undefined);
  }

  private mapMembershipToModeratorItem(
    membership: ChannelMembershipEntity,
    user?: User,
  ): ChannelModeratorItem {
    return {
      userId: membership.userId,
      telegramUserId: membership.telegramUserId,
      role: membership.role as ChannelRole.OWNER | ChannelRole.MODERATOR,
      isActive: membership.isActive,
      isManuallyDisabled: membership.isManuallyDisabled,
      canReviewDeals: membership.canReviewDeals,
      telegramAdminStatus: membership.telegramAdminStatus ?? null,
      displayName: this.resolveDisplayName(membership, user),
      username: user?.username ?? null,
      avatar: user?.avatar ?? null,
      lastRecheckAt: membership.lastRecheckAt
        ? membership.lastRecheckAt.toISOString()
        : null,
    };
  }

  private resolveDisplayName(
    membership: ChannelMembershipEntity,
    user?: User,
  ): string {
    if (user) {
      const fullName = [user.firstName, user.lastName]
        .filter((value) => Boolean(value))
        .join(' ')
        .trim();
      if (fullName) {
        return fullName;
      }
      if (user.username) {
        return user.username;
      }
    }

    if (membership.telegramUserId) {
      return `Telegram ${membership.telegramUserId}`;
    }

    return 'Unknown';
  }
}

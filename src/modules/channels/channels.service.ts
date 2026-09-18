import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelEntity } from './entities/channel.entity';
import {
  ChannelMembershipEntity,
  TelegramAdminStatus,
} from './entities/channel-membership.entity';
import { ChannelStatus } from './types/channel-status.enum';
import { ChannelRole } from './types/channel-role.enum';
import { ChannelErrorCode } from './types/channel-error-code.enum';
import { ListChannelsFilters } from './dto/list-channels.dto';
import { ChannelServiceError } from './errors/channel-service.error';
import {
  ChannelDetails,
  ChannelDisabledResult,
  ChannelListResponse,
  ChannelPreview,
  ChannelUnlinkResult,
  ChannelVerifyResult,
} from './types/channel-service.types';
import {
  TelegramChatService,
  TelegramChatServiceError,
  TelegramChatErrorCode,
  TelegramChatFullInfo,
  TelegramChatMember,
} from '../telegram/telegram-chat.service';
import { ChannelTelegramAdminEntity } from './entities/channel-telegram-admin.entity';
import {
  TelegramAdminsSyncService,
  TelegramAdminsSyncError,
  TelegramAdminsSyncErrorCode,
} from '../telegram/telegram-admins-sync.service';
import { ChannelAdminRecheckService } from './guards/channel-admin-recheck.service';
import { ListingEntity } from '../listings/entities/listing.entity';
import {
  ListingListItem,
  mapListingToListItem,
} from '../listings/types/listing-list-item.type';
import { buildChannelPreview } from '../listings/utils/channel-preview';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
    @InjectRepository(ChannelTelegramAdminEntity)
    private readonly telegramAdminRepository: Repository<ChannelTelegramAdminEntity>,
    @InjectRepository(ListingEntity)
    private readonly listingRepository: Repository<ListingEntity>,
    private readonly telegramChatService: TelegramChatService,
    private readonly telegramAdminsSyncService: TelegramAdminsSyncService,
    private readonly channelAdminRecheckService: ChannelAdminRecheckService,
  ) {}

  async previewChannel(usernameOrLink: string): Promise<ChannelPreview> {
    try {
      const normalizedUsername =
        this.telegramChatService.normalizeUsernameOrLink(usernameOrLink);
      const chat =
        await this.telegramChatService.getChatByUsername(normalizedUsername);
      const publicChat = this.telegramChatService.assertPublicChannel(chat);
      const chatUpdate = await this.mapTelegramChatToChannelUpdate(publicChat);

      return {
        normalizedUsername,
        title: publicChat.title ?? normalizedUsername,
        username: publicChat.username ?? normalizedUsername,
        telegramChatId: publicChat.id ?? null,
        type: 'channel',
        isPublic: true,
        nextStep: 'ADD_BOT_AS_ADMIN',
        subscribers: chatUpdate.subscribersCount,
        avatarUrl: chatUpdate.avatarUrl,
        description: publicChat.description ?? null,
      };
    } catch (error) {
      this.throwMappedError(error);
    }
  }

  async verifyChannel(
    username: string,
    userId: string,
    telegramUserId?: string | null,
  ): Promise<ChannelVerifyResult> {
    if (!telegramUserId) {
      throw new ChannelServiceError(ChannelErrorCode.NOT_ADMIN);
    }

    let normalizedUsername = username;
    try {
      normalizedUsername =
        this.telegramChatService.normalizeUsernameOrLink(username);
    } catch (error) {
      this.throwMappedError(error);
    }

    const existingChannel = await this.channelRepository.findOne({
      where: { username: normalizedUsername },
    });

    if (
      existingChannel?.ownerUserId === userId &&
      existingChannel.status === ChannelStatus.VERIFIED
    ) {
      throw new ChannelServiceError(ChannelErrorCode.CHANNEL_ALREADY_LINKED);
    }

    const preflight = await this.preflightVerify(
      normalizedUsername,
      telegramUserId,
    );
    const permissionsSnapshot = {
      user: this.buildAdminSnapshot(preflight.userAdmin),
      bot: this.buildAdminSnapshot(preflight.botAdmin),
    };
    const now = new Date();
    const telegramChatId = String(preflight.publicChat.id);

    const channel = await this.channelRepository.manager.transaction(
      async (manager) => {
        const channelRepository = manager.getRepository(ChannelEntity);
        const membershipRepository = manager.getRepository(
          ChannelMembershipEntity,
        );

        let channel = await channelRepository.findOne({
          where: { telegramChatId },
        });

        if (!channel) {
          channel = await channelRepository.findOne({
            where: { username: normalizedUsername },
          });
        }

        if (channel) {
          if (channel.ownerUserId && channel.ownerUserId !== userId) {
            throw new ChannelServiceError(ChannelErrorCode.USER_NOT_CREATOR);
          }
        } else {
          channel = channelRepository.create({
            username: normalizedUsername,
            title: normalizedUsername,
            createdByUserId: userId,
            ownerUserId: userId,
          });
        }

        channel.username = normalizedUsername;
        channel.title = preflight.publicChat.title ?? channel.title;
        channel.telegramChatId = telegramChatId;
        channel.status = ChannelStatus.VERIFIED;
        channel.verifiedAt = now;
        channel.lastCheckedAt = now;
        if (!channel.ownerUserId) {
          channel.ownerUserId = userId;
        }
        const chatUpdate = await this.mapTelegramChatToChannelUpdate(
          preflight.publicChat,
        );
        if (chatUpdate.subscribersCount !== null) {
          channel.subscribersCount = chatUpdate.subscribersCount;
        }
        if (chatUpdate.avatarUrl) {
          channel.avatarUrl = chatUpdate.avatarUrl;
        }

        channel = await channelRepository.save(channel);

        await this.upsertMembership(
          channel.id,
          userId,
          ChannelRole.OWNER,
          preflight.userAdmin,
          permissionsSnapshot,
          membershipRepository,
        );

        return channel;
      },
    );

    let adminsSync: 'ok' | 'failed' | undefined;
    try {
      await this.telegramAdminsSyncService.syncChannelAdmins(channel.id);
      adminsSync = 'ok';
    } catch (error) {
      adminsSync = 'failed';
      this.logger.warn(
        `Failed to sync Telegram admins for channel ${channel.id}: ${String(
          error,
        )}`,
      );
    }

    return {
      channelId: channel.id,
      status: channel.status,
      role: ChannelRole.OWNER,
      verifiedAt: channel.verifiedAt?.toISOString(),
      permissions: permissionsSnapshot,
      adminsSync,
    };
  }

  async listForUser(
    userId: string,
    filters: ListChannelsFilters,
  ): Promise<ChannelListResponse> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 50);
    const offset = (page - 1) * limit;
    const sort = filters.sort ?? 'recent';
    const order = filters.order ?? 'desc';

    const query = this.channelRepository
      .createQueryBuilder('channel')
      .innerJoinAndMapOne(
        'channel.membership',
        ChannelMembershipEntity,
        'membership',
        'membership.channelId = channel.id AND membership.userId = :userId AND membership.isActive = true AND membership.isManuallyDisabled = false',
        { userId },
      )
      .select([
        'channel.id',
        'channel.username',
        'channel.title',
        'channel.status',
        'channel.telegramChatId',
        'channel.avatarUrl',
        'channel.subscribersCount',
        'channel.avgViews',
        'channel.isDisabled',
        'channel.verifiedAt',
        'channel.lastCheckedAt',
        'channel.updatedAt',
      ])
      .addSelect([
        'membership.role',
        'membership.telegramAdminStatus',
        'membership.lastRecheckAt',
      ]);

    if (filters.role) {
      query.andWhere('membership.role = :role', { role: filters.role });
    }

    if (filters.status) {
      query.andWhere('channel.status = :status', {
        status: filters.status,
      });
    }

    if (filters.verifiedOnly) {
      query.andWhere('channel.status = :verifiedStatus', {
        verifiedStatus: ChannelStatus.VERIFIED,
      });
    }

    if (!filters.includeDisabled) {
      query.andWhere('channel.isDisabled = :isDisabled', {
        isDisabled: false,
      });
    }

    if (filters.username) {
      query.andWhere('channel.username = :username', {
        username: filters.username,
      });
    }

    if (filters.q) {
      query.andWhere(
        '(channel.title ILIKE :query OR channel.username ILIKE :query)',
        { query: `%${filters.q}%` },
      );
    }

    switch (sort) {
      case 'title':
        query.orderBy('channel.title', order.toUpperCase() as 'ASC' | 'DESC');
        query.addOrderBy('channel.id', 'DESC');
        break;
      case 'subscribers':
        query.orderBy('channel.subscribersCount', 'DESC', 'NULLS LAST');
        query.addOrderBy('channel.id', 'DESC');
        break;
      case 'recent':
      default:
        query.orderBy('channel.updatedAt', 'DESC');
        query.addOrderBy('channel.id', 'DESC');
        break;
    }

    query.skip(offset).take(limit);

    const [channels, total] = await query.getManyAndCount();

    const items = channels.map((channel) => {
      const membership = (
        channel as ChannelEntity & {
          membership: ChannelMembershipEntity;
        }
      ).membership;

      return {
        id: channel.id,
        username: channel.username,
        title: channel.title,
        status: channel.status,
        telegramChatId: channel.telegramChatId,
        avatarUrl: channel.avatarUrl,
        subscribers: channel.subscribersCount,
        avgViews: channel.avgViews,
        isDisabled: channel.isDisabled,
        verifiedAt: channel.verifiedAt,
        lastCheckedAt: channel.lastCheckedAt,
        membership: {
          role: membership.role,
          telegramAdminStatus: membership.telegramAdminStatus,
          lastRecheckAt: membership.lastRecheckAt,
        },
        preview: {
          listingCount: 0,
          subsCount: channel.subscribersCount ?? null,
          listingFrom: null as string | null,
        },
      };
    });

    if (items.length > 0) {
      const channelIds = items.map((item) => item.id);
      const previews = await buildChannelPreview(
        this.listingRepository,
        channelIds,
        'owner',
      );

      for (const item of items) {
        const preview = previews.get(item.id);
        item.preview.listingCount = preview?.listingCount ?? 0;
        item.preview.listingFrom = preview?.listingFrom ?? null;
      }
    }

    if (filters.includeListings && items.length > 0) {
      await this.attachListingsToChannels(items, {
        onlyActive: true,
        limitPerChannel: 3,
      });
    }

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return {
      items,
      page,
      limit,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    };
  }

  async getForUser(
    userId: string,
    channelId: string,
    includeListings?: boolean,
  ): Promise<ChannelDetails> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found.');
    }

    const membership = await this.membershipRepository.findOne({
      where: { channelId, userId, isActive: true, isManuallyDisabled: false },
    });

    if (!membership) {
      throw new ForbiddenException('Access denied.');
    }

    const details: ChannelDetails = {
      id: channel.id,
      username: channel.username,
      title: channel.title,
      status: channel.status,
      telegramChatId: channel.telegramChatId,
      avatarUrl: channel.avatarUrl,
      subscribers: channel.subscribersCount,
      avgViews: channel.avgViews,
      isDisabled: channel.isDisabled,
      verifiedAt: channel.verifiedAt,
      lastCheckedAt: channel.lastCheckedAt,
      languageStats: channel.languageStats,
      membership: {
        role: membership.role,
        telegramAdminStatus: membership.telegramAdminStatus,
        lastRecheckAt: membership.lastRecheckAt,
      },
    };

    if (includeListings) {
      const listings = await this.listingRepository.find({
        where: { channelId, isActive: true },
        order: { createdAt: 'DESC' },
      });
      details.listings = listings.map(mapListingToListItem);
    }

    return details;
  }

  async listChannelAdmins(
    channelId: string,
    userId: string,
    telegramUserId: string | number,
  ) {
    await this.channelAdminRecheckService.requireChannelRights({
      channelId,
      userId,
      telegramId: Number(telegramUserId),
      required: { anyAdmin: true, allowManager: true },
    });

    const admins = await this.telegramAdminRepository.find({
      where: { channelId },
      order: { lastSeenAt: 'DESC' },
    });

    return {
      items: admins.map((admin) => ({
        telegramUserId: admin.telegramUserId,
        username: admin.username,
        firstName: admin.firstName,
        lastName: admin.lastName,
        telegramRole: admin.telegramRole,
        isActive: admin.isActive,
        permissionsSnapshot: admin.permissionsSnapshot,
        lastSeenAt: admin.lastSeenAt,
      })),
    };
  }

  async syncChannelAdminsForUser(
    channelId: string,
    userId: string,
    telegramUserId: string | number,
  ) {
    await this.channelAdminRecheckService.requireChannelRights({
      channelId,
      userId,
      telegramId: Number(telegramUserId),
      required: {
        anyAdmin: true,
        rights: ['can_promote_members'],
        allowManager: true,
      },
    });

    await this.telegramAdminsSyncService.syncChannelAdmins(channelId);
    return { ok: true };
  }

  async updateDisabledStatus(
    userId: string,
    channelId: string,
    disabled: boolean,
  ): Promise<ChannelDisabledResult> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found.');
    }

    const membership = await this.membershipRepository.findOne({
      where: { channelId, userId, isActive: true },
    });

    if (!membership) {
      throw new ForbiddenException('Access denied.');
    }

    if (![ChannelRole.OWNER, ChannelRole.MODERATOR].includes(membership.role)) {
      throw new ForbiddenException('Access denied.');
    }

    channel.isDisabled = disabled;
    await this.channelRepository.save(channel);

    return { channelId: channel.id, isDisabled: channel.isDisabled };
  }

  async unlinkChannel(
    channelId: string,
    userId: string,
  ): Promise<ChannelUnlinkResult> {
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
      throw new ChannelServiceError(ChannelErrorCode.USER_NOT_MEMBER);
    }

    membership.isActive = false;
    membership.isManuallyDisabled = true;
    membership.lastRecheckAt = new Date();

    await this.membershipRepository.save(membership);

    return { channelId: channel.id, unlinked: true };
  }

  private findUserAdmin(
    admins: TelegramChatMember[],
    telegramUserId?: string | null,
  ): TelegramChatMember {
    const numericId = telegramUserId ? Number(telegramUserId) : NaN;
    const userAdmin = admins.find((admin) => admin.user?.id === numericId);

    if (!userAdmin) {
      throw new ChannelServiceError(ChannelErrorCode.NOT_ADMIN);
    }

    if (userAdmin.status !== 'creator') {
      throw new ChannelServiceError(ChannelErrorCode.USER_NOT_CREATOR);
    }

    return userAdmin;
  }

  private async preflightVerify(
    normalizedUsername: string,
    telegramUserId: string,
  ): Promise<{
    publicChat: TelegramChatFullInfo;
    userAdmin: TelegramChatMember;
    botAdmin: TelegramChatMember;
  }> {
    try {
      const chat =
        await this.telegramChatService.getChatByUsername(normalizedUsername);
      const publicChat = this.telegramChatService.assertPublicChannel(chat);
      const admins =
        await this.telegramChatService.getChatAdministratorsByUsername(
          normalizedUsername,
        );
      const userAdmin = this.findUserAdmin(admins, telegramUserId);
      const { botAdmin } =
        await this.telegramChatService.extractBotAdmin(admins);
      return { publicChat, userAdmin, botAdmin };
    } catch (error) {
      this.throwMappedError(error);
    }
  }

  private buildAdminSnapshot(admin: TelegramChatMember) {
    return {
      status: admin.status,
      can_post_messages: admin.can_post_messages ?? false,
      can_edit_messages: admin.can_edit_messages ?? false,
      can_delete_messages: admin.can_delete_messages ?? false,
      can_manage_chat: admin.can_manage_chat ?? false,
      can_manage_video_chats: admin.can_manage_video_chats ?? false,
      can_change_info: admin.can_change_info ?? false,
      can_invite_users: admin.can_invite_users ?? false,
      can_pin_messages: admin.can_pin_messages ?? false,
      can_promote_members: admin.can_promote_members ?? false,
    };
  }

  private async upsertMembership(
    channelId: string,
    userId: string,
    role: ChannelRole,
    userAdmin?: TelegramChatMember,
    permissionsSnapshot?: Record<string, unknown>,
    membershipRepository: Repository<ChannelMembershipEntity> = this
      .membershipRepository,
  ) {
    let membership = await membershipRepository.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      membership = membershipRepository.create({
        channelId,
        userId,
        role,
        canReviewDeals: true,
        telegramUserId: userAdmin?.user?.id ? String(userAdmin.user.id) : null,
      });
    }

    membership.role = role;
    if (!membership.isManuallyDisabled) {
      membership.isActive = true;
    }
    membership.lastRecheckAt = new Date();

    if (userAdmin) {
      membership.telegramUserId = userAdmin.user?.id
        ? String(userAdmin.user.id)
        : membership.telegramUserId;
      membership.telegramAdminStatus =
        userAdmin.status === 'creator'
          ? TelegramAdminStatus.CREATOR
          : TelegramAdminStatus.ADMINISTRATOR;
    }

    if (permissionsSnapshot) {
      membership.permissionsSnapshot = permissionsSnapshot;
    }

    await membershipRepository.save(membership);
  }

  private normalizeSubscribersCount(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    if (value < 0) {
      return null;
    }

    return Math.trunc(value);
  }

  private async mapTelegramChatToChannelUpdate(
    chat: TelegramChatFullInfo,
  ): Promise<{ subscribersCount: number | null; avatarUrl: string | null }> {
    let subscribersCount = this.normalizeSubscribersCount(chat.members_count);

    if (subscribersCount === null) {
      const memberCount = await this.telegramChatService.getChatMemberCount(
        chat.username ?? chat.id,
      );
      subscribersCount = this.normalizeSubscribersCount(memberCount);
    }

    let avatarUrl: string | null = null;
    if (chat.photo?.big_file_id) {
      const file = await this.telegramChatService.getFile(
        chat.photo.big_file_id,
      );
      if (file.file_path) {
        avatarUrl = this.telegramChatService.buildFileUrl(file.file_path);
      }
    }

    return { subscribersCount, avatarUrl };
  }

  private mapError(error: unknown): ChannelServiceError | null {
    if (error instanceof ChannelServiceError) {
      return error;
    }

    if (error instanceof TelegramChatServiceError) {
      return this.mapTelegramError(error);
    }

    if (error instanceof TelegramAdminsSyncError) {
      return this.mapTelegramAdminsSyncError(error);
    }

    return null;
  }

  private throwMappedError(error: unknown): never {
    const mapped = this.mapError(error);
    if (mapped) {
      throw mapped;
    }
    throw error;
  }

  private mapTelegramError(
    error: TelegramChatServiceError,
  ): ChannelServiceError {
    const mapping: Record<TelegramChatErrorCode, ChannelErrorCode> = {
      [TelegramChatErrorCode.CHANNEL_NOT_FOUND]:
        ChannelErrorCode.CHANNEL_NOT_FOUND,
      [TelegramChatErrorCode.BOT_FORBIDDEN]: ChannelErrorCode.BOT_FORBIDDEN,
      [TelegramChatErrorCode.NOT_A_CHANNEL]: ChannelErrorCode.NOT_A_CHANNEL,
      [TelegramChatErrorCode.CHANNEL_PRIVATE_OR_NO_USERNAME]:
        ChannelErrorCode.CHANNEL_PRIVATE_OR_NO_USERNAME,
      [TelegramChatErrorCode.BOT_NOT_ADMIN]: ChannelErrorCode.BOT_NOT_ADMIN,
      [TelegramChatErrorCode.BOT_MISSING_RIGHTS]:
        ChannelErrorCode.BOT_MISSING_RIGHTS,
      [TelegramChatErrorCode.INVALID_USERNAME]:
        ChannelErrorCode.INVALID_USERNAME,
    };

    const code = mapping[error.code] ?? ChannelErrorCode.CHANNEL_NOT_FOUND;
    return new ChannelServiceError(code);
  }

  private mapTelegramAdminsSyncError(
    error: TelegramAdminsSyncError,
  ): ChannelServiceError {
    const mapping: Record<TelegramAdminsSyncErrorCode, ChannelErrorCode> = {
      [TelegramAdminsSyncErrorCode.BOT_FORBIDDEN]:
        ChannelErrorCode.BOT_FORBIDDEN,
      [TelegramAdminsSyncErrorCode.CHANNEL_NOT_FOUND]:
        ChannelErrorCode.CHANNEL_NOT_FOUND,
    };

    const code = mapping[error.code] ?? ChannelErrorCode.BOT_FORBIDDEN;
    return new ChannelServiceError(code);
  }

  private async attachListingsToChannels(
    items: ChannelDetails[] | ChannelListResponse['items'],
    options: { onlyActive: boolean; limitPerChannel?: number },
  ): Promise<void> {
    const channelIds = items.map((item) => item.id);
    if (channelIds.length === 0) {
      return;
    }

    const query = this.listingRepository
      .createQueryBuilder('listing')
      .where('listing.channelId IN (:...channelIds)', { channelIds });

    if (options.onlyActive) {
      query.andWhere('listing.isActive = :isActive', { isActive: true });
    }

    query.orderBy('listing.channelId', 'ASC');
    query.addOrderBy('listing.createdAt', 'DESC');

    const listings = await query.getMany();

    const grouped = new Map<string, ListingListItem[]>();
    for (const listing of listings) {
      const list = grouped.get(listing.channelId) ?? [];
      const limit = options.limitPerChannel ?? Number.POSITIVE_INFINITY;
      if (list.length >= limit) {
        continue;
      }
      list.push(mapListingToListItem(listing));
      grouped.set(listing.channelId, list);
    }

    for (const item of items) {
      item.listings = grouped.get(item.id) ?? [];
    }
  }
}

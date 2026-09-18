import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelEntity } from '../entities/channel.entity';
import {
  ChannelMembershipEntity,
  TelegramAdminStatus,
} from '../entities/channel-membership.entity';
import { ChannelServiceError } from '../errors/channel-service.error';
import { ChannelErrorCode } from '../types/channel-error-code.enum';
import { ChannelRole } from '../types/channel-role.enum';
import {
  TelegramChatMember,
  TelegramChatService,
} from '../../telegram/telegram-chat.service';

export type ChannelAdminRight =
  | 'can_post_messages'
  | 'can_edit_messages'
  | 'can_promote_members';

interface ChannelRightsRequest {
  channelId: string;
  userId: string;
  telegramId: number;
  required: {
    mustBeCreator?: boolean;
    anyAdmin?: boolean;
    rights?: ChannelAdminRight[];
    allowManager?: boolean;
  };
}

@Injectable()
export class ChannelAdminRecheckService {
  constructor(
    private readonly telegramChatService: TelegramChatService,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
  ) {}

  async requireChannelRights({
    channelId,
    userId,
    telegramId,
    required,
  }: ChannelRightsRequest): Promise<void> {
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

    if (membership.isManuallyDisabled) {
      throw new ChannelServiceError(ChannelErrorCode.MEMBERSHIP_DISABLED);
    }

    if (!membership.isActive) {
      throw new ChannelServiceError(ChannelErrorCode.MEMBERSHIP_INACTIVE);
    }

    if (!required.allowManager && membership.role !== ChannelRole.OWNER) {
      throw new ChannelServiceError(ChannelErrorCode.USER_NOT_ADMIN);
    }

    const chatId = channel.telegramChatId ?? channel.username;
    const admins = await this.telegramChatService.getChatAdministrators(chatId);
    let admin: TelegramChatMember;
    try {
      admin = this.findTelegramAdmin(admins, telegramId);
    } catch (error) {
      if (error instanceof ChannelServiceError) {
        if (membership.role !== ChannelRole.OWNER) {
          membership.isActive = false;
          membership.canReviewDeals = false;
          membership.telegramAdminStatus = null;
        }
        membership.lastRecheckAt = new Date();
        await this.membershipRepository.save(membership);
      }
      throw error;
    }

    if (required.mustBeCreator && admin.status !== 'creator') {
      throw new ChannelServiceError(ChannelErrorCode.USER_NOT_CREATOR);
    }

    if (
      required.rights &&
      required.rights.length > 0 &&
      admin.status !== 'creator'
    ) {
      const hasAllRights = required.rights.every((right) => admin[right]);
      if (!hasAllRights) {
        throw new ChannelServiceError(ChannelErrorCode.MISSING_RIGHTS);
      }
    }

    membership.lastRecheckAt = new Date();
    membership.telegramAdminStatus =
      admin.status === 'creator'
        ? TelegramAdminStatus.CREATOR
        : TelegramAdminStatus.ADMINISTRATOR;

    await this.membershipRepository.save(membership);
  }

  private findTelegramAdmin(
    admins: TelegramChatMember[],
    telegramId: number,
  ): TelegramChatMember {
    const admin = admins.find((item) => item.user?.id === telegramId);

    if (!admin || !['creator', 'administrator'].includes(admin.status)) {
      throw new ChannelServiceError(ChannelErrorCode.NOT_ADMIN_ANYMORE);
    }

    return admin;
  }
}

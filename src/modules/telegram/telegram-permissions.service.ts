import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelEntity } from '../channels/entities/channel.entity';
import { ChannelMembershipEntity } from '../channels/entities/channel-membership.entity';
import { ChannelRole } from '../channels/types/channel-role.enum';
import { User } from '../auth/entities/user.entity';
import {
  TelegramChatMember,
  TelegramChatService,
} from './telegram-chat.service';

@Injectable()
export class TelegramPermissionsService {
  constructor(
    private readonly telegramChatService: TelegramChatService,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async checkBotIsAdmin(
    channelId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });
    if (!channel) {
      return { ok: false, reason: 'CHANNEL_NOT_FOUND' };
    }

    const chatId = channel.telegramChatId ?? channel.username;
    if (!chatId) {
      return { ok: false, reason: 'CHANNEL_MISSING_CHAT_ID' };
    }

    try {
      const admins =
        await this.telegramChatService.getChatAdministrators(chatId);
      await this.telegramChatService.extractBotAdmin(admins);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkUserIsAdmin(
    publisherUserId: string,
    channelId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const [channel, membership, user] = await Promise.all([
      this.channelRepository.findOne({ where: { id: channelId } }),
      this.membershipRepository.findOne({
        where: { channelId, userId: publisherUserId, isActive: true },
      }),
      this.userRepository.findOne({ where: { id: publisherUserId } }),
    ]);

    if (!channel || !membership || !user?.telegramId) {
      return { ok: false, reason: 'USER_NOT_ADMIN' };
    }

    if (![ChannelRole.OWNER, ChannelRole.MODERATOR].includes(membership.role)) {
      return { ok: false, reason: 'USER_NOT_ADMIN' };
    }

    const chatId = channel.telegramChatId ?? channel.username;
    if (!chatId) {
      return { ok: false, reason: 'CHANNEL_MISSING_CHAT_ID' };
    }

    try {
      const admins =
        await this.telegramChatService.getChatAdministrators(chatId);
      const admin = this.findTelegramAdmin(admins, Number(user.telegramId));
      return { ok: Boolean(admin) };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private findTelegramAdmin(
    admins: TelegramChatMember[],
    telegramId: number,
  ): TelegramChatMember | null {
    const admin = admins.find((item) => item.user?.id === telegramId);
    if (!admin || !['creator', 'administrator'].includes(admin.status)) {
      return null;
    }
    return admin;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import {
  TelegramChatService,
  TelegramChatServiceError,
} from '../../telegram/telegram-chat.service';

@Injectable()
export class MTProtoStatsService {
  private readonly logger = new Logger(MTProtoStatsService.name);

  constructor(private readonly telegramChatService: TelegramChatService) {}

  async getChannelMembersCountByUsername(
    username: string,
  ): Promise<number | null> {
    try {
      return await this.telegramChatService.getChatMemberCount(username);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to fetch members count for @${username}: ${message}`,
      );
      if (error instanceof TelegramChatServiceError) {
        return null;
      }
      return null;
    }
  }

  async resolveUsernameToChatId(username: string): Promise<string | null> {
    try {
      const chat = await this.telegramChatService.getChatByUsername(username);
      return String(chat.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to resolve @${username} to chat id: ${message}`);
      return null;
    }
  }
}

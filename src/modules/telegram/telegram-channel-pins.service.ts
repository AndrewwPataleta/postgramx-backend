import { Injectable } from '@nestjs/common';
import {
  TelegramChatService,
  TelegramChatServiceError,
  TelegramChatErrorCode,
} from './telegram-chat.service';

@Injectable()
export class TelegramChannelPinsService {
  constructor(private readonly telegramChatService: TelegramChatService) {}

  async canBotReadPins(telegramChatId: string): Promise<boolean> {
    try {
      const admins =
        await this.telegramChatService.getChatAdministrators(telegramChatId);
      await this.telegramChatService.extractBotAdmin(admins);
      return true;
    } catch (error) {
      if (
        error instanceof TelegramChatServiceError &&
        [
          TelegramChatErrorCode.BOT_FORBIDDEN,
          TelegramChatErrorCode.BOT_NOT_ADMIN,
          TelegramChatErrorCode.BOT_MISSING_RIGHTS,
        ].includes(error.code)
      ) {
        throw error;
      }
      throw new TelegramChatServiceError(TelegramChatErrorCode.BOT_FORBIDDEN);
    }
  }

  async getPinnedMessageIds(telegramChatId: string): Promise<string[]> {
    const chat = await this.telegramChatService.getChat(telegramChatId);
    const pinnedId = chat.pinned_message?.message_id;
    if (!pinnedId) {
      return [];
    }
    return [String(pinnedId)];
  }
}

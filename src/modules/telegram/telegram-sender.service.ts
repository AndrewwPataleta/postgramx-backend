import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service';

type TelegramSendOptions = {
  threadId?: number | null;
  parseMode?: 'HTML' | 'Markdown';
};

@Injectable()
export class TelegramSenderService {
  private readonly logger = new Logger(TelegramSenderService.name);

  constructor(
    @Inject(forwardRef(() => TelegramBotService))
    private readonly telegramBotService: TelegramBotService,
  ) {}

  async sendMessage(
    chatId: string | number,
    text: string,
    options?: TelegramSendOptions,
  ): Promise<void> {
    try {
      await this.telegramBotService.sendMessage(chatId, text, {
        parse_mode: options?.parseMode,
        message_thread_id: options?.threadId ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to send admin alert to ${chatId}: ${message}`);
    }
  }
}

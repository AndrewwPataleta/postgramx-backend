import { Injectable, Logger } from '@nestjs/common';
import { MtprotoClientService } from '../../telegram-mtproto/services/mtproto-client.service';

@Injectable()
export class TelegramMessageStatsService {
  private readonly logger = new Logger(TelegramMessageStatsService.name);

  constructor(private readonly mtprotoClientService: MtprotoClientService) {}

  async getMessageViews(
    telegramChatId: string,
    messageId: string,
  ): Promise<number | null> {
    if (!this.mtprotoClientService.isEnabled()) {
      this.logger.warn(
        `MTProto is disabled, unable to fetch views for chat=${telegramChatId} message=${messageId}`,
      );
      return null;
    }

    const numericMessageId = Number(messageId);
    if (!Number.isInteger(numericMessageId) || numericMessageId <= 0) {
      this.logger.warn(
        `Invalid message id for MTProto views chat=${telegramChatId} message=${messageId}`,
      );
      return null;
    }

    try {
      this.logger.debug(
        `MTProto request getMessage views: chat=${telegramChatId} message=${numericMessageId}`,
      );

      const message = await this.mtprotoClientService.getChannelMessage(
        telegramChatId,
        numericMessageId,
      );

      if (!message) {
        this.logger.warn(
          `MTProto getMessage views returned empty result for chat=${telegramChatId} message=${numericMessageId}`,
        );
        return null;
      }

      this.logger.debug(
        `MTProto response getMessage views: chat=${telegramChatId} message=${numericMessageId} views=${message.views ?? 'null'}`,
      );

      return message.views;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to fetch MTProto views chat=${telegramChatId} message=${numericMessageId}: ${message}`,
      );
      return null;
    }
  }
}

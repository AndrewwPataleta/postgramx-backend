import { Injectable, Logger } from '@nestjs/common';
import { TelegramSenderService } from '../../telegram/telegram-sender.service';
import { PaymentsProcessingConfigService } from './payments-processing-config.service';

type AlertLevel = 'info' | 'warn' | 'error';

@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);
  private readonly levelPriority: Record<AlertLevel, number> = {
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(
    private readonly telegramSenderService: TelegramSenderService,
    private readonly config: PaymentsProcessingConfigService,
  ) {}

  async info(text: string, context?: Record<string, unknown>): Promise<void> {
    await this.send('info', text, context);
  }

  async warn(text: string, context?: Record<string, unknown>): Promise<void> {
    await this.send('warn', text, context);
  }

  async error(text: string, context?: Record<string, unknown>): Promise<void> {
    await this.send('error', text, context);
  }

  async notifyLowLiquidity(context?: Record<string, unknown>): Promise<void> {
    await this.warn('Hot wallet liquidity is low.', context);
  }

  async notifyFallbackSweepUsed(
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.info('Fallback sweep used to refill hot wallet.', context);
  }

  async notifySweepFailed(context?: Record<string, unknown>): Promise<void> {
    await this.warn('Fallback sweep failed.', context);
  }

  async notifyManualActionNeeded(
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.error('Manual action needed for payout or refund.', context);
  }

  private async send(
    level: AlertLevel,
    text: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.config.adminAlertsEnabled) {
      return;
    }

    const minLevel = this.config.adminAlertsMinLevel;
    if (this.levelPriority[level] < this.levelPriority[minLevel]) {
      return;
    }

    const chatId = this.config.adminAlertsChatId;
    if (!chatId) {
      return;
    }

    const payload = context ? `${text}\n${JSON.stringify(context)}` : text;

    try {
      await this.telegramSenderService.sendMessage(chatId, payload, {
        threadId: this.config.adminAlertsThreadId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to send admin alert: ${message}`);
    }
  }
}

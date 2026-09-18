import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context, Telegraf } from 'telegraf';
import {
  TELEGRAM_BOT_ALLOWED_UPDATES_DEFAULT,
  TELEGRAM_BOT_DEFAULT_MODE,
  TELEGRAM_BOT_MODULE_NAME,
  TELEGRAM_BOT_RECONNECT_DELAY_MS,
} from './telegram-bot.constants';
import { TelegramBotUpdate } from './telegram-bot.update';
import {
  TelegramBotConfig,
  TelegramInlineButton,
  TelegramBotMode,
} from './telegram-bot.types';
import { ChannelParticipantsService } from '../channels/channel-participants.service';
import { getMiniAppBaseUrlFromConfig } from '../../common/utils/telegram-links.util';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TELEGRAM_BOT_MODULE_NAME);
  private bot?: Telegraf<Context>;
  private reconnectTimeout?: NodeJS.Timeout;
  private pollingState: 'idle' | 'launching' | 'running' = 'idle';
  private config!: TelegramBotConfig;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => TelegramBotUpdate))
    private readonly updateRegistry: TelegramBotUpdate,
    private readonly channelParticipantsService: ChannelParticipantsService,
  ) {}

  onModuleInit(): void {
    this.config = this.loadConfig();
    this.ensureValidConfig(this.config);
    this.logger.log(
      `Bot started, webhook: ${this.config.webhookUrl ?? 'none'}, polling: ${
        this.config.mode === 'polling'
      }`,
    );
    this.initializeBot();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.pollingState = 'idle';

    if (this.bot) {
      await this.bot.stop('SIGTERM');
      this.logger.log('Telegram bot stopped.');
    }
  }

  async sendMessage(
    userTelegramId: string | number,
    text: string,
    options?: {
      reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
      parse_mode?: 'HTML' | 'Markdown';
      message_thread_id?: number;
    },
  ): Promise<void> {
    if (!this.config?.token) {
      this.logger.warn('Telegram bot token not configured; skipping send.');
      return;
    }

    try {
      const bot = this.getBot();
      await bot.telegram.sendMessage(String(userTelegramId), text, options);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send Telegram message to ${userTelegramId}: ${errorMessage}`,
      );
    }
  }

  async sendPhoto(
    userTelegramId: string | number,
    fileId: string,
    caption?: string,
    options?: {
      reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
      parse_mode?: 'HTML' | 'Markdown';
    },
  ): Promise<void> {
    if (!this.config?.token) {
      this.logger.warn('Telegram bot token not configured; skipping send.');
      return;
    }

    try {
      const bot = this.getBot();
      await bot.telegram.sendPhoto(String(userTelegramId), fileId, {
        caption,
        parse_mode: options?.parse_mode,
        reply_markup: options?.reply_markup,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send Telegram photo to ${userTelegramId}: ${errorMessage}`,
      );
    }
  }

  async sendVideo(
    userTelegramId: string | number,
    fileId: string,
    caption?: string,
    options?: {
      reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
      parse_mode?: 'HTML' | 'Markdown';
    },
  ): Promise<void> {
    if (!this.config?.token) {
      this.logger.warn('Telegram bot token not configured; skipping send.');
      return;
    }

    try {
      const bot = this.getBot();
      await bot.telegram.sendVideo(String(userTelegramId), fileId, {
        caption,
        parse_mode: options?.parse_mode,
        reply_markup: options?.reply_markup,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send Telegram video to ${userTelegramId}: ${errorMessage}`,
      );
    }
  }

  async editMessageText(
    chatId: string | number,
    messageId: string | number,
    text: string,
    options?: {
      reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
      parse_mode?: 'HTML' | 'Markdown';
    },
  ): Promise<void> {
    if (!this.config?.token) {
      this.logger.warn('Telegram bot token not configured; skipping edit.');
      return;
    }

    try {
      const bot = this.getBot();
      await bot.telegram.editMessageText(
        String(chatId),
        Number(messageId),
        undefined,
        text,
        options,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to edit Telegram message ${messageId} in ${chatId}: ${errorMessage}`,
      );
    }
  }

  async sendDealReminderToUser(
    userTelegramId: string | number,
    text: string,
    buttons: TelegramInlineButton[][],
  ): Promise<void> {
    await this.sendMessage(userTelegramId, text, {
      reply_markup: { inline_keyboard: buttons },
      parse_mode: 'HTML',
    });
  }

  async sendDealReminderToChannelAdmins(
    channelId: string,
    text: string,
    buttons: TelegramInlineButton[][],
  ): Promise<void> {
    const recipients =
      await this.channelParticipantsService.getNotificationRecipients(
        channelId,
      );
    for (const recipient of recipients) {
      if (!recipient.telegramId) {
        continue;
      }
      await this.sendDealReminderToUser(recipient.telegramId, text, buttons);
    }
  }

  private initializeBot(): void {
    if (this.config.mode !== 'polling') {
      this.logger.warn(
        `Bot mode is set to ${this.config.mode}; polling will not start.`,
      );
      return;
    }

    this.bot = new Telegraf<Context>(this.config.token);
    this.updateRegistry.register(this.bot);

    this.bot.catch((error, context) => {
      const updateType = context.updateType;
      this.logger.error(
        `Telegram bot error on update type ${updateType}: ${error.message}`,
        error.stack,
      );
    });

    this.launchPolling();
  }

  private launchPolling(): void {
    if (!this.bot) {
      return;
    }

    if (this.pollingState !== 'idle') {
      this.logger.warn(
        `Telegram bot polling is already ${this.pollingState}; skipping launch.`,
      );
      return;
    }

    this.pollingState = 'launching';

    this.bot
      .launch({ allowedUpdates: this.config.allowedUpdates })
      .then(() => {
        this.pollingState = 'running';
        this.logger.log('Telegram bot started with polling.');
      })
      .catch((error: Error) => {
        this.pollingState = 'idle';
        this.logger.error(
          `Failed to start Telegram bot: ${error.message}`,
          error.stack,
        );
        if (error.message.includes('409')) {
          this.logger.warn(
            'Telegram polling conflict detected. Another bot instance may be running; retry skipped.',
          );
          return;
        }
        this.scheduleReconnect();
      });
  }

  private getBot(): Telegraf<Context> {
    if (!this.bot) {
      this.bot = new Telegraf<Context>(this.config.token);
    }

    return this.bot;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return;
    }

    if (this.pollingState !== 'idle') {
      this.logger.warn(
        `Telegram bot polling is ${this.pollingState}; reconnect skipped.`,
      );
      return;
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      this.logger.warn('Retrying Telegram bot polling startup.');
      this.launchPolling();
    }, TELEGRAM_BOT_RECONNECT_DELAY_MS);
  }

  private loadConfig(): TelegramBotConfig {
    const modeValue = (
      this.configService.get<string>('TELEGRAM_BOT_MODE') ||
      TELEGRAM_BOT_DEFAULT_MODE
    ).toLowerCase();
    const mode = this.parseMode(modeValue);

    const allowedUpdatesRaw = this.configService.get<string>(
      'TELEGRAM_ALLOWED_UPDATES',
    );
    const allowedUpdates = allowedUpdatesRaw
      ? allowedUpdatesRaw
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [...TELEGRAM_BOT_ALLOWED_UPDATES_DEFAULT];

    return {
      token: this.configService.get<string>('BOT_TOKEN') || '',
      username: this.configService.get<string>('TELEGRAM_BOT_USERNAME'),
      miniAppUrl: getMiniAppBaseUrlFromConfig(this.configService),
      mode,
      webhookUrl: this.configService.get<string>('TELEGRAM_WEBHOOK_URL'),
      allowedUpdates,
    };
  }

  private parseMode(mode: string): TelegramBotMode {
    return mode === 'webhook' ? 'webhook' : 'polling';
  }

  private ensureValidConfig(config: TelegramBotConfig): void {
    if (!config.token) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN is required to start the Telegram bot.',
      );
    }

    if (!config.miniAppUrl) {
      this.logger.warn(
        'Mini App URL is not set (TELEGRAM_MINIAPP_URL/TELEGRAM_MINI_APP_URL/MINI_APP_URL). Mini App buttons will be limited.',
      );
    }

    if (config.mode === 'webhook' && !config.webhookUrl) {
      this.logger.warn(
        'TELEGRAM_WEBHOOK_URL is not set; webhook mode is not fully configured.',
      );
    }
  }
}

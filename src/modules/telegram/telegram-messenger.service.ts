import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import {
  TelegramI18nService,
  TelegramLanguage,
} from './i18n/telegram-i18n.service';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service';
import { User } from '../auth/entities/user.entity';
import { TelegramInlineButton } from '../telegram-bot/telegram-bot.types';
import { TELEGRAM_PUBLIC_BASE_URL } from '../../common/constants/telegram/telegram-links.constants';
import {
  appendRouteToUrl,
  buildTelegramMiniAppFallbackUrl,
  ensureHttpsUrl,
  getMiniAppBaseUrlFromConfig,
} from '../../common/utils/telegram-links.util';

const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;

export interface TelegramInlineButtonSpec {
  textKey: string;
  textArgs?: Record<string, any>;
  url?: string;
  webAppUrl?: string;
  callbackData?: string;
}

interface SendOptions {
  lang?: TelegramLanguage;
  parse_mode?: 'HTML' | 'Markdown';
}

interface SendMediaOptions extends SendOptions {
  buttons?: TelegramInlineButtonSpec[][];
}

@Injectable()
export class TelegramMessengerService {
  private readonly logger = new Logger(TelegramMessengerService.name);

  constructor(
    @Inject(forwardRef(() => TelegramBotService))
    private readonly telegramBotService: TelegramBotService,
    private readonly telegramI18nService: TelegramI18nService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async sendText(
    userIdOrChatId: string | number,
    key: string,
    args?: Record<string, any>,
    options?: SendOptions & {
      reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
    },
  ): Promise<void> {
    const lang = await this.resolveLanguage(userIdOrChatId, options?.lang);
    const parse_mode = this.resolveParseMode(options);
    const text = this.telegramI18nService.t(
      lang,
      key,
      this.formatArgs(args, parse_mode),
    );
    await this.sendMessageChunks(userIdOrChatId, text, {
      parse_mode,
      reply_markup: options?.reply_markup,
    });
  }

  async editText(
    chatId: string | number,
    messageId: string | number,
    key: string,
    args?: Record<string, any>,
    options?: SendOptions & {
      reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
    },
  ): Promise<void> {
    const lang = await this.resolveLanguage(chatId, options?.lang);
    const parse_mode = this.resolveParseMode(options);
    const text = this.telegramI18nService.t(
      lang,
      key,
      this.formatArgs(args, parse_mode),
    );
    await this.telegramBotService.editMessageText(chatId, messageId, text, {
      parse_mode,
      reply_markup: options?.reply_markup,
    });
  }

  async sendPhotoWithCaption(
    userIdOrChatId: string | number,
    fileId: string,
    captionKey: string,
    args?: Record<string, any>,
    options?: SendMediaOptions,
  ): Promise<void> {
    const lang = await this.resolveLanguage(userIdOrChatId, options?.lang);
    const parse_mode = this.resolveParseMode(options);
    const caption = this.telegramI18nService.t(
      lang,
      captionKey,
      this.formatArgs(args, parse_mode),
    );
    const reply_markup = options?.buttons
      ? { inline_keyboard: this.buildInlineKeyboard(options.buttons, lang) }
      : undefined;
    const captionChunks = this.splitText(caption, TELEGRAM_CAPTION_LIMIT);
    const [captionChunk, ...remainingChunks] = captionChunks;
    await this.telegramBotService.sendPhoto(
      userIdOrChatId,
      fileId,
      captionChunk,
      {
        parse_mode,
        reply_markup,
      },
    );
    if (remainingChunks.length > 0) {
      await this.sendMessageChunks(userIdOrChatId, remainingChunks.join(''), {
        parse_mode,
      });
    }
  }

  async sendVideoWithCaption(
    userIdOrChatId: string | number,
    fileId: string,
    captionKey: string,
    args?: Record<string, any>,
    options?: SendMediaOptions,
  ): Promise<void> {
    const lang = await this.resolveLanguage(userIdOrChatId, options?.lang);
    const parse_mode = this.resolveParseMode(options);
    const caption = this.telegramI18nService.t(
      lang,
      captionKey,
      this.formatArgs(args, parse_mode),
    );
    const reply_markup = options?.buttons
      ? { inline_keyboard: this.buildInlineKeyboard(options.buttons, lang) }
      : undefined;
    const captionChunks = this.splitText(caption, TELEGRAM_CAPTION_LIMIT);
    const [captionChunk, ...remainingChunks] = captionChunks;
    await this.telegramBotService.sendVideo(
      userIdOrChatId,
      fileId,
      captionChunk,
      {
        parse_mode,
        reply_markup,
      },
    );
    if (remainingChunks.length > 0) {
      await this.sendMessageChunks(userIdOrChatId, remainingChunks.join(''), {
        parse_mode,
      });
    }
  }

  async sendInlineKeyboard(
    userIdOrChatId: string | number,
    key: string,
    args: Record<string, any> | undefined,
    buttons: TelegramInlineButtonSpec[][],
    options?: SendOptions,
  ): Promise<void> {
    const lang = await this.resolveLanguage(userIdOrChatId, options?.lang);
    const parse_mode = this.resolveParseMode(options);
    const text = this.telegramI18nService.t(
      lang,
      key,
      this.formatArgs(args, parse_mode),
    );
    const inline_keyboard = this.buildInlineKeyboard(buttons, lang);
    await this.sendMessageChunks(userIdOrChatId, text, {
      parse_mode,
      reply_markup: { inline_keyboard },
    });
  }

  async resolveLanguageForTelegramId(
    userIdOrChatId?: string | number | null,
    fallback: TelegramLanguage = 'en',
  ): Promise<TelegramLanguage> {
    if (!userIdOrChatId) {
      return fallback;
    }

    const telegramId = String(userIdOrChatId);
    const user = await this.userRepository.findOne({
      where: { telegramId },
    });

    return this.telegramI18nService.resolveLanguageForUser(user, fallback);
  }

  buildMiniAppUrl(route?: string): string {
    const baseUrl = getMiniAppBaseUrlFromConfig(this.configService);

    if (baseUrl) {
      return appendRouteToUrl(baseUrl, route) ?? TELEGRAM_PUBLIC_BASE_URL;
    }

    return buildTelegramMiniAppFallbackUrl(
      this.configService.get<string>('TELEGRAM_BOT_USERNAME'),
      route,
    );
  }

  private async resolveLanguage(
    userIdOrChatId: string | number,
    preferred?: TelegramLanguage,
  ): Promise<TelegramLanguage> {
    if (preferred) {
      return preferred;
    }

    return this.resolveLanguageForTelegramId(userIdOrChatId);
  }

  private resolveParseMode(
    options?: SendOptions,
  ): 'HTML' | 'Markdown' | undefined {
    return options?.parse_mode ?? 'HTML';
  }

  private formatArgs(
    args: Record<string, any> | undefined,
    parseMode?: 'HTML' | 'Markdown',
  ): Record<string, any> | undefined {
    if (!args || parseMode !== 'HTML') {
      return args;
    }

    return Object.fromEntries(
      Object.entries(args).map(([key, value]) => {
        if (value === null || value === undefined) {
          return [key, value];
        }
        return [key, this.escapeHtml(String(value))];
      }),
    );
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private splitText(text: string, limit: number): string[] {
    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += limit) {
      chunks.push(text.slice(index, index + limit));
    }
    return chunks.length ? chunks : [''];
  }

  private async sendMessageChunks(
    userIdOrChatId: string | number,
    text: string,
    options?: {
      reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
      parse_mode?: 'HTML' | 'Markdown';
    },
  ): Promise<void> {
    const chunks = this.splitText(text, TELEGRAM_MESSAGE_LIMIT);
    for (const [index, chunk] of chunks.entries()) {
      await this.telegramBotService.sendMessage(userIdOrChatId, chunk, {
        parse_mode: options?.parse_mode,
        reply_markup: index === 0 ? options?.reply_markup : undefined,
      });
    }
  }

  private buildInlineKeyboard(
    buttons: TelegramInlineButtonSpec[][],
    lang: TelegramLanguage,
  ): TelegramInlineButton[][] {
    return buttons.map((row) =>
      row
        .map((button) => {
          const text = this.telegramI18nService.t(
            lang,
            button.textKey,
            button.textArgs,
          );

          const url = button.url ? ensureHttpsUrl(button.url) : undefined;
          const webAppUrl = button.webAppUrl
            ? ensureHttpsUrl(button.webAppUrl)
            : undefined;

          if (!url && button.url) {
            this.logger.warn(
              `Invalid inline button URL dropped: ${button.url}`,
            );
          }
          if (!webAppUrl && button.webAppUrl) {
            this.logger.warn(
              `Invalid inline button web app URL dropped: ${button.webAppUrl}`,
            );
          }

          const result: TelegramInlineButton = {
            text,
            callback_data: button.callbackData,
          };

          if (url) {
            result.url = url;
          }

          if (webAppUrl) {
            result.web_app = { url: webAppUrl };
          }

          if (!result.url && !result.web_app && !result.callback_data) {
            return null;
          }

          return result;
        })
        .filter((button): button is TelegramInlineButton =>
          Boolean(button?.text),
        ),
    );
  }
}

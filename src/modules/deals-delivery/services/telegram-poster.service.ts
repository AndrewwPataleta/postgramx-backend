import { Injectable, Logger } from '@nestjs/common';
import { DealCreativeEntity } from '../../deals/entities/deal-creative.entity';
import { DealEntity } from '../../deals/entities/deal.entity';
import { ChannelEntity } from '../../channels/entities/channel.entity';
import { TelegramApiService } from '../../../core/telegram-api.service';
import {
  TelegramChatService,
  TelegramChatServiceError,
} from '../../telegram/telegram-chat.service';
import { DeliveryCheckResult } from '../types/delivery-check-result';
import { logMeta } from '../../../common/logging/logContext';

interface TelegramMessageResponse {
  message_id: number;
}

interface TelegramDeleteMessageResponse {
  ok: boolean;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;

@Injectable()
export class TelegramPosterService {
  private readonly logger = new Logger(TelegramPosterService.name);
  private readonly apiBaseUrl: string;

  constructor(
    private readonly telegramChatService: TelegramChatService,
    private readonly telegramApiService: TelegramApiService,
  ) {
    this.apiBaseUrl = this.telegramApiService.getApiBaseUrl();
  }

  async checkCanPost(channel: ChannelEntity): Promise<DeliveryCheckResult> {
    const chatId = this.resolveChatId(channel);
    if (!chatId) {
      return { ok: false, reason: 'CHANNEL_MISSING_CHAT_ID' };
    }

    try {
      const admins = channel.telegramChatId
        ? await this.telegramChatService.getChatAdministrators(
            channel.telegramChatId,
          )
        : await this.telegramChatService.getChatAdministratorsByUsername(
            channel.username,
          );
      await this.telegramChatService.extractBotAdmin(admins);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof TelegramChatServiceError) {
        return { ok: false, reason: error.code, details: message };
      }
      return { ok: false, reason: 'UNKNOWN', details: message };
    }
  }

  async publishCreativeToChannel(
    deal: DealEntity,
    creative: DealCreativeEntity,
    channel: ChannelEntity,
  ): Promise<TelegramMessageResponse> {
    const chatId = this.resolveChatId(channel);
    if (!chatId) {
      throw new Error('Channel chat id is missing.');
    }

    const payload = (creative.payload ?? {}) as Record<string, unknown>;
    const type = String(payload.type ?? 'TEXT');
    const text = String(payload.text ?? payload.caption ?? '');
    const caption = payload.caption ? String(payload.caption) : undefined;
    const mediaFileId = payload.mediaFileId
      ? String(payload.mediaFileId)
      : undefined;

    switch (type) {
      case 'TEXT':
        return this.sendMessageChunks(chatId, this.ensureText(text));
      case 'IMAGE':
        if (!mediaFileId) {
          throw new Error('Creative media file is missing.');
        }
        return this.sendMediaWithOptionalCaption(
          'photo',
          chatId,
          mediaFileId,
          caption ?? (text || undefined),
        );
      case 'VIDEO':
        if (!mediaFileId) {
          throw new Error('Creative media file is missing.');
        }
        return this.sendMediaWithOptionalCaption(
          'video',
          chatId,
          mediaFileId,
          caption ?? (text || undefined),
        );
      default:
        this.logger.warn(
          'delivery.deal.publish.unsupported',
          logMeta({ dealId: deal.id, creativeType: type }),
        );
        throw new Error('Unsupported creative type.');
    }
  }

  async checkMessagePresence(
    channel: ChannelEntity,
    _messageId: string,
  ): Promise<DeliveryCheckResult> {
    const chatId = this.resolveChatId(channel);
    if (!chatId) {
      return { ok: false, reason: 'CHANNEL_MISSING_CHAT_ID' };
    }

    try {
      await this.request<unknown>('getChat', { chat_id: chatId });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalized = message.toLowerCase();
      if (normalized.includes('message') && normalized.includes('not found')) {
        return { ok: false, reason: 'MESSAGE_NOT_FOUND', details: message };
      }
      return { ok: false, reason: 'CHECK_FAILED', details: message };
    }
  }

  async deleteChannelMessage(
    channel: ChannelEntity,
    messageId: string,
  ): Promise<void> {
    const chatId = this.resolveChatId(channel);
    if (!chatId) {
      throw new Error('Channel chat id is missing.');
    }

    await this.request<TelegramDeleteMessageResponse>('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  private resolveChatId(channel: ChannelEntity): string | null {
    if (channel.telegramChatId) {
      return channel.telegramChatId;
    }
    if (channel.username) {
      return `@${channel.username}`;
    }
    return null;
  }

  private async sendMessage(
    chatId: string,
    text: string,
  ): Promise<TelegramMessageResponse> {
    return this.request<TelegramMessageResponse>('sendMessage', {
      chat_id: chatId,
      text,
    });
  }

  private async sendPhoto(
    chatId: string,
    fileId: string,
    options?: { caption?: string },
  ): Promise<TelegramMessageResponse> {
    return this.request<TelegramMessageResponse>('sendPhoto', {
      chat_id: chatId,
      photo: fileId,
      ...(options?.caption ? { caption: options.caption } : {}),
    });
  }

  private async sendVideo(
    chatId: string,
    fileId: string,
    options?: { caption?: string },
  ): Promise<TelegramMessageResponse> {
    return this.request<TelegramMessageResponse>('sendVideo', {
      chat_id: chatId,
      video: fileId,
      ...(options?.caption ? { caption: options.caption } : {}),
    });
  }

  private ensureText(text: string): string {
    if (text.trim().length === 0) {
      throw new Error('Creative text is missing.');
    }
    return text;
  }

  private splitText(text: string, limit: number): string[] {
    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += limit) {
      chunks.push(text.slice(index, index + limit));
    }
    return chunks.length ? chunks : [''];
  }

  private async sendMessageChunks(
    chatId: string,
    text: string,
  ): Promise<TelegramMessageResponse> {
    const chunks = this.splitText(text, TELEGRAM_MESSAGE_LIMIT);
    let firstResponse: TelegramMessageResponse | null = null;
    for (const chunk of chunks) {
      const response = await this.sendMessage(chatId, chunk);
      if (!firstResponse) {
        firstResponse = response;
      }
    }
    if (!firstResponse) {
      throw new Error('Failed to send message.');
    }
    return firstResponse;
  }

  private async sendMediaWithOptionalCaption(
    type: 'photo' | 'video',
    chatId: string,
    fileId: string,
    caption?: string,
  ): Promise<TelegramMessageResponse> {
    const normalizedCaption = caption?.trim() ? caption : undefined;
    if (!normalizedCaption) {
      return type === 'photo'
        ? this.sendPhoto(chatId, fileId)
        : this.sendVideo(chatId, fileId);
    }

    const captionChunks = this.splitText(
      normalizedCaption,
      TELEGRAM_CAPTION_LIMIT,
    );
    const [captionChunk, ...remainingChunks] = captionChunks;
    const response =
      type === 'photo'
        ? await this.sendPhoto(chatId, fileId, { caption: captionChunk })
        : await this.sendVideo(chatId, fileId, { caption: captionChunk });
    if (remainingChunks.length > 0) {
      await this.sendMessageChunks(chatId, remainingChunks.join(''));
    }
    return response;
  }

  private async request<T>(
    method: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = `${this.apiBaseUrl}/${method}`;
    const body = new URLSearchParams(params);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const payload = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || !payload.ok) {
      const description = payload.description || 'Telegram API error.';
      this.logger.warn(
        'delivery.telegram.api.error',
        logMeta({ method, description, errorCode: payload.error_code }),
      );
      throw new Error(description);
    }

    if (!payload.result) {
      throw new Error('Telegram API response missing result.');
    }

    return payload.result;
  }
}

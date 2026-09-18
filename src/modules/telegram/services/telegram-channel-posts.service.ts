import { Injectable, Logger } from '@nestjs/common';
import { TelegramApiService } from '../../../core/telegram-api.service';
import { TelegramMessage } from '../../deals/publication/telegramMessageFingerprint';

export class TelegramMessageNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = TelegramMessageNotFoundError.name;
  }
}

export class TelegramMethodUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = TelegramMethodUnavailableError.name;
  }
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

@Injectable()
export class TelegramChannelPostsService {
  private readonly logger = new Logger(TelegramChannelPostsService.name);
  private readonly apiBaseUrl: string;
  private getMessageSupported: boolean | null = null;

  constructor(private readonly telegramApiService: TelegramApiService) {
    this.apiBaseUrl = this.telegramApiService.getApiBaseUrl();
  }

  async getChannelMessage(
    chatId: string,
    messageId: string,
  ): Promise<TelegramMessage | null> {
    if (this.getMessageSupported === false) {
      throw new TelegramMethodUnavailableError(
        'GET_MESSAGE_METHOD_UNAVAILABLE',
      );
    }

    const response = await this.request<TelegramMessage>('getMessage', {
      chat_id: chatId,
      message_id: messageId,
    });

    if (!response.result) {
      throw new TelegramMessageNotFoundError(
        `MESSAGE_NOT_FOUND: chatId=${chatId} messageId=${messageId}`,
      );
    }

    return response.result;
  }

  private async request<T>(
    method: string,
    params: Record<string, string>,
  ): Promise<TelegramApiResponse<T>> {
    const url = `${this.apiBaseUrl}/${method}`;
    const body = new URLSearchParams(params);
    this.logger.debug(
      `Telegram API request ${method}: ${body.toString().replace(/&/g, ' ')}`,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    this.logger.debug(
      `Telegram API response ${method}: HTTP ${response.status}`,
    );

    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok) {
      const description = payload.description || 'Telegram API error.';
      const errorCode = payload.error_code;
      const normalizedDescription = description.toLowerCase();

      this.logger.warn(
        `Telegram API ${method} failed: status=${response.status} code=${errorCode ?? 'unknown'} description=${description}`,
      );

      if (
        method === 'getMessage' &&
        response.status === 404 &&
        normalizedDescription === 'not found'
      ) {
        this.getMessageSupported = false;
        throw new TelegramMethodUnavailableError(
          `${errorCode ?? 404}:${description}`,
        );
      }

      if (
        normalizedDescription.includes('message to get not found') ||
        normalizedDescription.includes('message not found')
      ) {
        throw new TelegramMessageNotFoundError(
          `${errorCode ?? 400}:${description}`,
        );
      }

      this.logger.warn(
        `Failed to fetch channel message via ${method}: ${description} (code=${errorCode ?? 'unknown'})`,
      );
      throw new Error(`${errorCode ?? 'UNKNOWN'}:${description}`);
    }

    if (method === 'getMessage') {
      this.getMessageSupported = true;
    }

    return payload;
  }
}

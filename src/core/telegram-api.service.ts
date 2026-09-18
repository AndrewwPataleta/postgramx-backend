import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramApiService {
  private readonly apiBaseUrl: string;
  private readonly fileBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const token = this.configService.get<string>('BOT_TOKEN');
    if (!token) {
      throw new Error('BOT_TOKEN is required for TelegramApiService');
    }

    const apiBaseUrl = this.normalizeUrl(
      this.configService.get<string>('TELEGRAM_BOT_API_BASE_URL'),
    );
    this.apiBaseUrl = apiBaseUrl ?? `https://api.telegram.org/bot${token}`;

    const fileBaseUrl = this.normalizeUrl(
      this.configService.get<string>('TELEGRAM_BOT_FILE_API_BASE_URL'),
    );
    this.fileBaseUrl =
      fileBaseUrl ?? this.resolveFileBaseUrl(this.apiBaseUrl, token);
  }

  getApiBaseUrl(): string {
    return this.apiBaseUrl;
  }

  buildFileUrl(filePath: string): string {
    return `${this.fileBaseUrl}/${filePath}`;
  }

  private normalizeUrl(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private resolveFileBaseUrl(apiBaseUrl: string, token: string): string {
    if (apiBaseUrl.includes('/bot')) {
      return apiBaseUrl.replace('/bot', '/file/bot');
    }
    return `https://api.telegram.org/file/bot${token}`;
  }
}

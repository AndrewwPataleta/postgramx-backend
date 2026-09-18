import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TELEGRAM_PUBLIC_BASE_URL } from '../../../common/constants/telegram/telegram-links.constants';
import {
  appendRouteToUrl,
  buildTelegramMiniAppFallbackUrl,
  getMiniAppBaseUrlFromConfig,
  normalizeTelegramLink,
} from '../../../common/utils/telegram-links.util';
import { TelegramInlineButtonSpec } from '../../telegram/telegram-messenger.service';
import {
  TELEGRAM_MINI_APP_ROUTES,
  TELEGRAM_SUPPORT_URL_PLACEHOLDER,
} from '../telegram-bot.constants';

@Injectable()
export class HelpHandler {
  constructor(private readonly configService: ConfigService) {}

  getButtons(): TelegramInlineButtonSpec[][] {
    const openMiniAppUrl = this.buildMiniAppUrl(
      TELEGRAM_MINI_APP_ROUTES.marketplace,
    );
    const supportUrl = this.buildSupportUrl();

    return [
      [
        {
          textKey: 'telegram.common.open_mini_app',
          webAppUrl: openMiniAppUrl,
        },
      ],
      [{ textKey: 'telegram.common.support', url: supportUrl }],
    ];
  }

  private buildMiniAppUrl(route?: string): string {
    const baseUrl = getMiniAppBaseUrlFromConfig(this.configService);
    if (baseUrl) {
      return appendRouteToUrl(baseUrl, route) ?? TELEGRAM_PUBLIC_BASE_URL;
    }

    return buildTelegramMiniAppFallbackUrl(
      this.configService.get<string>('TELEGRAM_BOT_USERNAME'),
      route,
    );
  }

  private buildSupportUrl(): string {
    const configured = this.configService.get<string>('TELEGRAM_SUPPORT_URL');
    const resolved = configured?.trim() || TELEGRAM_SUPPORT_URL_PLACEHOLDER;

    return normalizeTelegramLink(resolved);
  }
}

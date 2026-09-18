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
import { TELEGRAM_SUPPORT_URL_PLACEHOLDER } from '../telegram-bot.constants';

@Injectable()
export class StartHandler {
  constructor(private readonly configService: ConfigService) {}

  getButtons(): TelegramInlineButtonSpec[][] {
    const miniAppButton = this.buildMiniAppButton();
    const supportUrl = this.buildSupportUrl();

    const buttons: TelegramInlineButtonSpec[][] = [];

    if (miniAppButton) {
      buttons.push([miniAppButton]);
    }

    buttons.push([
      { textKey: 'telegram.common.about_escrow', callbackData: 'about_escrow' },
    ]);
    buttons.push([{ textKey: 'telegram.common.support', url: supportUrl }]);

    return buttons;
  }

  private buildMiniAppButton(route?: string): TelegramInlineButtonSpec | null {
    const webAppUrl = this.buildMiniAppWebAppUrl(route);
    if (webAppUrl) {
      return {
        textKey: 'telegram.common.open_mini_app',
        webAppUrl,
      };
    }

    const fallbackUrl = this.buildMiniAppFallbackUrl(route);
    if (fallbackUrl) {
      return {
        textKey: 'telegram.common.open_mini_app',
        url: fallbackUrl,
      };
    }

    return null;
  }

  private buildMiniAppWebAppUrl(route?: string): string | null {
    const baseUrl = getMiniAppBaseUrlFromConfig(this.configService);
    if (!baseUrl) {
      return null;
    }

    return appendRouteToUrl(baseUrl, route);
  }

  private buildMiniAppFallbackUrl(route?: string): string | null {
    const botUsername = this.configService.get<string>('TELEGRAM_BOT_USERNAME');
    const fallbackUrl = buildTelegramMiniAppFallbackUrl(botUsername, route);

    return fallbackUrl === TELEGRAM_PUBLIC_BASE_URL ? null : fallbackUrl;
  }

  private buildSupportUrl(): string {
    const configured = this.configService.get<string>('TELEGRAM_SUPPORT_URL');
    const resolved = configured?.trim() || TELEGRAM_SUPPORT_URL_PLACEHOLDER;

    return normalizeTelegramLink(resolved);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TELEGRAM_PUBLIC_BASE_URL } from '../../common/constants/telegram/telegram-links.constants';
import {
  appendRouteToUrl,
  getMiniAppBaseUrlFromConfig,
  normalizeTelegramHandle,
} from '../../common/utils/telegram-links.util';

@Injectable()
export class DealsDeepLinkService {
  private readonly logger = new Logger(DealsDeepLinkService.name);

  constructor(private readonly configService: ConfigService) {}

  buildDealLink(dealId: string): string {
    const miniAppUrl = getMiniAppBaseUrlFromConfig(this.configService);
    if (miniAppUrl) {
      const dealLink = appendRouteToUrl(miniAppUrl, `deals/${dealId}`);
      if (dealLink) {
        return dealLink;
      }

      this.logger.warn('Mini App URL must be https; falling back.');
      return TELEGRAM_PUBLIC_BASE_URL;
    }

    const botUsername = normalizeTelegramHandle(
      this.configService.get<string>('TELEGRAM_BOT_USERNAME'),
    );
    const miniAppShortName = normalizeTelegramHandle(
      this.configService.get<string>('TELEGRAM_MINIAPP_SHORT_NAME'),
    );
    const startParam = `deal_${dealId}`;

    if (botUsername && miniAppShortName) {
      return `${TELEGRAM_PUBLIC_BASE_URL}/${botUsername}/${miniAppShortName}?startapp=${startParam}`;
    }

    if (botUsername) {
      return `${TELEGRAM_PUBLIC_BASE_URL}/${botUsername}?startapp=${startParam}`;
    }

    return TELEGRAM_PUBLIC_BASE_URL;
  }
}

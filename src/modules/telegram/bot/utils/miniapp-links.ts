import { TELEGRAM_PUBLIC_BASE_URL } from '../../../../common/constants/telegram/telegram-links.constants';
import {
  appendRouteToUrl,
  getMiniAppBaseUrlFromEnv,
} from '../../../../common/utils/telegram-links.util';

export function buildMiniAppDealLink(dealId: string) {
  const baseUrl = getMiniAppBaseUrlFromEnv();
  if (!baseUrl) {
    return TELEGRAM_PUBLIC_BASE_URL;
  }

  return (
    appendRouteToUrl(baseUrl, `deals/${dealId}`) ?? TELEGRAM_PUBLIC_BASE_URL
  );
}

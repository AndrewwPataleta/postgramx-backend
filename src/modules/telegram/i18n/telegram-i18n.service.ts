import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { User } from '../../auth/entities/user.entity';

export type TelegramLanguage = 'en' | 'ru';

@Injectable()
export class TelegramI18nService {
  private readonly logger = new Logger(TelegramI18nService.name);

  constructor(private readonly i18nService: I18nService) {}

  resolveLanguageForUser(
    user?: User | null,
    fallback: TelegramLanguage = 'en',
  ): TelegramLanguage {
    const raw = user?.lang?.trim();
    if (!raw) {
      return fallback;
    }

    const normalized = raw.toLowerCase().replace(/_/g, '-');
    const primary = normalized.split('-')[0];

    if (primary === 'ru' || primary === 'en') {
      return primary;
    }

    return fallback;
  }

  t(lang: TelegramLanguage, key: string, args?: Record<string, any>): string {
    try {
      const translated = this.i18nService.translate(key, { lang, args });
      if (typeof translated === 'string' && translated !== key) {
        return translated;
      }

      if (lang !== 'en') {
        const fallback = this.i18nService.translate(key, {
          lang: 'en',
          args,
        });
        if (typeof fallback === 'string') {
          return fallback;
        }
      }

      return typeof translated === 'string' ? translated : key;
    } catch (error) {
      this.logger.warn(`Missing telegram i18n key: ${key}`);
      return key;
    }
  }
}

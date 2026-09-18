import { ConfigService } from '@nestjs/config';
import {
  TELEGRAM_MINI_APP_ENV_KEYS,
  TELEGRAM_PUBLIC_BASE_URL,
} from '../constants/telegram/telegram-links.constants';

export function getMiniAppBaseUrlFromConfig(
  configService: ConfigService,
): string | undefined {
  for (const key of TELEGRAM_MINI_APP_ENV_KEYS) {
    const value = configService.get<string>(key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function getMiniAppBaseUrlFromEnv(): string | undefined {
  for (const key of TELEGRAM_MINI_APP_ENV_KEYS) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function ensureHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch (error) {
    return null;
  }
}

export function appendRouteToUrl(
  baseUrl: string,
  route?: string,
): string | null {
  const normalized = ensureHttpsUrl(baseUrl);
  if (!normalized) {
    return null;
  }

  if (!route) {
    return normalized;
  }

  try {
    const url = new URL(normalized);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${route}`;
    return url.toString();
  } catch (error) {
    return normalized;
  }
}

export function normalizeTelegramHandle(
  value?: string | null,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

export function buildTelegramMiniAppFallbackUrl(
  botUsername?: string | null,
  route?: string,
): string {
  const normalizedUsername = normalizeTelegramHandle(botUsername);
  if (!normalizedUsername) {
    return TELEGRAM_PUBLIC_BASE_URL;
  }

  return route
    ? `${TELEGRAM_PUBLIC_BASE_URL}/${normalizedUsername}?startapp=${route}`
    : `${TELEGRAM_PUBLIC_BASE_URL}/${normalizedUsername}`;
}

export function normalizeTelegramLink(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('@')) {
    return `${TELEGRAM_PUBLIC_BASE_URL}/${trimmed.slice(1)}`;
  }

  if (!trimmed.includes('://')) {
    return `${TELEGRAM_PUBLIC_BASE_URL}/${trimmed}`;
  }

  return ensureHttpsUrl(trimmed) ?? TELEGRAM_PUBLIC_BASE_URL;
}

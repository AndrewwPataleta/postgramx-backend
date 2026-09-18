import { I18nContext, I18nService, TranslateOptions } from 'nestjs-i18n';

export type HttpExceptionPayload = {
  key: string;
  message: string | string[];
} & Record<string, unknown>;

export function buildHttpExceptionPayload(
  key: string,
  message: string | string[],
  extra: Record<string, unknown> = {},
): HttpExceptionPayload {
  return {
    key,
    message,
    ...extra,
  };
}

function normalizeI18nMessage(value: unknown): string | string[] {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string'))
    return value;
  return String(value);
}

export async function buildI18nHttpExceptionPayload(
  i18n: I18nService | I18nContext,
  key: string,
  options?: TranslateOptions,
  extra: Record<string, unknown> = {},
): Promise<HttpExceptionPayload> {
  const raw = await i18n.t(key, options);
  const message = normalizeI18nMessage(raw);
  return buildHttpExceptionPayload(key, message, extra);
}

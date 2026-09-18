import { createHash } from 'crypto';

export interface TelegramMessageEntity {
  type?: string;
  offset?: number;
  length?: number;
  url?: string;
  language?: string;
  custom_emoji_id?: string;
}

export interface TelegramInlineKeyboardButton {
  text?: string;
  url?: string;
  callback_data?: string;
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
  login_url?: { url?: string };
  web_app?: { url?: string };
}

export interface TelegramMessage {
  text?: string;
  caption?: string;
  grouped_id?: string | number;
  photo?: Array<{ file_id?: string; file_unique_id?: string }>;
  video?: { file_id?: string; file_unique_id?: string };
  document?: { file_id?: string; file_unique_id?: string };
  animation?: { file_id?: string; file_unique_id?: string };
  audio?: { file_id?: string; file_unique_id?: string };
  voice?: { file_id?: string; file_unique_id?: string };
  sticker?: { file_id?: string; file_unique_id?: string };
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  reply_markup?: {
    inline_keyboard?: TelegramInlineKeyboardButton[][];
  };
  link_preview_options?: {
    is_disabled?: boolean;
    url?: string;
    prefer_large_media?: boolean;
    prefer_small_media?: boolean;
    show_above_text?: boolean;
  };
}

export function normalizeText(input: string | null | undefined): string {
  if (!input) {
    return '';
  }

  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function fingerprintMedia(
  message: TelegramMessage | null | undefined,
): string {
  if (!message) {
    return 'none';
  }

  const mediaParts: string[] = [];
  const groupedId = message.grouped_id ? String(message.grouped_id) : null;
  if (groupedId) {
    mediaParts.push(`group:${groupedId}`);
  }

  const photoFingerprint = message.photo
    ?.map((item) => item.file_unique_id || item.file_id || 'unknown')
    .join(',');
  if (photoFingerprint) {
    mediaParts.push(`photo:${photoFingerprint}`);
  }

  const appendSingle = (
    type: string,
    media?: { file_id?: string; file_unique_id?: string },
  ): void => {
    if (!media) {
      return;
    }
    mediaParts.push(
      `${type}:${media.file_unique_id || media.file_id || 'unknown'}`,
    );
  };

  appendSingle('video', message.video);
  appendSingle('document', message.document);
  appendSingle('animation', message.animation);
  appendSingle('audio', message.audio);
  appendSingle('voice', message.voice);
  appendSingle('sticker', message.sticker);

  return mediaParts.length > 0 ? mediaParts.join('|') : 'none';
}

export function fingerprintKeyboard(
  message: TelegramMessage | null | undefined,
): string {
  const keyboard = message?.reply_markup?.inline_keyboard;
  if (!keyboard?.length) {
    return 'none';
  }

  const canonical = keyboard.map((row) =>
    row.map((button) => ({
      text: button.text ?? null,
      url: button.url ?? null,
      callback_data: button.callback_data ?? null,
      switch_inline_query: button.switch_inline_query ?? null,
      switch_inline_query_current_chat:
        button.switch_inline_query_current_chat ?? null,
      login_url: button.login_url?.url ?? null,
      web_app: button.web_app?.url ?? null,
    })),
  );

  return hashString(stableStringify(canonical));
}

export function fingerprintEntities(
  message: TelegramMessage | null | undefined,
): string {
  if (!message) {
    return 'none';
  }

  const canonical = {
    entities: (message.entities ?? []).map((entity) => ({
      type: entity.type ?? null,
      offset: entity.offset ?? null,
      length: entity.length ?? null,
      url: entity.url ?? null,
      language: entity.language ?? null,
      custom_emoji_id: entity.custom_emoji_id ?? null,
    })),
    caption_entities: (message.caption_entities ?? []).map((entity) => ({
      type: entity.type ?? null,
      offset: entity.offset ?? null,
      length: entity.length ?? null,
      url: entity.url ?? null,
      language: entity.language ?? null,
      custom_emoji_id: entity.custom_emoji_id ?? null,
    })),
    link_preview_options: {
      is_disabled: message.link_preview_options?.is_disabled ?? null,
      url: message.link_preview_options?.url ?? null,
      prefer_large_media:
        message.link_preview_options?.prefer_large_media ?? null,
      prefer_small_media:
        message.link_preview_options?.prefer_small_media ?? null,
      show_above_text: message.link_preview_options?.show_above_text ?? null,
    },
  };

  return hashString(stableStringify(canonical));
}

function stableStringify(input: unknown): string {
  return JSON.stringify(input);
}

function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

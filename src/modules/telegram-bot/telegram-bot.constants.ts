export const TELEGRAM_BOT_MODULE_NAME = 'TelegramBot';

export const TELEGRAM_BOT_COMMANDS = {
  start: 'start',
  help: 'help',
} as const;

export const TELEGRAM_BOT_DEFAULT_MODE = 'polling';

export const TELEGRAM_BOT_ALLOWED_UPDATES_DEFAULT = [
  'message',
  'callback_query',
  'channel_post',
  'edited_channel_post',
] as const;

export const TELEGRAM_MINI_APP_ROUTES = {
  marketplace: 'marketplace',
  deals: 'deals',
  channels: 'channels',
} as const;

export const TELEGRAM_SUPPORT_URL_PLACEHOLDER =
  'https://t.me/your_support_handle';

export const TELEGRAM_BOT_RECONNECT_DELAY_MS = 5000;

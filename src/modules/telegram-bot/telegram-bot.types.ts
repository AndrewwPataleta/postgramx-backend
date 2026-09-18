export type TelegramBotMode = 'polling' | 'webhook';

export interface TelegramBotConfig {
  token: string;
  username?: string;
  miniAppUrl?: string;
  mode: TelegramBotMode;
  webhookUrl?: string;
  allowedUpdates: string[];
}

export interface TelegramInlineButton {
  text: string;
  url?: string;
  web_app?: {
    url: string;
  };
  callback_data?: string;
}

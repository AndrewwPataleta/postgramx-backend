declare module 'telegraf' {
  export type MiddlewareFn<TContext = Context> = (
    context: TContext,
    next?: () => Promise<void>,
  ) => unknown;

  export class Telegraf<TContext = Context> {
    constructor(token: string);
    telegram: Telegram;
    use(handler: MiddlewareFn<TContext>): void;
    start(handler: MiddlewareFn<TContext>): void;
    command(command: string, handler: MiddlewareFn<TContext>): void;
    on(event: string, handler: MiddlewareFn<TContext>): void;
    catch(handler: (error: Error, context: TContext) => void): void;
    launch(options?: { allowedUpdates?: readonly string[] }): Promise<void>;
    stop(reason?: string): Promise<void>;
  }

  export interface CallbackQuery {
    data?: string;
  }

  export interface Context {
    updateType?: string;
    callbackQuery: CallbackQuery;
    message: {
      text?: string;
      caption?: string;
      message_id?: number;
      reply_to_message?: { text?: string; caption?: string };
    };
    from?: { id?: number };
    reply(text: string, extra?: unknown): Promise<void>;
    answerCbQuery(): Promise<void>;
  }

  export interface Telegram {
    sendMessage(
      chatId: string,
      text: string,
      options?: {
        reply_markup?: { inline_keyboard: unknown[][] };
        parse_mode?: 'HTML' | 'Markdown';
      },
    ): Promise<unknown>;
    editMessageText(
      chatId: string,
      messageId: number,
      inlineMessageId: string | undefined,
      text: string,
      options?: {
        reply_markup?: { inline_keyboard: unknown[][] };
        parse_mode?: 'HTML' | 'Markdown';
      },
    ): Promise<unknown>;
    sendPhoto(
      chatId: string,
      photo: string,
      options?: {
        caption?: string;
        reply_markup?: { inline_keyboard: unknown[][] };
        parse_mode?: 'HTML' | 'Markdown';
      },
    ): Promise<unknown>;
    sendVideo(
      chatId: string,
      video: string,
      options?: {
        caption?: string;
        reply_markup?: { inline_keyboard: unknown[][] };
        parse_mode?: 'HTML' | 'Markdown';
      },
    ): Promise<unknown>;
  }

  export class Markup {
    static inlineKeyboard(buttons: unknown[][]): unknown;
    static button: {
      url(text: string, url: string): unknown;
      callback(text: string, data: string): unknown;
    };
  }
}

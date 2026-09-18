import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Context, Telegraf } from 'telegraf';
import { HelpHandler } from './handlers/help.handler';
import { StartHandler } from './handlers/start.handler';
import { TELEGRAM_BOT_COMMANDS } from './telegram-bot.constants';
import { DealsBotHandler } from '../deals/deals-bot.handler';
import { DealPostMtprotoMonitorService } from '../telegram-mtproto/services/deal-post-mtproto-monitor.service';
import { TelegramMessengerService } from '../telegram/telegram-messenger.service';

@Injectable()
export class TelegramBotUpdate {
  private readonly logger = new Logger(TelegramBotUpdate.name);

  constructor(
    private readonly startHandler: StartHandler,
    private readonly helpHandler: HelpHandler,
    @Inject(forwardRef(() => TelegramMessengerService))
    private readonly telegramMessengerService: TelegramMessengerService,
    @Inject(forwardRef(() => DealsBotHandler))
    private readonly dealsBotHandler: DealsBotHandler,
    private readonly dealPostMonitorService: DealPostMtprotoMonitorService,
  ) {}

  register(bot: Telegraf<Context>): void {
    bot.use(async (context, next) => {
      const message = context.message as
        | { text?: string; caption?: string; message_id?: number }
        | undefined;
      const callback = context.callbackQuery as
        | { data?: string; message?: { message_id?: number } }
        | undefined;
      const text =
        message?.text ??
        message?.caption ??
        ('data' in (callback ?? {}) ? callback?.data : undefined);
      const messageId = message?.message_id ?? callback?.message?.message_id;
      const fromId = context.from?.id;

      this.logger.log('Telegram update received', {
        updateType: context.updateType,
        fromId,
        text,
        messageId,
      });
      await next?.();
    });

    bot.start(async (context) => {
      const handled = await this.dealsBotHandler.handleStart(context);
      if (handled) {
        return;
      }
      const telegramId = context.from?.id;
      if (!telegramId) {
        return;
      }

      await this.telegramMessengerService.sendInlineKeyboard(
        telegramId,
        'telegram.start.message',
        undefined,
        this.startHandler.getButtons(),
      );
    });

    bot.command(TELEGRAM_BOT_COMMANDS.help, async (context) => {
      const telegramId = context.from?.id;
      if (!telegramId) {
        return;
      }

      await this.telegramMessengerService.sendInlineKeyboard(
        telegramId,
        'telegram.help.message',
        undefined,
        this.helpHandler.getButtons(),
      );
    });

    bot.on('callback_query', async (context) => {
      const data =
        'data' in context.callbackQuery
          ? context.callbackQuery.data
          : undefined;
      if (data === 'help') {
        await context.answerCbQuery();
        const telegramId = context.from?.id;
        if (!telegramId) {
          return;
        }
        await this.telegramMessengerService.sendInlineKeyboard(
          telegramId,
          'telegram.help.message',
          undefined,
          this.helpHandler.getButtons(),
        );
        return;
      }
      if (data === 'about_escrow') {
        await context.answerCbQuery();
        const telegramId = context.from?.id;
        if (!telegramId) {
          return;
        }
        await this.telegramMessengerService.sendText(
          telegramId,
          'telegram.about_escrow.message',
        );
        return;
      }

      if (data?.startsWith('approve_creative:')) {
        const dealId = data.replace('approve_creative:', '').trim();
        const handled =
          await this.dealsBotHandler.handleCreativeApproveCallback(
            context,
            dealId,
          );
        if (handled) {
          return;
        }
      }

      if (data?.startsWith('select_creative:')) {
        const dealId = data.replace('select_creative:', '').trim();
        const handled =
          await this.dealsBotHandler.handleCreativeDealSelectionCallback(
            context,
            dealId,
          );
        if (handled) {
          return;
        }
      }

      if (data?.startsWith('request_changes:')) {
        const dealId = data.replace('request_changes:', '').trim();
        const handled =
          await this.dealsBotHandler.handleCreativeRequestChangesCallback(
            context,
            dealId,
          );
        if (handled) {
          return;
        }
      }

      if (data?.startsWith('reject_creative:')) {
        const dealId = data.replace('reject_creative:', '').trim();
        const handled = await this.dealsBotHandler.handleCreativeRejectCallback(
          context,
          dealId,
        );
        if (handled) {
          return;
        }
      }

      if (data?.startsWith('approve_schedule:')) {
        const dealId = data.replace('approve_schedule:', '').trim();
        const handled =
          await this.dealsBotHandler.handleScheduleApproveCallback(
            context,
            dealId,
          );
        if (handled) {
          return;
        }
      }

      if (data?.startsWith('request_schedule_changes:')) {
        const dealId = data.replace('request_schedule_changes:', '').trim();
        const handled =
          await this.dealsBotHandler.handleScheduleRequestChangesCallback(
            context,
            dealId,
          );
        if (handled) {
          return;
        }
      }

      if (data?.startsWith('reject_schedule:')) {
        const dealId = data.replace('reject_schedule:', '').trim();
        const handled = await this.dealsBotHandler.handleScheduleRejectCallback(
          context,
          dealId,
        );
        if (handled) {
          return;
        }
      }
    });

    bot.on('message', async (context, next) => {
      if ('text' in context.message) {
        await next?.();
        return;
      }

      const handled = await this.dealsBotHandler.handleCreativeMessage(context);
      if (handled) {
        return;
      }
    });

    bot.on('text', async (context) => {
      const messageText = context.message.text?.trim() ?? '';
      if (this.isKnownCommand(messageText)) {
        return;
      }
      const handledChangeRequest =
        await this.dealsBotHandler.handleAdminRequestChangesReply(context);
      if (handledChangeRequest) {
        return;
      }
      const handled = await this.dealsBotHandler.handleCreativeMessage(context);
      if (handled) {
        return;
      }

      if (messageText.startsWith('/')) {
        const telegramId = context.from?.id;
        if (telegramId) {
          await this.telegramMessengerService.sendText(
            telegramId,
            'telegram.errors.unknown_command',
          );
        }
        return;
      }

      const telegramId = context.from?.id;
      if (telegramId) {
        await this.telegramMessengerService.sendText(
          telegramId,
          'telegram.errors.manage_in_app',
        );
      }
    });
  }

  private isKnownCommand(text: string): boolean {
    if (!text.startsWith('/')) {
      return false;
    }

    const command = text.split(' ')[0].replace('/', '').toLowerCase();
    const knownCommands = Object.values(TELEGRAM_BOT_COMMANDS) as string[];
    return knownCommands.includes(command);
  }
}

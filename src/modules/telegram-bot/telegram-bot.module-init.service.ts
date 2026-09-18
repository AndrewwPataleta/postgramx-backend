import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StartHandler } from './handlers/start.handler';
import { HelpHandler } from './handlers/help.handler';
import { DealsBotHandler } from '../deals/deals-bot.handler';
import { TelegramMessengerService } from '../telegram/telegram-messenger.service';

@Injectable()
export class TelegramBotModuleInitService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotModuleInitService.name);

  constructor(
    private readonly startHandler: StartHandler,
    private readonly helpHandler: HelpHandler,
    private readonly telegramMessengerService: TelegramMessengerService,
    private readonly dealsBotHandler: DealsBotHandler,
  ) {}

  onModuleInit(): void {
    this.logger.log('Telegram bot handlers resolved', {
      startHandler: Boolean(this.startHandler),
      helpHandler: Boolean(this.helpHandler),
      telegramMessengerService: Boolean(this.telegramMessengerService),
      dealsBotHandler: Boolean(this.dealsBotHandler),
    });
  }
}

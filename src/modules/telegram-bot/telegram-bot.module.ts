import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HelpHandler } from './handlers/help.handler';
import { StartHandler } from './handlers/start.handler';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotUpdate } from './telegram-bot.update';
import { DealsModule } from '../deals/deals.module';
import { ChannelsModule } from '../channels/channels.module';

import { User } from '../auth/entities/user.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { TelegramBotModuleInitService } from './telegram-bot.module-init.service';
import { MtprotoMonitorModule } from '../telegram-mtproto/mtproto-monitor.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => ChannelsModule),
    TypeOrmModule.forFeature([User]),
    forwardRef(() => DealsModule),
    forwardRef(() => TelegramModule),
    forwardRef(() => MtprotoMonitorModule),
  ],
  providers: [
    TelegramBotService,
    TelegramBotUpdate,
    StartHandler,
    HelpHandler,
    TelegramBotModuleInitService,
  ],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}

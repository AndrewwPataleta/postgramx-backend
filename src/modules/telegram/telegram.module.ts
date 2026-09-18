import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppI18nModule } from '../i18n/app-i18n.module';
import { TelegramService } from './telegram.service';
import { TelegramChatService } from './telegram-chat.service';
import { User } from '../auth/entities/user.entity';
import { TelegramAdminsSyncService } from './telegram-admins-sync.service';
import { ChannelEntity } from '../channels/entities/channel.entity';
import { ChannelTelegramAdminEntity } from '../channels/entities/channel-telegram-admin.entity';
import { TelegramI18nService } from './i18n/telegram-i18n.service';
import { TelegramMessengerService } from './telegram-messenger.service';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';
import { TelegramPermissionsService } from './telegram-permissions.service';
import { ChannelMembershipEntity } from '../channels/entities/channel-membership.entity';
import { TelegramSenderService } from './telegram-sender.service';
import { TelegramApiService } from '../../core/telegram-api.service';
import { TelegramChannelPinsService } from './telegram-channel-pins.service';
import { TelegramChannelPostsService } from './services/telegram-channel-posts.service';

@Module({
  exports: [
    TelegramService,
    TelegramChatService,
    TelegramAdminsSyncService,
    TelegramI18nService,
    TelegramMessengerService,
    TelegramPermissionsService,
    TelegramSenderService,
    TelegramApiService,
    TelegramChannelPinsService,
    TelegramChannelPostsService,
  ],
  imports: [
    AppI18nModule,
    TypeOrmModule.forFeature([
      User,
      ChannelEntity,
      ChannelTelegramAdminEntity,
      ChannelMembershipEntity,
    ]),
    forwardRef(() => TelegramBotModule),
  ],
  providers: [
    TelegramService,
    TelegramChatService,
    TelegramAdminsSyncService,
    TelegramI18nService,
    TelegramMessengerService,
    TelegramPermissionsService,
    TelegramSenderService,
    TelegramApiService,
    TelegramChannelPinsService,
    TelegramChannelPostsService,
  ],
})
export class TelegramModule {}

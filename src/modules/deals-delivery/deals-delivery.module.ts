import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealEntity } from '../deals/entities/deal.entity';
import { DealCreativeEntity } from '../deals/entities/deal-creative.entity';
import { DealEscrowEntity } from '../deals/entities/deal-escrow.entity';
import { DealPublicationEntity } from '../deals/entities/deal-publication.entity';
import { ChannelEntity } from '../channels/entities/channel.entity';
import { User } from '../auth/entities/user.entity';
import { TelegramPosterService } from './services/telegram-poster.service';
import { DealPostingWorker } from './services/deal-posting.worker';
import { TelegramModule } from '../telegram/telegram.module';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';
import { ChannelsModule } from '../channels/channels.module';
import { PaymentsModule } from '../payments/payments.module';
import { DealsModule } from '../deals/deals.module';
import { PostAnalyticsModule } from '../post-analytics/post-analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DealEntity,
      DealCreativeEntity,
      DealEscrowEntity,
      DealPublicationEntity,
      ChannelEntity,
      User,
    ]),
    TelegramModule,
    TelegramBotModule,
    ChannelsModule,
    PaymentsModule,
    DealsModule,
    PostAnalyticsModule,
  ],
  providers: [TelegramPosterService, DealPostingWorker],
})
export class DealDeliveryMonitorModule {}

import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealEntity } from '../deals/entities/deal.entity';
import { DealPublicationEntity } from '../deals/entities/deal-publication.entity';
import { DealCreativeEntity } from '../deals/entities/deal-creative.entity';
import { PostAnalyticsService } from './services/post-analytics.service';
import { DealPostAnalyticsEntity } from './entities/deal-post-analytics.entity';
import { DealPostAnalyticsLinkEntity } from './entities/deal-post-analytics-link.entity';
import { DealPostAnalyticsSnapshotEntity } from './entities/deal-post-analytics-snapshot.entity';
import { MTProtoStatsService } from './services/mtproto-stats.service';
import { TelegramMessageStatsService } from './services/telegram-message-stats.service';
import { TelegramModule } from '../telegram/telegram.module';
import { PostAnalyticsCronService } from './services/post-analytics-cron.service';
import { MtprotoMonitorModule } from '../telegram-mtproto/mtproto-monitor.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DealEntity,
      DealCreativeEntity,
      DealPublicationEntity,
      DealPostAnalyticsEntity,
      DealPostAnalyticsLinkEntity,
      DealPostAnalyticsSnapshotEntity,
    ]),
    forwardRef(() => TelegramModule),
    forwardRef(() => MtprotoMonitorModule),
  ],
  providers: [
    PostAnalyticsService,
    MTProtoStatsService,
    TelegramMessageStatsService,
    PostAnalyticsCronService,
  ],
  exports: [PostAnalyticsService],
})
export class PostAnalyticsModule {}

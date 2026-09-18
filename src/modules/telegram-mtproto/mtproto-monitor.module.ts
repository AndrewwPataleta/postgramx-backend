import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealEntity } from '../deals/entities/deal.entity';
import { DealPublicationEntity } from '../deals/entities/deal-publication.entity';
import { MtprotoClientService } from './services/mtproto-client.service';
import { MtprotoPeerResolverService } from './services/mtproto-peer-resolver.service';
import { DealPostMtprotoMonitorService } from './services/deal-post-mtproto-monitor.service';
import { DealsModule } from '../deals/deals.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DealEntity, DealPublicationEntity]),
    forwardRef(() => DealsModule),
  ],
  providers: [
    MtprotoClientService,
    MtprotoPeerResolverService,
    DealPostMtprotoMonitorService,
  ],
  exports: [DealPostMtprotoMonitorService, MtprotoClientService],
})
export class MtprotoMonitorModule {}

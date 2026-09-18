import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelEntity } from '../channels/entities/channel.entity';
import { ChannelMembershipEntity } from '../channels/entities/channel-membership.entity';
import { ListingEntity } from './entities/listing.entity';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ListingEntity,
      ChannelEntity,
      ChannelMembershipEntity,
    ]),
  ],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}

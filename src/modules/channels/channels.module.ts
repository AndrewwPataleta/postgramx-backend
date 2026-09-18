import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsController } from './channels.controller';
import { ChannelModeratorsController } from './channel-moderators.controller';
import { ChannelsService } from './channels.service';
import { ChannelEntity } from './entities/channel.entity';
import { ChannelMembershipEntity } from './entities/channel-membership.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { ChannelTelegramAdminEntity } from './entities/channel-telegram-admin.entity';
import { MembershipsAutoLinkService } from './memberships-auto-link.service';
import { ChannelAdminRecheckService } from './guards/channel-admin-recheck.service';
import { ListingEntity } from '../listings/entities/listing.entity';
import { ChannelParticipantsService } from './channel-participants.service';
import { User } from '../auth/entities/user.entity';
import { ChannelModeratorsService } from './channel-moderators.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChannelEntity,
      ChannelMembershipEntity,
      ChannelTelegramAdminEntity,
      ListingEntity,
      User,
    ]),
    TelegramModule,
  ],
  controllers: [ChannelsController, ChannelModeratorsController],
  providers: [
    ChannelsService,
    MembershipsAutoLinkService,
    ChannelAdminRecheckService,
    ChannelParticipantsService,
    ChannelModeratorsService,
  ],
  exports: [
    ChannelsService,
    MembershipsAutoLinkService,
    ChannelAdminRecheckService,
    ChannelParticipantsService,
    ChannelModeratorsService,
  ],
})
export class ChannelsModule {}

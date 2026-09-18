import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChannelMembershipEntity } from './entities/channel-membership.entity';
import {
  ChannelTelegramAdminEntity,
  TelegramAdminRole,
} from './entities/channel-telegram-admin.entity';
import { ChannelEntity } from './entities/channel.entity';
import { ChannelRole } from './types/channel-role.enum';

@Injectable()
export class MembershipsAutoLinkService {
  constructor(
    @InjectRepository(ChannelTelegramAdminEntity)
    private readonly telegramAdminRepository: Repository<ChannelTelegramAdminEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
  ) {}

  async autoLinkMembershipsForTelegramAdmin(
    userId: string,
    telegramId: number | string,
  ): Promise<number> {
    const telegramUserId = String(telegramId);
    const adminSnapshots = await this.telegramAdminRepository.find({
      where: {
        telegramUserId,
        isActive: true,
        isBot: false,
      },
    });

    if (adminSnapshots.length === 0) {
      return 0;
    }

    const channelIds = Array.from(
      new Set(adminSnapshots.map((admin) => admin.channelId)),
    );

    const [channels, memberships] = await Promise.all([
      this.channelRepository.find({ where: { id: In(channelIds) } }),
      this.membershipRepository.find({
        where: { userId, channelId: In(channelIds) },
      }),
    ]);

    const channelMap = new Map(
      channels.map((channel) => [channel.id, channel]),
    );
    const membershipMap = new Map(
      memberships.map((membership) => [membership.channelId, membership]),
    );

    let updatedCount = 0;
    const toSave: ChannelMembershipEntity[] = [];

    for (const admin of adminSnapshots) {
      const channel = channelMap.get(admin.channelId);
      if (!channel) {
        continue;
      }

      const existing = membershipMap.get(admin.channelId);
      const shouldBeOwner =
        admin.telegramRole === TelegramAdminRole.CREATOR &&
        (channel.ownerUserId ?? channel.createdByUserId) === userId;

      if (!existing) {
        const created = this.membershipRepository.create({
          channelId: admin.channelId,
          userId,
          role: shouldBeOwner ? ChannelRole.OWNER : ChannelRole.MODERATOR,
          isActive: true,
          isManuallyDisabled: false,
          canReviewDeals: true,
          telegramUserId: admin.telegramUserId,
        });
        toSave.push(created);
        updatedCount += 1;
        continue;
      }

      if (existing.isManuallyDisabled) {
        continue;
      }

      let changed = false;

      if (!existing.telegramUserId) {
        existing.telegramUserId = admin.telegramUserId;
        changed = true;
      }

      if (!existing.isActive) {
        existing.isActive = true;
        changed = true;
      }

      if (shouldBeOwner && existing.role !== ChannelRole.OWNER) {
        existing.role = ChannelRole.OWNER;
        changed = true;
      }

      if (changed) {
        toSave.push(existing);
        updatedCount += 1;
      }
    }

    if (toSave.length > 0) {
      await this.membershipRepository.save(toSave);
    }

    return updatedCount;
  }
}

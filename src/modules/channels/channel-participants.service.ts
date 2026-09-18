import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChannelEntity } from './entities/channel.entity';
import { ChannelMembershipEntity } from './entities/channel-membership.entity';
import { ChannelRole } from './types/channel-role.enum';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class ChannelParticipantsService {
  private readonly logger = new Logger(ChannelParticipantsService.name);

  constructor(
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getNotificationRecipients(channelId: string): Promise<User[]> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      this.logger.warn(
        `Channel not found while resolving recipients: channelId=${channelId}`,
      );
      return [];
    }

    const memberships = await this.membershipRepository.find({
      where: {
        channelId,
        isActive: true,
        isManuallyDisabled: false,
        role: In([ChannelRole.OWNER, ChannelRole.MODERATOR]),
      },
    });

    const userIds = new Set<string>([channel.ownerUserId]);
    for (const membership of memberships) {
      if (membership.userId) {
        userIds.add(membership.userId);
      }
    }

    const ids = Array.from(userIds).filter(Boolean);
    if (ids.length === 0) {
      return [];
    }

    const users = await this.userRepository.find({
      where: { id: In(ids) },
    });

    const unique = new Map<string, User>();
    for (const user of users) {
      if (!user.telegramId) {
        continue;
      }
      unique.set(user.id, user);
    }

    return Array.from(unique.values());
  }

  async getDealReviewers(
    channelId: string,
    includeAllReviewers: boolean,
  ): Promise<User[]> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      this.logger.warn(
        `Channel not found while resolving reviewers: channelId=${channelId}`,
      );
      return [];
    }

    const membershipWhere: Record<string, any> = {
      channelId,
      isActive: true,
      isManuallyDisabled: false,
      role: In([ChannelRole.OWNER, ChannelRole.MODERATOR]),
    };

    if (!includeAllReviewers) {
      membershipWhere.canReviewDeals = true;
    }

    const memberships = await this.membershipRepository.find({
      where: membershipWhere,
    });

    const userIds = new Set<string>([channel.ownerUserId]);
    for (const membership of memberships) {
      if (membership.userId) {
        userIds.add(membership.userId);
      }
    }

    const ids = Array.from(userIds).filter(Boolean);
    if (ids.length === 0) {
      return [];
    }

    const users = await this.userRepository.find({
      where: { id: In(ids) },
    });

    const unique = new Map<string, User>();
    for (const user of users) {
      if (!user.telegramId) {
        continue;
      }
      unique.set(user.id, user);
    }

    return Array.from(unique.values());
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DealPublicationEntity } from '../../deals/entities/deal-publication.entity';
import { DealEntity } from '../../deals/entities/deal.entity';
import { DealCreativeEntity } from '../../deals/entities/deal-creative.entity';
import { PAYMENTS_CONFIG } from '../../../config/payments.config';
import {
  DealPostAnalyticsLinkTrackingStatus,
  DealPostAnalyticsLinkType,
  DealPostAnalyticsTrackingStatus,
  POST_ANALYTICS_CONFIG_DEFAULTS,
} from '../../../common/constants/post-analytics/post-analytics.constants';
import { DealPostAnalyticsEntity } from '../entities/deal-post-analytics.entity';
import { DealPostAnalyticsLinkEntity } from '../entities/deal-post-analytics-link.entity';
import { DealPostAnalyticsSnapshotEntity } from '../entities/deal-post-analytics-snapshot.entity';
import { MTProtoStatsService } from './mtproto-stats.service';
import { TelegramMessageStatsService } from './telegram-message-stats.service';

@Injectable()
export class PostAnalyticsService {
  private readonly logger = new Logger(PostAnalyticsService.name);
  private readonly enabled =
    (process.env.POST_ANALYTICS_ENABLED ?? 'true').toLowerCase() !== 'false';
  private readonly defaultWindowHours = Number(
    process.env.POST_ANALYTICS_DEFAULT_WINDOW_HOURS ??
      POST_ANALYTICS_CONFIG_DEFAULTS.DEFAULT_WINDOW_HOURS,
  );

  constructor(
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(DealPublicationEntity)
    private readonly publicationRepository: Repository<DealPublicationEntity>,
    @InjectRepository(DealCreativeEntity)
    private readonly creativeRepository: Repository<DealCreativeEntity>,
    @InjectRepository(DealPostAnalyticsEntity)
    private readonly analyticsRepository: Repository<DealPostAnalyticsEntity>,
    @InjectRepository(DealPostAnalyticsLinkEntity)
    private readonly linksRepository: Repository<DealPostAnalyticsLinkEntity>,
    @InjectRepository(DealPostAnalyticsSnapshotEntity)
    private readonly snapshotsRepository: Repository<DealPostAnalyticsSnapshotEntity>,
    private readonly mtprotoStatsService: MTProtoStatsService,
    private readonly telegramMessageStatsService: TelegramMessageStatsService,
    private readonly dataSource: DataSource,
  ) {}

  async startTrackingForDeal(dealId: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const existing = await this.analyticsRepository.findOne({
      where: { dealId },
    });
    if (existing) {
      if (existing.trackingStatus === DealPostAnalyticsTrackingStatus.ACTIVE) {
        return;
      }
      if (
        existing.trackingStatus === DealPostAnalyticsTrackingStatus.COMPLETED
      ) {
        return;
      }
    }

    const deal = await this.dealRepository.findOne({ where: { id: dealId } });
    const publication = await this.publicationRepository.findOne({
      where: { dealId },
    });

    if (
      !deal ||
      !publication?.telegramChatId ||
      !publication.telegramMessageId
    ) {
      return;
    }

    const postedAt =
      publication.postedAt ?? publication.publishedAt ?? new Date();
    const listingSnapshot = deal.listingSnapshot as {
      visibilityDurationHours?: number;
    };
    const visibilityHours = Number(
      listingSnapshot?.visibilityDurationHours ?? 0,
    );
    const endsAt = new Date(
      postedAt.getTime() +
        (visibilityHours > 0
          ? visibilityHours
          : PAYMENTS_CONFIG.VERIFY_WINDOW_HOURS || this.defaultWindowHours) *
          60 *
          60 *
          1000,
    );

    const analytics = this.analyticsRepository.create({
      dealId,
      channelId: deal.channelId,
      telegramChatId: publication.telegramChatId,
      telegramMessageId: publication.telegramMessageId,
      trackingStatus: DealPostAnalyticsTrackingStatus.ACTIVE,
      startedAt: postedAt,
      endsAt,
    });
    const savedAnalytics = await this.analyticsRepository.save(analytics);

    const adText = await this.getAdTextForDeal(dealId);
    const links = this.extractTelegramChannelLinks(adText);
    await this.createTrackedLinks(savedAnalytics.id, links);
    await this.recordBaselineSubscribers(savedAnalytics.id);
  }

  extractTelegramChannelLinks(text: string): string[] {
    const result = new Set<string>();
    const regex =
      /(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{5,32})\b|@([a-zA-Z0-9_]{5,32})\b/g;

    for (const match of text.matchAll(regex)) {
      const username = (match[1] || match[2] || '').toLowerCase();
      if (!username) {
        continue;
      }
      result.add(username);
    }

    return Array.from(result);
  }

  async sampleViews(analytics: DealPostAnalyticsEntity): Promise<void> {
    const views = await this.telegramMessageStatsService.getMessageViews(
      analytics.telegramChatId,
      analytics.telegramMessageId,
    );
    const sampledAt = new Date();

    await this.snapshotsRepository.save(
      this.snapshotsRepository.create({
        dealPostAnalyticsId: analytics.id,
        sampledAt,
        views: views !== null ? String(views) : null,
      }),
    );

    await this.analyticsRepository.update(analytics.id, {
      lastSampledAt: sampledAt,
      lastError: views === null ? 'Views unavailable' : null,
    });
  }

  async finalizeTracking(analyticsId: string, reason?: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const analyticsRepo = manager.getRepository(DealPostAnalyticsEntity);
      const linksRepo = manager.getRepository(DealPostAnalyticsLinkEntity);
      const analytics = await analyticsRepo.findOne({
        where: { id: analyticsId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!analytics) {
        return;
      }
      if (
        analytics.trackingStatus === DealPostAnalyticsTrackingStatus.COMPLETED
      ) {
        return;
      }

      const views = await this.telegramMessageStatsService.getMessageViews(
        analytics.telegramChatId,
        analytics.telegramMessageId,
      );

      const links = await linksRepo.find({
        where: { dealPostAnalyticsId: analytics.id },
      });

      for (const link of links) {
        if (!link.normalizedChannelUsername) {
          await linksRepo.update(link.id, {
            trackingStatus: DealPostAnalyticsLinkTrackingStatus.UNAVAILABLE,
            lastError: 'Channel username unavailable',
          });
          continue;
        }

        const count =
          await this.mtprotoStatsService.getChannelMembersCountByUsername(
            link.normalizedChannelUsername,
          );
        if (count === null) {
          await linksRepo.update(link.id, {
            trackingStatus: DealPostAnalyticsLinkTrackingStatus.UNAVAILABLE,
            lastError: 'MTProto unavailable',
          });
          continue;
        }

        const baseline = link.baselineSubscribers ?? count;
        await linksRepo.update(link.id, {
          finalSubscribers: count,
          subscribersDelta: Math.max(0, count - baseline),
          trackingStatus: DealPostAnalyticsLinkTrackingStatus.COMPLETED,
          lastError: null,
        });
      }

      await analyticsRepo.update(analytics.id, {
        trackingStatus: DealPostAnalyticsTrackingStatus.COMPLETED,
        finalViews: views !== null ? String(views) : analytics.finalViews,
        finalAt: new Date(),
        lastError:
          reason ?? (views === null ? 'Views unavailable on finalize' : null),
      });
    });
  }

  async getDealAnalytics(dealId: string) {
    const analytics = await this.analyticsRepository.findOne({
      where: { dealId },
      relations: ['links'],
    });
    if (!analytics) {
      return null;
    }

    const snapshots = await this.snapshotsRepository.find({
      where: { dealPostAnalyticsId: analytics.id },
      order: { sampledAt: 'DESC' },
      take: 50,
    });

    return {
      dealId: analytics.dealId,
      trackingStatus: analytics.trackingStatus,
      startedAt: analytics.startedAt,
      endsAt: analytics.endsAt,
      finalViews:
        analytics.finalViews !== null
          ? Number(analytics.finalViews)
          : snapshots[0]?.views
            ? Number(snapshots[0].views)
            : null,
      links: analytics.links.map((link) => ({
        rawUrl: link.rawUrl,
        normalizedChannelUsername: link.normalizedChannelUsername,
        baselineSubscribers: link.baselineSubscribers,
        finalSubscribers: link.finalSubscribers,
        subscribersDelta: link.subscribersDelta,
        attributionMethod: link.attributionMethod,
        trackingStatus: link.trackingStatus,
      })),
      snapshots: snapshots.reverse().map((snapshot) => ({
        sampledAt: snapshot.sampledAt,
        views: snapshot.views !== null ? Number(snapshot.views) : null,
      })),
    };
  }

  async sampleActiveBatch(limit = 50): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const now = new Date();
    const items = await this.analyticsRepository.find({
      where: {
        trackingStatus: DealPostAnalyticsTrackingStatus.ACTIVE,
      },
      order: { endsAt: 'ASC' },
      take: limit,
    });

    for (const item of items) {
      if (item.endsAt <= now) {
        continue;
      }
      try {
        await this.sampleViews(item);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.analyticsRepository.update(item.id, { lastError: message });
      }
    }
  }

  async finalizeDueBatch(limit = 50): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const now = new Date();
    const items = await this.analyticsRepository.find({
      where: {
        trackingStatus: DealPostAnalyticsTrackingStatus.ACTIVE,
      },
      order: { endsAt: 'ASC' },
      take: limit,
    });

    for (const item of items) {
      if (item.endsAt > now) {
        continue;
      }
      try {
        await this.finalizeTracking(item.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.analyticsRepository.update(item.id, { lastError: message });
      }
    }
  }

  async finalizeForDeal(dealId: string, reason: string): Promise<void> {
    const analytics = await this.analyticsRepository.findOne({
      where: { dealId },
    });
    if (!analytics) {
      return;
    }
    await this.finalizeTracking(analytics.id, reason);
  }

  private async createTrackedLinks(
    dealPostAnalyticsId: string,
    usernames: string[],
  ): Promise<void> {
    if (!usernames.length) {
      return;
    }

    const entities = usernames.map((username) =>
      this.linksRepository.create({
        dealPostAnalyticsId,
        linkType: DealPostAnalyticsLinkType.TG_CHANNEL,
        rawUrl: `https://t.me/${username}`,
        normalizedChannelUsername: username,
        trackingStatus: DealPostAnalyticsLinkTrackingStatus.ACTIVE,
        attributionMethod: 'DELTA_SUBSCRIBERS',
      }),
    );

    await this.linksRepository.save(entities);
  }

  private async recordBaselineSubscribers(
    dealPostAnalyticsId: string,
  ): Promise<void> {
    const links = await this.linksRepository.find({
      where: { dealPostAnalyticsId },
    });

    for (const link of links) {
      if (!link.normalizedChannelUsername) {
        continue;
      }
      const [count, chatId] = await Promise.all([
        this.mtprotoStatsService.getChannelMembersCountByUsername(
          link.normalizedChannelUsername,
        ),
        this.mtprotoStatsService.resolveUsernameToChatId(
          link.normalizedChannelUsername,
        ),
      ]);
      if (count === null) {
        await this.linksRepository.update(link.id, {
          trackingStatus: DealPostAnalyticsLinkTrackingStatus.UNAVAILABLE,
          lastError: 'MTProto unavailable',
        });
        continue;
      }

      await this.linksRepository.update(link.id, {
        baselineSubscribers: count,
        resolvedTelegramChatId: chatId,
        trackingStatus: DealPostAnalyticsLinkTrackingStatus.ACTIVE,
        lastError: null,
      });
    }
  }

  private async getAdTextForDeal(dealId: string): Promise<string> {
    const creative = await this.creativeRepository.findOne({
      where: { dealId },
      order: { version: 'DESC' },
    });
    const payload = (creative?.payload ?? null) as {
      text?: string;
      caption?: string;
    } | null;

    return payload?.text || payload?.caption || '';
  }
}

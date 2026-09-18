import type { QueryDeepPartialEntity } from '../../../core/typeorm.types';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { DealEntity } from '../../deals/entities/deal.entity';
import { DealCreativeEntity } from '../../deals/entities/deal-creative.entity';
import { DealEscrowEntity } from '../../deals/entities/deal-escrow.entity';
import { DealPublicationEntity } from '../../deals/entities/deal-publication.entity';
import { ChannelEntity } from '../../channels/entities/channel.entity';
import { DealStage } from '../../../common/constants/deals/deal-stage.constants';
import { DealStatus } from '../../../common/constants/deals/deal-status.constants';
import { EscrowStatus } from '../../../common/constants/deals/deal-escrow-status.constants';
import { CreativeStatus } from '../../../common/constants/deals/creative-status.constants';
import { PublicationStatus } from '../../../common/constants/deals/publication-status.constants';
import { PinVisibilityStatus } from '../../../common/constants/deals/pin-visibility-status.constants';
import { TelegramPosterService } from './telegram-poster.service';
import { PaymentsService } from '../../payments/payments.service';
import { DealsNotificationsService } from '../../deals/deals-notifications.service';
import { DEALS_CONFIG } from '../../../config/deals.config';
import { TelegramPermissionsService } from '../../telegram/telegram-permissions.service';
import { PAYMENTS_CONFIG } from '../../../config/payments.config';
import { DEAL_PUBLICATION_ERRORS } from '../../../common/constants/deals/deal-publication-errors.constants';
import { PostAnalyticsService } from '../../post-analytics/services/post-analytics.service';
import { DEAL_DELIVERY_POSTING_CRON } from '../../../config/deal-delivery.config';
import { TelegramChannelPostsService } from '../../telegram/services/telegram-channel-posts.service';
import {
  fingerprintEntities,
  fingerprintKeyboard,
  fingerprintMedia,
  normalizeText,
} from '../../deals/publication/telegramMessageFingerprint';
import { buildMessageFingerprintHash } from '../../telegram-mtproto/utils/message-fingerprint.util';

const POST_VERIFICATION_CRON =
  process.env.DEALS_POST_VERIFICATION_CRON ??
  (process.env.NODE_ENV === 'production' ? '0 */30 * * * *' : '0 * * * * *');

@Injectable()
export class DealPostingWorker {
  private readonly logger = new Logger(DealPostingWorker.name);

  constructor(
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepository: Repository<DealEscrowEntity>,
    @InjectRepository(DealCreativeEntity)
    private readonly creativeRepository: Repository<DealCreativeEntity>,
    @InjectRepository(DealPublicationEntity)
    private readonly publicationRepository: Repository<DealPublicationEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    private readonly telegramPosterService: TelegramPosterService,
    private readonly paymentsService: PaymentsService,
    private readonly dealsNotificationsService: DealsNotificationsService,
    private readonly telegramPermissionsService: TelegramPermissionsService,
    private readonly postAnalyticsService: PostAnalyticsService,
    private readonly telegramChannelPostsService: TelegramChannelPostsService,
  ) {}

  @Cron(DEAL_DELIVERY_POSTING_CRON)
  async handlePostingCron(): Promise<void> {
    const now = new Date();
    const deals = await this.dealRepository.find({
      where: {
        stage: DealStage.POST_SCHEDULED,
        scheduledAt: LessThanOrEqual(now),
      },
    });

    this.logger.log(
      `Posting worker tick: ${deals.length} deals ready for publish`,
    );

    for (const deal of deals) {
      await this.publishDeal(deal.id);
    }
  }

  @Cron(POST_VERIFICATION_CRON)
  async handleVerificationCron(): Promise<void> {
    const now = new Date();
    const deals = await this.dealRepository.find({
      where: [
        { stage: DealStage.POSTED_VERIFYING },
        { stage: DealStage.DELIVERY_CONFIRMED },
      ],
    });

    this.logger.log(
      `Verification worker tick: ${deals.length} deals to verify`,
    );

    for (const deal of deals) {
      await this.verifyDeal(deal.id, now);
    }
  }

  private async publishDeal(dealId: string): Promise<void> {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });
    if (!deal) {
      return;
    }

    const escrow = await this.escrowRepository.findOne({
      where: { dealId: deal.id },
    });
    if (!escrow || escrow.status !== EscrowStatus.PAID_HELD) {
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });
    if (!channel) {
      return;
    }

    const permissionCheck = await this.ensurePermissions(deal, 'publish');
    if (!permissionCheck.ok) {
      return;
    }

    const rights = await this.telegramPosterService.checkCanPost(channel);
    if (!rights.ok) {
      this.logger.warn(
        `Posting failed: bot not admin for deal ${deal.id}, reason=${rights.reason}`,
      );
      await this.upsertPublication(deal.id, {
        status: PublicationStatus.FAILED,
        error: 'BOT_NOT_ADMIN',
      });
      await this.paymentsService.refundEscrow(deal.id, 'BOT_NOT_ADMIN');
      await this.dealRepository.update(deal.id, {
        stage: DealStage.FINALIZED,
        status: DealStatus.CANCELED,
      });
      await this.dealsNotificationsService.notifyPostNotPublishedAdmin(deal);
      await this.dealsNotificationsService.notifyAdvertiser(
        deal,
        'telegram.deal.post.not_published_advertiser',
      );
      return;
    }

    const creative = await this.creativeRepository.findOne({
      where: { dealId: deal.id, status: CreativeStatus.APPROVED },
      order: { version: 'DESC' },
    });
    if (!creative) {
      return;
    }

    try {
      await this.dealRepository.update(deal.id, {
        stage: DealStage.POST_PUBLISHING,
      });
      const result = await this.telegramPosterService.publishCreativeToChannel(
        deal,
        creative,
        channel,
      );

      const publishedAt = new Date();
      const listingSnapshot = deal.listingSnapshot as {
        pinDurationHours?: number;
        visibilityDurationHours?: number;
      };
      const windowHours =
        listingSnapshot.pinDurationHours ??
        listingSnapshot.visibilityDurationHours ??
        PAYMENTS_CONFIG.VERIFY_WINDOW_HOURS;
      const mustRemainUntil = windowHours
        ? new Date(publishedAt.getTime() + windowHours * 60 * 60 * 1000)
        : null;
      const pinDurationHours = listingSnapshot.pinDurationHours ?? 0;
      const pinMonitoringEndsAt =
        pinDurationHours > 0
          ? new Date(publishedAt.getTime() + pinDurationHours * 60 * 60 * 1000)
          : null;
      const pinVisibilityStatus =
        pinDurationHours > 0
          ? PinVisibilityStatus.MONITORING
          : PinVisibilityStatus.NOT_REQUIRED;

      await this.upsertPublication(deal.id, {
        status: PublicationStatus.POSTED,
        publishedMessageId: String(result.message_id),
        publishedAt,
        mustRemainUntil,
        telegramChatId: channel.telegramChatId ?? channel.username ?? null,
        telegramMessageId: String(result.message_id),
        postedAt: publishedAt,
        pinVisibilityStatus,
        pinMonitoringEndsAt,
      });

      await this.capturePublicationSnapshot(
        deal.id,
        channel,
        creative,
        String(result.message_id),
      );

      if (DEALS_CONFIG.AUTO_DEAL_COMPLETE) {
        await this.dealRepository.update(deal.id, {
          stage: DealStage.FINALIZED,
          status: DealStatus.COMPLETED,
        });
      } else {
        await this.dealRepository.update(deal.id, {
          stage: DealStage.POSTED_VERIFYING,
          status: DealStatus.ACTIVE,
        });
      }

      await this.dealsNotificationsService.notifyPostPublishedAdvertiser(
        deal,
        mustRemainUntil,
        this.buildTelegramPostUrl(channel, String(result.message_id)),
      );
      await this.dealsNotificationsService.notifyPostPublishedAdmin(deal);
      await this.postAnalyticsService.startTrackingForDeal(deal.id);

      if (DEALS_CONFIG.AUTO_DEAL_COMPLETE) {
        const publication = await this.publicationRepository.findOne({
          where: { dealId: deal.id },
        });
        if (publication) {
          await this.finalizeDeal({
            deal,
            publication,
            now: publishedAt,
            deleteMessage: false,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Posting failed for deal ${deal.id}: ${message}`);
      await this.upsertPublication(deal.id, {
        status: PublicationStatus.FAILED,
        error: message,
      });
      await this.paymentsService.refundEscrow(deal.id, 'POST_FAILED');
      await this.dealRepository.update(deal.id, {
        stage: DealStage.FINALIZED,
        status: DealStatus.CANCELED,
      });
    }
  }

  private async verifyDeal(dealId: string, now: Date): Promise<void> {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });
    if (!deal) {
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });

    const publication = await this.publicationRepository.findOne({
      where: { dealId: deal.id },
    });
    if (!publication || !publication.mustRemainUntil) {
      return;
    }

    if (publication.error === DEAL_PUBLICATION_ERRORS.POST_EDITED) {
      await this.cancelDealForPublicationViolation({
        deal,
        publication,
        now,
        refundReason: DEAL_PUBLICATION_ERRORS.POST_EDITED,
        advertiserMessageKey: 'telegram.deal.post.edited_advertiser',
        notifyAdmin: () =>
          this.dealsNotificationsService.notifyPostEditedAdmin(deal),
      });
      return;
    }

    if (publication.error === 'POST_DELETED') {
      await this.cancelDealForPublicationViolation({
        deal,
        publication,
        now,
        refundReason: 'POST_DELETED',
        advertiserMessageKey: 'telegram.deal.post.deleted_advertiser',
        notifyAdmin: () =>
          this.dealsNotificationsService.notifyPostDeletedAdmin(deal),
      });
      return;
    }

    if (now < publication.mustRemainUntil) {
      await this.publicationRepository.update(publication.id, {
        lastCheckedAt: now,
      });
      return;
    }

    await this.finalizeDeal({
      deal,
      publication,
      channel: channel ?? undefined,
      now,
      deleteMessage: true,
    });
  }

  private buildTelegramPostUrl(
    channel: ChannelEntity,
    messageId: string,
  ): string | null {
    if (channel.username) {
      return `https://t.me/${channel.username}/${messageId}`;
    }

    if (channel.telegramChatId?.startsWith('-100')) {
      return `https://t.me/c/${channel.telegramChatId.slice(4)}/${messageId}`;
    }

    return null;
  }

  private async cancelDealForPublicationViolation({
    deal,
    publication,
    now,
    refundReason,
    advertiserMessageKey,
    notifyAdmin,
  }: {
    deal: DealEntity;
    publication: DealPublicationEntity;
    now: Date;
    refundReason: string;
    advertiserMessageKey: string;
    notifyAdmin: () => Promise<void>;
  }): Promise<void> {
    await this.publicationRepository.update(publication.id, {
      status: PublicationStatus.DELETED_OR_EDITED,
      lastCheckedAt: now,
    });
    await this.paymentsService.refundEscrow(deal.id, refundReason);
    await this.dealRepository.update(deal.id, {
      stage: DealStage.FINALIZED,
      status: DealStatus.CANCELED,
      cancelReason: refundReason,
    });
    await notifyAdmin();
    await this.dealsNotificationsService.notifyAdvertiser(
      deal,
      advertiserMessageKey,
    );
    await this.postAnalyticsService.finalizeForDeal(deal.id, 'EARLY_REMOVAL');
  }

  private async finalizeDeal({
    deal,
    publication,
    channel,
    now,
    deleteMessage,
  }: {
    deal: DealEntity;
    publication: DealPublicationEntity;
    channel?: ChannelEntity;
    now: Date;
    deleteMessage: boolean;
  }): Promise<void> {
    await this.publicationRepository.update(publication.id, {
      lastCheckedAt: now,
    });
    await this.publicationRepository.update(publication.id, {
      status: PublicationStatus.VERIFIED,
      verifiedAt: now,
    });

    await this.dealRepository.update(deal.id, {
      stage: DealStage.FINALIZED,
      status: DealStatus.COMPLETED,
    });

    await this.postAnalyticsService.finalizeForDeal(
      deal.id,
      deleteMessage ? 'WINDOW_ENDED' : 'AUTO_COMPLETED',
    );

    const analytics = await this.postAnalyticsService.getDealAnalytics(deal.id);
    if (analytics) {
      const subscribersDelta = analytics.links.reduce(
        (sum, link) => sum + (link.subscribersDelta ?? 0),
        0,
      );

      await this.dealsNotificationsService.notifyDealCompletedStatsAdvertiser(
        deal,
        {
          views: analytics.finalViews,
          trackedChannels: analytics.links.length,
          subscribersDelta,
        },
      );

      await this.dealsNotificationsService.notifyDealCompletedStatsAdmin(deal, {
        views: analytics.finalViews,
        trackedChannels: analytics.links.length,
        subscribersDelta,
      });
    }

    const escrow = await this.escrowRepository.findOne({
      where: { dealId: deal.id },
    });

    await this.paymentsService.markEscrowPayoutPending(deal.id);

    await this.dealsNotificationsService.notifyAdvertiser(
      deal,
      'telegram.deal.post.delivery_confirmed',
    );

    if (escrow?.currency && (escrow.paidNano || escrow.amountNano)) {
      await this.dealsNotificationsService.notifyDealCompletedAdvertiser(
        deal,
        escrow.paidNano ?? escrow.amountNano,
        escrow.currency,
      );
    } else {
      await this.dealsNotificationsService.notifyAdvertiser(
        deal,
        'telegram.deal.post.completed_advertiser',
      );
    }

    if (escrow?.currency && (escrow.paidNano || escrow.amountNano)) {
      await this.dealsNotificationsService.notifyDealCompletedAdmin(
        deal,
        escrow.paidNano ?? escrow.amountNano,
        escrow.currency,
      );
    }

    if (deleteMessage && publication.publishedMessageId && channel) {
      try {
        await this.telegramPosterService.deleteChannelMessage(
          channel,
          publication.publishedMessageId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to delete published message for deal ${deal.id}: ${message}`,
        );
        await this.dealsNotificationsService.notifyPostDeleteFailedAdmin(deal);
      }
    }
  }

  private async capturePublicationSnapshot(
    dealId: string,
    channel: ChannelEntity,
    creative: DealCreativeEntity,
    messageId: string,
  ): Promise<void> {
    const chatId =
      channel.telegramChatId ??
      (channel.username ? `@${channel.username}` : null);

    try {
      if (!chatId) {
        throw new Error('CHANNEL_CHAT_ID_MISSING');
      }

      const message = await this.telegramChannelPostsService.getChannelMessage(
        chatId,
        messageId,
      );

      if (!message) {
        throw new Error('MESSAGE_NOT_FOUND');
      }

      const mediaFingerprint = fingerprintMedia(message);
      const entitiesFingerprint = fingerprintEntities(message);
      await this.upsertPublication(dealId, {
        publishedMessageText: normalizeText(message.text),
        publishedMessageCaption: normalizeText(message.caption),
        publishedMessageMediaFingerprint: mediaFingerprint,
        publishedMessageKeyboardFingerprint: fingerprintKeyboard(message),
        publishedMessageHash: buildMessageFingerprintHash({
          text: normalizeText(message.text) || normalizeText(message.caption),
          mediaUniqueId: mediaFingerprint,
          entitiesSignature: entitiesFingerprint,
        }),
        publishedMessageSnapshotJson: {
          source: 'telegram_api',
          text: message.text ?? null,
          caption: message.caption ?? null,
          mediaFingerprint: fingerprintMedia(message),
          keyboard: message.reply_markup?.inline_keyboard ?? null,
          entitiesFingerprint,
        },
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to fetch published message snapshot for deal ${dealId}: ${message}`,
      );
    }

    const payload = (creative.payload ?? {}) as Record<string, unknown>;
    const textFallback = String(payload.text ?? '');
    const captionFallback = String(payload.caption ?? payload.text ?? '');
    const mediaType = payload.type ? String(payload.type) : null;
    const mediaFileId = payload.mediaFileId
      ? String(payload.mediaFileId)
      : null;

    const fallbackMediaFingerprint =
      mediaType && mediaFileId
        ? `${mediaType.toLowerCase()}:${mediaFileId}`
        : 'none';

    await this.upsertPublication(dealId, {
      publishedMessageText: normalizeText(textFallback),
      publishedMessageCaption: normalizeText(captionFallback),
      publishedMessageMediaFingerprint: fallbackMediaFingerprint,
      publishedMessageKeyboardFingerprint: 'none',
      publishedMessageHash: buildMessageFingerprintHash({
        text: normalizeText(textFallback) || normalizeText(captionFallback),
        mediaUniqueId: fallbackMediaFingerprint,
        entitiesSignature: 'none',
      }),
      publishedMessageSnapshotJson: {
        source: 'fallback',
        text: textFallback,
        caption: captionFallback,
        mediaType,
        mediaFileId,
      },
    });
  }

  private async upsertPublication(
    dealId: string,
    data: Partial<DealPublicationEntity>,
  ): Promise<void> {
    const existing = await this.publicationRepository.findOne({
      where: { dealId },
    });

    if (existing) {
      await this.publicationRepository.update(existing.id, data as QueryDeepPartialEntity<DealPublicationEntity>);
      return;
    }

    const created = this.publicationRepository.create({
      dealId,
      status: PublicationStatus.NOT_POSTED,
      ...data,
    });
    await this.publicationRepository.save(created);
  }

  private async ensurePermissions(
    deal: DealEntity,
    phase: 'publish' | 'verify',
  ): Promise<{ ok: boolean }> {
    const botCheck = await this.telegramPermissionsService.checkBotIsAdmin(
      deal.channelId,
    );
    if (!botCheck.ok) {
      this.logger.warn(
        `Permission check failed: bot not admin for deal ${deal.id}`,
      );
      await this.cancelDealForPermissions(deal, 'BOT_NOT_ADMIN', phase);
      return { ok: false };
    }

    if (!deal.publisherUserId) {
      this.logger.warn(
        `Permission check failed: publisher not bound for deal ${deal.id}`,
      );
      await this.cancelDealForPermissions(deal, 'PUBLISHER_NOT_BOUND', phase);
      return { ok: false };
    }

    const userCheck = await this.telegramPermissionsService.checkUserIsAdmin(
      deal.publisherUserId,
      deal.channelId,
    );
    if (!userCheck.ok) {
      this.logger.warn(
        `Permission check failed: publisher admin missing for deal ${deal.id}`,
      );
      await this.cancelDealForPermissions(deal, 'ADMIN_RIGHTS_LOST', phase);
      return { ok: false };
    }

    return { ok: true };
  }

  private async cancelDealForPermissions(
    deal: DealEntity,
    reason: string,
    phase: 'publish' | 'verify',
  ): Promise<void> {
    await this.upsertPublication(deal.id, {
      status: PublicationStatus.FAILED,
      error: reason,
    });
    await this.paymentsService.refundEscrow(deal.id, reason);
    await this.dealRepository.update(deal.id, {
      stage: DealStage.FINALIZED,
      status: DealStatus.CANCELED,
      cancelReason: reason,
    });

    if (reason === 'BOT_NOT_ADMIN') {
      if (phase === 'verify') {
        await this.dealsNotificationsService.notifyPostCheckUnavailableAdmin(
          deal,
        );
        await this.dealsNotificationsService.notifyAdvertiser(
          deal,
          'telegram.deal.post.check_unavailable_advertiser',
        );
      } else {
        await this.dealsNotificationsService.notifyPostNotPublishedAdmin(deal);
        await this.dealsNotificationsService.notifyAdvertiser(
          deal,
          'telegram.deal.post.not_published_advertiser',
        );
      }
    } else if (reason === 'ADMIN_RIGHTS_LOST') {
      await this.dealsNotificationsService.notifyAdvertiser(
        deal,
        'telegram.deal.canceled.admin_rights_lost',
      );
    }
  }
}

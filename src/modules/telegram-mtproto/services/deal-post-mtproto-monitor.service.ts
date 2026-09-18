import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DealPublicationEntity } from '../../deals/entities/deal-publication.entity';
import { DealEntity } from '../../deals/entities/deal.entity';
import { ListingEntity } from '../../listings/entities/listing.entity';
import { DealStage } from '../../../common/constants/deals/deal-stage.constants';
import { DealStatus } from '../../../common/constants/deals/deal-status.constants';
import { DEAL_PUBLICATION_ERRORS } from '../../../common/constants/deals/deal-publication-errors.constants';
import { PublicationStatus } from '../../../common/constants/deals/publication-status.constants';
import { DealsNotificationsService } from '../../deals/deals-notifications.service';
import { DealCancelAndRefundService } from '../../deals/services/deal-cancel-refund.service';
import { PinVisibilityStatus } from '../../../common/constants/deals/pin-visibility-status.constants';
import { MTPROTO_MONITOR_CONFIG } from '../mtproto-monitor.config';
import {
  buildMessageFingerprintHash,
  normalizeFingerprintText,
} from '../utils/message-fingerprint.util';
import {
  MtprotoChannelMessage,
  MtprotoClientService,
} from './mtproto-client.service';
import { MtprotoPeerResolverService } from './mtproto-peer-resolver.service';

const PIN_VIOLATION_REASON = 'PIN_REMOVED_OR_NOT_PINNED';

@Injectable()
export class DealPostMtprotoMonitorService {
  private readonly logger = new Logger(DealPostMtprotoMonitorService.name);
  private readonly monitoredStages = [
    DealStage.POSTED_VERIFYING,
    DealStage.DELIVERY_CONFIRMED,
  ];

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DealPublicationEntity)
    private readonly publicationRepository: Repository<DealPublicationEntity>,
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    private readonly mtprotoClientService: MtprotoClientService,
    private readonly mtprotoPeerResolverService: MtprotoPeerResolverService,
    private readonly dealsNotificationsService: DealsNotificationsService,
    private readonly dealCancelAndRefundService: DealCancelAndRefundService,
  ) {}

  @Cron(MTPROTO_MONITOR_CONFIG.POLL_CRON)
  async runVerificationCron(): Promise<void> {
    if (!this.mtprotoClientService.isEnabled()) {
      return;
    }

    const acquired = await this.tryAdvisoryLock('mtproto:post-verify');
    if (!acquired) {
      return;
    }

    try {
      const candidates = await this.selectCandidates();
      await this.runWithConcurrency(
        candidates,
        MTPROTO_MONITOR_CONFIG.MAX_PARALLEL,
        async (publication) => this.verifyPublishedPost(publication.id),
      );

      this.logger.log(
        `MTProto verification checked ${candidates.length} publication(s)`,
      );
    } finally {
      await this.releaseAdvisoryLock('mtproto:post-verify');
    }
  }

  async handleEditedChannelPost(payload: {
    chatId?: string | number | null;
    username?: string | null;
    messageId: string | number;
  }): Promise<void> {
    if (!this.mtprotoClientService.isEnabled()) {
      return;
    }

    const messageId = String(payload.messageId);
    const publication = await this.publicationRepository
      .createQueryBuilder('publication')
      .innerJoinAndSelect('publication.deal', 'deal')
      .innerJoinAndSelect('deal.channel', 'channel')
      .where('publication.publishedMessageId = :messageId', { messageId })
      .andWhere('deal.stage IN (:...stages)', { stages: this.monitoredStages })
      .andWhere('deal.status = :status', { status: DealStatus.ACTIVE })
      .getOne();

    if (publication) {
      await this.verifyPublishedPost(publication.id);
    }
  }

  async verifyPublishedPost(publicationId: string): Promise<void> {
    if (!this.mtprotoClientService.isEnabled()) {
      return;
    }

    this.logger.debug(
      `verifyPublishedPost start: publicationId=${publicationId}`,
    );

    const publication = await this.publicationRepository.findOne({
      where: { id: publicationId },
      relations: ['deal', 'deal.channel'],
    });

    if (!publication?.deal?.channel || !publication.publishedMessageId) {
      this.logger.debug(
        `verifyPublishedPost skip: publication ${publicationId} missing deal/channel/messageId`,
      );
      return;
    }

    if (
      !this.monitoredStages.includes(publication.deal.stage) ||
      publication.deal.status !== DealStatus.ACTIVE
    ) {
      this.logger.debug(
        `verifyPublishedPost skip: publication ${publication.id} out of monitored scope (stage=${publication.deal.stage}, status=${publication.deal.status})`,
      );
      return;
    }

    const now = new Date();
    const peer = await this.mtprotoPeerResolverService.resolveChannelPeer(
      publication.deal.channel,
    );
    if (!peer) {
      this.logger.warn(
        `verifyPublishedPost skip: peer not resolved for publication ${publication.id}`,
      );
      return;
    }

    const messageId = Number(publication.publishedMessageId);

    let message = null;
    try {
      message = await this.mtprotoClientService.getChannelMessage(
        peer,
        messageId,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (this.isMessageDeletedError(errorMessage)) {
        this.logger.warn(
          `verifyPublishedPost detected deleted message via MTProto error for publication ${publication.id}: ${errorMessage}`,
        );
        await this.markViolationIfNeeded(publication.id, 'POST_DELETED', now);
        return;
      }

      this.logger.warn(
        `verifyPublishedPost skip: MTProto check failed for publication ${publication.id}: ${errorMessage}`,
      );
      return;
    }

    if (!message) {
      this.logger.warn(
        `verifyPublishedPost detected deleted message: publication=${publication.id}, messageId=${messageId}`,
      );
      await this.markViolationIfNeeded(publication.id, 'POST_DELETED', now);
      return;
    }

    const currentHash = this.getMessageHash(message);
    const baselineHash =
      publication.publishedMessageHash ??
      buildMessageFingerprintHash({
        text:
          publication.publishedMessageText ??
          publication.publishedMessageCaption,
        mediaUniqueId: publication.publishedMessageMediaFingerprint,
        entitiesSignature:
          (publication.publishedMessageSnapshotJson?.entitiesFingerprint as
            | string
            | undefined) ?? null,
      });

    if (publication.publishedMessageHash !== baselineHash) {
      await this.publicationRepository.update(publication.id, {
        publishedMessageHash: baselineHash,
      });
    }

    if (currentHash !== baselineHash) {
      this.logger.warn(
        `verifyPublishedPost detected edited message: publication=${publication.id}, messageId=${messageId}, currentHash=${currentHash}, baselineHash=${baselineHash}`,
      );
      await this.markViolationIfNeeded(
        publication.id,
        DEAL_PUBLICATION_ERRORS.POST_EDITED,
        now,
      );
      return;
    }

    await this.publicationRepository.update(publication.id, {
      lastVerifiedAt: now,
      lastCheckedAt: now,
    });

    this.logger.debug(
      `verifyPublishedPost success: publication=${publication.id}, messageId=${messageId}`,
    );

    await this.verifyPinIfRequired(publication, peer, now);
  }

  private async verifyPinIfRequired(
    publication: DealPublicationEntity,
    peer: string,
    now: Date,
  ): Promise<void> {
    if (!publication.deal?.listingSnapshot) {
      return;
    }

    const listingSnapshot = publication.deal.listingSnapshot as {
      pinDurationHours?: number;
      visibleDurationHours?: number;
    };

    const pinRequired =
      Number(listingSnapshot.pinDurationHours ?? 0) > 0 ||
      Number(listingSnapshot.visibleDurationHours ?? 0) > 0;

    if (!pinRequired || !publication.publishedMessageId) {
      return;
    }

    let pinnedMessageId: number | null = null;
    try {
      pinnedMessageId = await this.mtprotoClientService.getPinnedMessage(peer);
    } catch {
      return;
    }

    if (
      String(pinnedMessageId ?? '') === String(publication.publishedMessageId)
    ) {
      await this.publicationRepository.update(publication.id, {
        pinVisibilityStatus: PinVisibilityStatus.PIN_OK,
        pinMissingFirstSeenAt: null,
        pinMissingLastCheckedAt: now,
        pinMissingCount: 0,
      });
      return;
    }

    const locked = await this.publicationRepository.findOne({
      where: { id: publication.id },
    });

    if (!locked || locked.error === PIN_VIOLATION_REASON) {
      return;
    }

    const missingCount = (locked.pinMissingCount ?? 0) + 1;
    const firstSeenAt = locked.pinMissingFirstSeenAt ?? now;
    const shouldWarn = !locked.pinMissingWarningSentAt;

    await this.publicationRepository.update(locked.id, {
      pinVisibilityStatus: PinVisibilityStatus.PIN_MISSING_WARNED,
      pinMissingFirstSeenAt: firstSeenAt,
      pinMissingLastCheckedAt: now,
      pinMissingCount: missingCount,
      pinMissingWarningSentAt: shouldWarn
        ? now
        : locked.pinMissingWarningSentAt,
    });

    if (shouldWarn) {
      await this.dealsNotificationsService.notifyPinMissingWarning(
        locked.dealId,
        true,
      );
      return;
    }

    if (missingCount >= 2) {
      await this.publicationRepository.update(locked.id, {
        pinVisibilityStatus: PinVisibilityStatus.PIN_MISSING_FINALIZED,
        pinMissingFinalizedAt: now,
      });
      await this.dealCancelAndRefundService.cancelForPinViolation(
        locked.dealId,
        PIN_VIOLATION_REASON,
      );
      await this.dealsNotificationsService.notifyPinMissingFinalized(
        locked.dealId,
        true,
      );
    }
  }

  private async markViolationIfNeeded(
    publicationId: string,
    errorCode: string,
    now: Date,
  ): Promise<void> {
    const publication = await this.publicationRepository.findOne({
      where: { id: publicationId },
    });

    if (!publication || publication.error === errorCode) {
      this.logger.debug(
        `markViolationIfNeeded skip: publication=${publicationId}, existingError=${publication?.error ?? 'none'}, requestedError=${errorCode}`,
      );
      return;
    }

    await this.publicationRepository.update(publication.id, {
      status: PublicationStatus.DELETED_OR_EDITED,
      error: errorCode,
      lastCheckedAt: now,
      lastVerifiedAt: now,
    });

    this.logger.warn(
      `markViolationIfNeeded applied: publication=${publication.id}, deal=${publication.dealId}, error=${errorCode}`,
    );

    await this.dealCancelAndRefundService.cancelForPublicationViolation(
      publication.dealId,
      errorCode,
    );

    const deal = await this.dealRepository.findOne({
      where: { id: publication.dealId },
    });

    if (!deal) {
      this.logger.warn(
        `markViolationIfNeeded skip notifications: deal ${publication.dealId} not found`,
      );
      return;
    }

    if (errorCode === DEAL_PUBLICATION_ERRORS.POST_EDITED) {
      await this.dealsNotificationsService.notifyPostEditedAdmin(deal);
      await this.dealsNotificationsService.notifyAdvertiser(
        deal,
        'telegram.deal.post.edited_advertiser',
      );
      return;
    }

    if (errorCode === 'POST_DELETED') {
      await this.dealsNotificationsService.notifyPostDeletedAdmin(deal);
      await this.dealsNotificationsService.notifyAdvertiser(
        deal,
        'telegram.deal.post.deleted_advertiser',
      );
    }
  }

  private isMessageDeletedError(message: string): boolean {
    const normalized = message.toUpperCase();
    return (
      normalized.includes('MESSAGE_ID_INVALID') ||
      normalized.includes('MESSAGE_ID_INVALID_ERROR') ||
      normalized.includes('MESSAGE_ID_EMPTY') ||
      normalized.includes('MSG_ID_INVALID') ||
      normalized.includes('400')
    );
  }

  private getMessageHash(message: MtprotoChannelMessage): string {
    return buildMessageFingerprintHash({
      text: normalizeFingerprintText(message.text),
      mediaUniqueId: message.mediaUniqueId ?? 'none',
      entitiesSignature: message.entitiesSignature ?? 'none',
    });
  }

  private async selectCandidates(): Promise<DealPublicationEntity[]> {
    return this.publicationRepository
      .createQueryBuilder('publication')
      .innerJoinAndSelect('publication.deal', 'deal')
      .innerJoinAndSelect('deal.channel', 'channel')
      .leftJoin(ListingEntity, 'listing', 'listing.id = deal.listingId')
      .where('deal.stage IN (:...stages)', { stages: this.monitoredStages })
      .andWhere('deal.status = :status', { status: DealStatus.ACTIVE })
      .andWhere('publication.status = :publicationStatus', {
        publicationStatus: PublicationStatus.POSTED,
      })
      .andWhere('publication.publishedMessageId IS NOT NULL')
      .orderBy('publication.lastVerifiedAt', 'ASC', 'NULLS FIRST')
      .limit(30)
      .getMany();
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    task: (item: T) => Promise<void>,
  ): Promise<void> {
    let index = 0;
    const workers = Array.from(
      { length: Math.max(1, concurrency) },
      async () => {
        while (index < items.length) {
          const current = items[index++];
          await task(current);
        }
      },
    );

    await Promise.all(workers);
  }

  private async tryAdvisoryLock(key: string): Promise<boolean> {
    const result = await this.dataSource.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) as locked',
      [key],
    );

    return Boolean(result?.[0]?.locked);
  }

  private async releaseAdvisoryLock(key: string): Promise<void> {
    await this.dataSource.query('SELECT pg_advisory_unlock(hashtext($1))', [
      key,
    ]);
  }
}

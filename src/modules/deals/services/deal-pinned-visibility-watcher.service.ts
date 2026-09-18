import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DealPublicationEntity } from '../entities/deal-publication.entity';
import { DealEntity } from '../entities/deal.entity';
import { ListingEntity } from '../../listings/entities/listing.entity';
import { DealStage } from '../../../common/constants/deals/deal-stage.constants';
import { DealStatus } from '../../../common/constants/deals/deal-status.constants';
import { PinVisibilityStatus } from '../../../common/constants/deals/pin-visibility-status.constants';
import { PIN_VISIBILITY_CONFIG } from '../../../config/deals.config';
import { TelegramChannelPinsService } from '../../telegram/telegram-channel-pins.service';
import {
  TelegramChatServiceError,
  TelegramChatErrorCode,
} from '../../telegram/telegram-chat.service';
import { DealsNotificationsService } from '../deals-notifications.service';
import { DealCancelAndRefundService } from './deal-cancel-refund.service';

const PIN_VIOLATION_REASON = 'PIN_REMOVED_OR_NOT_PINNED';

const TELEGRAM_POST_VERIFY_PROVIDER =
  process.env.TELEGRAM_POST_VERIFY_PROVIDER ?? 'mtproto';

@Injectable()
export class DealPinnedVisibilityWatcherService {
  private readonly logger = new Logger(DealPinnedVisibilityWatcherService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DealPublicationEntity)
    private readonly publicationRepository: Repository<DealPublicationEntity>,
    private readonly telegramChannelPinsService: TelegramChannelPinsService,
    private readonly dealsNotificationsService: DealsNotificationsService,
    private readonly dealCancelAndRefundService: DealCancelAndRefundService,
  ) {}

  @Cron(PIN_VISIBILITY_CONFIG.CRON)
  async runPinnedVisibilityCheck(): Promise<void> {
    if (TELEGRAM_POST_VERIFY_PROVIDER !== 'bot') {
      return;
    }
    const lockKey = 'deals:pin-visibility-check';
    const acquired = await this.tryAdvisoryLock(lockKey);
    if (!acquired) {
      return;
    }

    try {
      await this.handleBatch();
    } finally {
      await this.releaseAdvisoryLock(lockKey);
    }
  }

  private async handleBatch(): Promise<void> {
    const now = new Date();
    const minPostAgeMs = PIN_VISIBILITY_CONFIG.MIN_POST_AGE_MINUTES * 60 * 1000;
    const minPostedAt = new Date(now.getTime() - minPostAgeMs);

    const candidates = await this.publicationRepository
      .createQueryBuilder('publication')
      .innerJoin('publication.deal', 'deal')
      .innerJoin(ListingEntity, 'listing', 'listing.id = deal.listingId')
      .where('COALESCE(listing.pinDurationHours, 0) > 0')
      .andWhere('deal.status = :status', { status: DealStatus.ACTIVE })
      .andWhere('deal.stage = :stage', { stage: DealStage.POSTED_VERIFYING })
      .andWhere('publication.telegramChatId IS NOT NULL')
      .andWhere('publication.telegramMessageId IS NOT NULL')
      .andWhere('publication.postedAt IS NOT NULL')
      .andWhere('publication.postedAt <= :minPostedAt', { minPostedAt })
      .andWhere('publication.pinVisibilityStatus IN (:...statuses)', {
        statuses: [
          PinVisibilityStatus.MONITORING,
          PinVisibilityStatus.PIN_OK,
          PinVisibilityStatus.PIN_MISSING_WARNED,
        ],
      })
      .orderBy('publication.pinMissingLastCheckedAt', 'ASC', 'NULLS FIRST')
      .take(PIN_VISIBILITY_CONFIG.BATCH_LIMIT)
      .getMany();

    for (const publication of candidates) {
      await this.checkPublication(publication, now);
    }
  }

  private async checkPublication(
    publication: DealPublicationEntity,
    now: Date,
  ): Promise<void> {
    if (
      publication.pinMonitoringEndsAt &&
      now >= publication.pinMonitoringEndsAt &&
      publication.pinMissingCount === 0
    ) {
      await this.publicationRepository.update(publication.id, {
        pinVisibilityStatus: PinVisibilityStatus.NOT_REQUIRED,
        pinMissingLastCheckedAt: now,
      });
      return;
    }

    const chatId = publication.telegramChatId;
    const messageId = publication.telegramMessageId;
    if (!chatId || !messageId) {
      return;
    }

    try {
      await this.telegramChannelPinsService.canBotReadPins(chatId);
    } catch (error) {
      await this.handlePinAccessError(publication.id, error, now);
      return;
    }

    let pinnedIds: string[];
    try {
      pinnedIds =
        await this.telegramChannelPinsService.getPinnedMessageIds(chatId);
    } catch (error) {
      await this.handlePinAccessError(publication.id, error, now);
      return;
    }

    const isPinned = pinnedIds.includes(String(messageId));
    const outcome = await this.dataSource.transaction(async (manager) => {
      const publicationRepo = manager.getRepository(DealPublicationEntity);
      const dealRepo = manager.getRepository(DealEntity);

      const lockedPublication = await publicationRepo.findOne({
        where: { id: publication.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedPublication) {
        return null;
      }

      if (
        lockedPublication.pinVisibilityStatus ===
        PinVisibilityStatus.PIN_MISSING_FINALIZED
      ) {
        return null;
      }

      const deal = await dealRepo.findOne({
        where: { id: lockedPublication.dealId },
      });
      if (
        !deal ||
        deal.status !== DealStatus.ACTIVE ||
        deal.stage !== DealStage.POSTED_VERIFYING
      ) {
        return null;
      }

      if (
        lockedPublication.pinMonitoringEndsAt &&
        now >= lockedPublication.pinMonitoringEndsAt &&
        lockedPublication.pinMissingCount === 0
      ) {
        await publicationRepo.update(lockedPublication.id, {
          pinVisibilityStatus: PinVisibilityStatus.NOT_REQUIRED,
          pinMissingLastCheckedAt: now,
        });
        return { action: 'completed' };
      }

      if (isPinned) {
        await publicationRepo.update(lockedPublication.id, {
          pinVisibilityStatus: PinVisibilityStatus.PIN_OK,
          pinMissingCount: 0,
          pinMissingFirstSeenAt: null,
          pinMissingLastCheckedAt: now,
          pinLastErrorCode: null,
        });
        return { action: 'pinned' };
      }

      const missingCount = lockedPublication.pinMissingCount + 1;
      const missingFirstSeenAt = lockedPublication.pinMissingFirstSeenAt ?? now;
      const graceLimit = PIN_VISIBILITY_CONFIG.MISSING_GRACE_CHECKS + 1;

      if (missingCount >= graceLimit) {
        await publicationRepo.update(lockedPublication.id, {
          pinVisibilityStatus: PinVisibilityStatus.PIN_MISSING_FINALIZED,
          pinMissingCount: missingCount,
          pinMissingFirstSeenAt: missingFirstSeenAt,
          pinMissingLastCheckedAt: now,
          pinMissingFinalizedAt: lockedPublication.pinMissingFinalizedAt ?? now,
          pinLastErrorCode: null,
        });
        return { action: 'finalize', dealId: lockedPublication.dealId };
      }

      const shouldWarn = !lockedPublication.pinMissingWarningSentAt;
      await publicationRepo.update(lockedPublication.id, {
        pinVisibilityStatus: PinVisibilityStatus.PIN_MISSING_WARNED,
        pinMissingCount: missingCount,
        pinMissingFirstSeenAt: missingFirstSeenAt,
        pinMissingLastCheckedAt: now,
        pinMissingWarningSentAt: shouldWarn
          ? now
          : lockedPublication.pinMissingWarningSentAt,
        pinLastErrorCode: null,
      });

      return {
        action: shouldWarn ? 'warn' : 'missing',
        dealId: lockedPublication.dealId,
      };
    });

    if (!outcome) {
      return;
    }

    if (outcome.action === 'warn') {
      await this.dealsNotificationsService.notifyPinMissingWarning(
        outcome.dealId!,
        PIN_VISIBILITY_CONFIG.ALERTS_TO_ALL_REVIEWERS,
      );
      return;
    }

    if (outcome.action === 'finalize') {
      await this.dealCancelAndRefundService.cancelForPinViolation(
        outcome.dealId!,
        PIN_VIOLATION_REASON,
      );
      await this.dealsNotificationsService.notifyPinMissingFinalized(
        outcome.dealId!,
        PIN_VISIBILITY_CONFIG.ALERTS_TO_ALL_REVIEWERS,
      );
    }
  }

  private async handlePinAccessError(
    publicationId: string,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const errorCode = this.resolvePinErrorCode(error);
    if (!errorCode) {
      return;
    }

    const outcome = await this.dataSource.transaction(async (manager) => {
      const publicationRepo = manager.getRepository(DealPublicationEntity);
      const locked = await publicationRepo.findOne({
        where: { id: publicationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        return null;
      }

      if (
        locked.pinVisibilityStatus === PinVisibilityStatus.PIN_MISSING_FINALIZED
      ) {
        return null;
      }

      const shouldNotify = !locked.pinPermissionWarningSentAt;

      await publicationRepo.update(locked.id, {
        pinLastErrorCode: errorCode,
        pinMissingLastCheckedAt: now,
        pinPermissionWarningSentAt: shouldNotify
          ? now
          : locked.pinPermissionWarningSentAt,
      });

      return {
        action: shouldNotify ? 'notify' : 'skip',
        dealId: locked.dealId,
      };
    });

    if (!outcome || outcome.action !== 'notify') {
      return;
    }

    await this.dealsNotificationsService.notifyPinCheckUnavailable(
      outcome.dealId,
    );
  }

  private resolvePinErrorCode(error: unknown): string | null {
    if (
      error instanceof TelegramChatServiceError &&
      [
        TelegramChatErrorCode.BOT_FORBIDDEN,
        TelegramChatErrorCode.BOT_NOT_ADMIN,
        TelegramChatErrorCode.BOT_MISSING_RIGHTS,
      ].includes(error.code)
    ) {
      return error.code;
    }

    return null;
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

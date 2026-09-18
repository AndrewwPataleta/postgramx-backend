import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { DealEntity } from './entities/deal.entity';
import { DealCreativeEntity } from './entities/deal-creative.entity';
import { DealEscrowEntity } from './entities/deal-escrow.entity';
import { DealPublicationEntity } from './entities/deal-publication.entity';
import { ListingEntity } from '../listings/entities/listing.entity';
import { DealStatus } from '../../common/constants/deals/deal-status.constants';
import { DealStage } from '../../common/constants/deals/deal-stage.constants';
import { DealErrorCode, DealServiceError } from './errors/deal-service.error';
import { ChannelEntity } from '../channels/entities/channel.entity';
import { DealsNotificationsService } from './deals-notifications.service';
import { ChannelMembershipEntity } from '../channels/entities/channel-membership.entity';
import { ChannelRole } from '../channels/types/channel-role.enum';
import { ChannelModeratorsService } from '../channels/channel-moderators.service';
import { DealListingSnapshot } from './types/deal-listing-snapshot.type';
import { mapStageToDealStatus } from './state/deal-status.mapper';
import {
  assertTransitionAllowed,
  DealStateError,
} from './state/deal-state.machine';
import { DEALS_CONFIG } from '../../config/deals.config';
import { User } from '../auth/entities/user.entity';
import { CreativeStatus } from '../../common/constants/deals/creative-status.constants';
import { PaymentsService } from '../payments/payments.service';
import { ChannelErrorCode } from '../channels/types/channel-error-code.enum';
import { ChannelServiceError } from '../channels/errors/channel-service.error';
import { EscrowStatus } from '../../common/constants/deals/deal-escrow-status.constants';
import { formatTon } from '../payments/utils/bigint';
import { TransactionEntity } from '../payments/entities/transaction.entity';
import { TransactionDirection } from '../../common/constants/payments/transaction-direction.constants';
import { TransactionStatus } from '../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../common/constants/payments/transaction-type.constants';
import { TelegramSenderService } from '../telegram/telegram-sender.service';
import { TelegramI18nService } from '../telegram/i18n/telegram-i18n.service';
import { DEFAULT_CURRENCY } from '../../common/constants/currency/currency.constants';
import { PAYMENTS_CONFIG } from '../../config/payments.config';
import { PinVisibilityStatus } from '../../common/constants/deals/pin-visibility-status.constants';
import {
  buildDisplayTime,
  getUserTimeZone,
  isValidIanaTimeZone,
} from '../../common/time/time.utils';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
type ChangeRequestType = 'creative' | 'schedule';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(DealCreativeEntity)
    private readonly creativeRepository: Repository<DealCreativeEntity>,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepository: Repository<DealEscrowEntity>,
    @InjectRepository(DealPublicationEntity)
    private readonly publicationRepository: Repository<DealPublicationEntity>,
    @InjectRepository(ListingEntity)
    private readonly listingRepository: Repository<ListingEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dealsNotificationsService: DealsNotificationsService,
    private readonly paymentsService: PaymentsService,
    private readonly channelModeratorsService: ChannelModeratorsService,
    private readonly telegramSenderService: TelegramSenderService,
    private readonly telegramI18nService: TelegramI18nService,
    private readonly configService: ConfigService,
  ) {}

  async createDeal(
    userId: string,
    listingId: string,
    _brief?: string,
    _scheduledAt?: string,
  ) {
    const listing = await this.listingRepository.findOne({
      where: { id: listingId },
    });

    if (!listing) {
      throw new DealServiceError(DealErrorCode.LISTING_NOT_FOUND);
    }

    if (!listing.isActive) {
      throw new DealServiceError(DealErrorCode.LISTING_DISABLED);
    }

    const channel = await this.channelRepository.findOne({
      where: { id: listing.channelId },
    });

    if (!channel) {
      throw new DealServiceError(DealErrorCode.LISTING_NOT_FOUND);
    }

    if (channel.ownerUserId === userId) {
      throw new DealServiceError(DealErrorCode.SELF_DEAL_NOT_ALLOWED);
    }

    const activePendingCount = await this.dealRepository.count({
      where: {
        listingId,
        advertiserUserId: userId,
        status: DealStatus.PENDING,
        stage: In([
          DealStage.CREATIVE_AWAITING_SUBMIT,
          DealStage.CREATIVE_AWAITING_FOR_CHANGES,
          DealStage.PAYMENT_AWAITING,
          DealStage.PAYMENT_PARTIALLY_PAID,
          DealStage.SCHEDULE_AWAITING_FOR_CHANGES,
        ]),
      },
    });

    if (
      activePendingCount >=
      DEALS_CONFIG.MAX_ACTIVE_PENDING_DEALS_PER_LISTING_PER_USER
    ) {
      throw new DealServiceError(DealErrorCode.ACTIVE_PENDING_LIMIT_REACHED);
    }

    const hasActiveMembership =
      (await this.membershipRepository
        .createQueryBuilder('membership')
        .where('membership.channelId = :channelId', {
          channelId: listing.channelId,
        })
        .andWhere('membership.userId = :userId', { userId })
        .andWhere('membership.isActive = true')
        .andWhere('membership.role IN (:...roles)', {
          roles: [ChannelRole.OWNER, ChannelRole.MODERATOR],
        })
        .getCount()) > 0;

    if (hasActiveMembership) {
      throw new DealServiceError(DealErrorCode.SELF_DEAL_NOT_ALLOWED);
    }

    const now = new Date();
    const listingSnapshot = this.buildListingSnapshot(listing, now);
    const stage = DealStage.CREATIVE_AWAITING_SUBMIT;

    const deal = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(DealEntity);
      const escrowRepo = manager.getRepository(DealEscrowEntity);
      const created = repo.create({
        listingId: listing.id,
        channelId: listing.channelId,
        advertiserUserId: userId,
        publisherUserId: null,
        createdByUserId: userId,
        status: mapStageToDealStatus(stage),
        stage,
        listingSnapshot,
        scheduledAt: null,
        lastActivityAt: now,
        idleExpiresAt: this.computeIdleExpiry(stage, now),
      });

      const saved = await repo.save(created);

      return saved;
    });

    const advertiser = await this.userRepository.findOne({
      where: { id: deal.advertiserUserId },
    });

    if (advertiser?.telegramId) {
      try {
        await this.dealsNotificationsService.notifyCreativeRequired(
          deal,
          advertiser.telegramId,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Creative notification failed for dealId=${deal.id}: ${errorMessage}`,
        );
      }
    }

    return {
      id: deal.id,
      status: deal.status,
      stage: deal.stage,
      listingId: deal.listingId,
      channelId: deal.channelId,
    };
  }

  async scheduleDeal(
    userId: string,
    dealId: string,
    scheduleInput: {
      scheduledAt?: string;
      publishAtUtc?: string;
      publishAtLocal?: string;
      timeZone?: string;
      utcOffsetMinutes?: number;
    },
  ) {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    if (deal.advertiserUserId !== userId) {
      throw new DealServiceError(DealErrorCode.UNAUTHORIZED);
    }

    const parsedScheduledAt = this.resolveScheduleUtcInstant(scheduleInput);
    if (
      !this.isLocalEnvironment() &&
      parsedScheduledAt.getTime() <= Date.now()
    ) {
      throw new DealServiceError(DealErrorCode.INVALID_SCHEDULE_TIME);
    }

    this.ensureTransitionAllowed(
      deal.stage,
      DealStage.SCHEDULING_AWAITING_CONFIRM,
    );

    const now = new Date();
    const stage = DealStage.SCHEDULING_AWAITING_CONFIRM;

    await this.dealRepository.update(deal.id, {
      scheduledAt: parsedScheduledAt,
      stage,
      status: mapStageToDealStatus(stage),
      idleExpiresAt: this.computeIdleExpiry(stage, now),
      ...this.buildActivityUpdate(now),
    });

    const [updatedDeal, latestCreative] = await Promise.all([
      this.dealRepository.findOne({ where: { id: deal.id } }),
      this.creativeRepository.findOne({
        where: { dealId: deal.id },
        order: { version: 'DESC' },
      }),
    ]);

    if (updatedDeal && latestCreative) {
      try {
        await this.dealsNotificationsService.notifyScheduleSubmitted(
          updatedDeal,
          latestCreative,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Schedule notification failed for dealId=${deal.id}: ${errorMessage}`,
        );
      }
    } else if (!latestCreative) {
      this.logger.warn(
        `Schedule notification skipped: missing creative for dealId=${deal.id}`,
      );
    }

    const advertiser = await this.userRepository.findOne({
      where: { id: userId },
    });
    const advertiserTimeZone = getUserTimeZone(advertiser);

    return {
      id: deal.id,
      status: mapStageToDealStatus(stage),
      stage,
      scheduledAt: parsedScheduledAt,
      scheduledAtDisplay: buildDisplayTime(
        parsedScheduledAt,
        advertiserTimeZone,
      ),
    };
  }

  async handleCreativeMessage(payload: {
    traceId: string;
    telegramUserId: string;
    type: string;
    text: string | null;
    caption: string | null;
    mediaFileId: string | null;
    rawPayload: Record<string, unknown>;
    dealId?: string;
  }): Promise<{
    success: boolean;
    dealId?: string;
    messageKey?: string;
    messageArgs?: Record<string, any>;
    requiresDealSelection?: boolean;
    dealOptions?: Array<{ id: string }>;
  }> {
    const advertiser = await this.userRepository.findOne({
      where: { telegramId: payload.telegramUserId },
    });

    if (!advertiser) {
      return {
        success: false,
        messageKey: 'telegram.deal.creative.link_account_required',
      };
    }

    const awaitingSubmitDeals = await this.dealRepository.find({
      where: {
        advertiserUserId: advertiser.id,
        stage: DealStage.CREATIVE_AWAITING_SUBMIT,
      },
      order: { lastActivityAt: 'DESC' },
      relations: { channel: true },
    });

    if (!payload.dealId && awaitingSubmitDeals.length > 1) {
      const dealsList = awaitingSubmitDeals
        .map((item, index) => {
          const shortId = item.id.slice(0, 8);
          const channelLabel = item.channel
            ? item.channel.username
              ? `${item.channel.title} (@${item.channel.username})`
              : item.channel.title
            : '';
          const snapshot = item.listingSnapshot as DealListingSnapshot;
          const price = formatTon(snapshot?.priceNano ?? '0');
          const currency = snapshot?.currency ?? DEFAULT_CURRENCY;
          return [
            `${index + 1} - ${shortId}`,
            channelLabel,
            `${price} ${currency}`,
          ]
            .filter(Boolean)
            .join(' ');
        })
        .join('\n');
      return {
        success: false,
        messageKey: 'telegram.deal.creative.select_deal',
        messageArgs: { dealsList },
        requiresDealSelection: true,
        dealOptions: awaitingSubmitDeals.map((item) => ({ id: item.id })),
      };
    }

    let deal: DealEntity | null = null;

    if (payload.dealId) {
      deal = await this.dealRepository.findOne({
        where: {
          id: payload.dealId,
          advertiserUserId: advertiser.id,
          stage: In([
            DealStage.CREATIVE_AWAITING_SUBMIT,
            DealStage.CREATIVE_AWAITING_FOR_CHANGES,
          ]),
        },
      });
    } else {
      deal = await this.dealRepository.findOne({
        where: {
          advertiserUserId: advertiser.id,
          stage: In([
            DealStage.CREATIVE_AWAITING_SUBMIT,
            DealStage.CREATIVE_AWAITING_FOR_CHANGES,
          ]),
        },
        order: { lastActivityAt: 'DESC' },
      });
    }

    if (!deal) {
      return {
        success: false,
        messageKey: 'telegram.deal.creative.no_active_deal',
      };
    }

    const latestCreative = await this.creativeRepository.findOne({
      where: { dealId: deal.id },
      order: { version: 'DESC' },
    });

    const nextVersion = latestCreative ? latestCreative.version : 1;
    const creative = latestCreative
      ? latestCreative
      : this.creativeRepository.create({
          dealId: deal.id,
          version: nextVersion,
          status: CreativeStatus.DRAFT,
        });

    creative.status = CreativeStatus.RECEIVED_IN_BOT;
    creative.botChatId = String(payload.rawPayload.chatId ?? '');
    creative.botMessageId = String(payload.rawPayload.messageId ?? '');
    creative.payload = {
      type: payload.type,
      text: payload.text,
      caption: payload.caption,
      mediaFileId: payload.mediaFileId,
      ...payload.rawPayload,
    };

    await this.dataSource.transaction(async (manager) => {
      const creativeRepo = manager.getRepository(DealCreativeEntity);
      const dealRepo = manager.getRepository(DealEntity);
      await creativeRepo.save(creative);
      const stage = DealStage.CREATIVE_AWAITING_CONFIRM;
      await dealRepo.update(deal.id, {
        stage,
        status: mapStageToDealStatus(stage),
        idleExpiresAt: this.computeIdleExpiry(stage, new Date()),
        ...this.buildActivityUpdate(new Date()),
      });
    });

    const updatedDeal = await this.dealRepository.findOne({
      where: { id: deal.id },
    });

    if (updatedDeal) {
      const now = new Date();
      await this.dealsNotificationsService.notifyCreativeSubmitted(
        updatedDeal,
        {
          ...creative,
          status: CreativeStatus.RECEIVED_IN_BOT,
          submittedAt: now,
          submittedByUserId: deal.advertiserUserId,
        } as DealCreativeEntity,
      );
    }

    return {
      success: true,
      dealId: deal.id,
    };
  }

  async submitCreative(userId: string, dealId: string) {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    if (deal.advertiserUserId !== userId) {
      throw new DealServiceError(DealErrorCode.UNAUTHORIZED);
    }

    const creative = await this.creativeRepository.findOne({
      where: { dealId },
      order: { version: 'DESC' },
    });

    if (!creative || creative.status !== CreativeStatus.RECEIVED_IN_BOT) {
      throw new DealServiceError(DealErrorCode.CREATIVE_NOT_SUBMITTED);
    }

    const now = new Date();
    const stage = DealStage.CREATIVE_AWAITING_CONFIRM;

    await this.dataSource.transaction(async (manager) => {
      const creativeRepo = manager.getRepository(DealCreativeEntity);
      const dealRepo = manager.getRepository(DealEntity);

      await creativeRepo.update(creative.id, {
        status: CreativeStatus.RECEIVED_IN_BOT,
        submittedAt: now,
        submittedByUserId: userId,
      });

      await dealRepo.update(deal.id, {
        stage,
        status: mapStageToDealStatus(stage),
        idleExpiresAt: this.computeIdleExpiry(stage, now),
        ...this.buildActivityUpdate(now),
      });
    });

    const updatedDeal = await this.dealRepository.findOne({
      where: { id: deal.id },
    });

    if (updatedDeal) {
      await this.dealsNotificationsService.notifyCreativeSubmitted(
        updatedDeal,
        {
          ...creative,
          status: CreativeStatus.RECEIVED_IN_BOT,
          submittedAt: now,
          submittedByUserId: userId,
        } as DealCreativeEntity,
      );
    }

    return { id: deal.id, stage };
  }

  async getCreativeStatus(userId: string, dealId: string) {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    if (deal.advertiserUserId !== userId) {
      throw new DealServiceError(DealErrorCode.UNAUTHORIZED);
    }

    const creative = await this.creativeRepository.findOne({
      where: { dealId },
      order: { version: 'DESC' },
    });

    return {
      dealId: deal.id,
      stage: deal.stage,
      creative: creative
        ? {
            id: creative.id,
            version: creative.version,
            status: creative.status,
            submittedAt: creative.submittedAt,
            reviewedAt: creative.reviewedAt,
          }
        : null,
    };
  }

  async approveCreativeByAdmin(userId: string, dealId: string) {
    this.logger.log(
      `[approveCreativeByAdmin] started userId=${userId} dealId=${dealId}`,
    );

    const deal = await this.dealRepository.findOne({
      where: { id: dealId },
    });

    if (!deal) {
      this.logger.warn(
        `[approveCreativeByAdmin] deal not found userId=${userId} dealId=${dealId}`,
      );
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    await this.ensurePublisherAdmin(userId, deal);

    this.ensureTransitionAllowed(
      deal.stage,
      DealStage.SCHEDULING_AWAITING_SUBMIT,
    );

    const creative = await this.creativeRepository.findOne({
      where: { dealId, status: CreativeStatus.RECEIVED_IN_BOT },
      order: { version: 'DESC' },
    });

    if (!creative) {
      this.logger.warn(
        `[approveCreativeByAdmin] creative not submitted userId=${userId} dealId=${dealId}`,
      );
      throw new DealServiceError(DealErrorCode.CREATIVE_NOT_SUBMITTED);
    }

    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const creativeRepo = manager.getRepository(DealCreativeEntity);
      const escrowRepo = manager.getRepository(DealEscrowEntity);
      const dealRepo = manager.getRepository(DealEntity);

      await creativeRepo.update(creative.id, {
        status: CreativeStatus.APPROVED,
        reviewedAt: now,
      });

      const escrow = await escrowRepo.findOne({
        where: { dealId: deal.id },
        lock: { mode: 'pessimistic_write' },
      });

      const stage = DealStage.SCHEDULING_AWAITING_SUBMIT;
      await dealRepo.update(deal.id, {
        stage,
        status: mapStageToDealStatus(stage),
        idleExpiresAt: this.computeIdleExpiry(stage, now),
        ...this.buildActivityUpdate(now),
      });
    });

    const updatedDeal = await this.dealRepository.findOne({
      where: { id: deal.id },
    });

    if (updatedDeal) {
      await this.dealsNotificationsService.notifyCreativeApproved(updatedDeal);
      await this.dealsNotificationsService.notifyDealReviewAction(
        updatedDeal,
        userId,
        'approved',
      );
    }

    this.logger.log(
      `[approveCreativeByAdmin] approved userId=${userId} dealId=${dealId}`,
    );

    return { id: deal.id, stage: DealStage.PAYMENT_AWAITING };
  }

  async approveScheduleByAdmin(userId: string, dealId: string) {
    const deal = await this.dealRepository.findOne({
      where: { id: dealId },
    });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    await this.ensurePublisherAdmin(userId, deal);

    const now = new Date();
    const graceSeconds = DEALS_CONFIG.SCHEDULE_CONFIRM_GRACE_SECONDS;
    const notifyDedupeSeconds =
      DEALS_CONFIG.SCHEDULE_LATE_NOTIFY_DEDUPE_SECONDS;

    let shouldNotifyLateConfirmation = false;
    let lateRequestedTime: Date | null = null;

    await this.dataSource.transaction(async (manager) => {
      const escrowRepo = manager.getRepository(DealEscrowEntity);
      const dealRepo = manager.getRepository(DealEntity);

      const lockedDeal = await dealRepo.findOne({
        where: { id: deal.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedDeal) {
        throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
      }

      if (!lockedDeal.scheduledAt) {
        throw new DealServiceError(DealErrorCode.INVALID_SCHEDULE_TIME);
      }

      const requestedTime = lockedDeal.scheduledAt;
      const lateThreshold = new Date(
        requestedTime.getTime() - graceSeconds * 1000,
      );
      const isLateConfirmation = now.getTime() > lateThreshold.getTime();

      if (isLateConfirmation) {
        this.ensureTransitionAllowed(
          lockedDeal.stage,
          DealStage.SCHEDULE_AWAITING_FOR_CHANGES,
        );

        lateRequestedTime = requestedTime;
        const dedupeSince = new Date(
          now.getTime() - notifyDedupeSeconds * 1000,
        );
        shouldNotifyLateConfirmation =
          !lockedDeal.lastScheduleLateNotifiedAt ||
          lockedDeal.lastScheduleLateNotifiedAt.getTime() <
            dedupeSince.getTime();

        const stage = DealStage.SCHEDULE_AWAITING_FOR_CHANGES;
        await dealRepo.update(lockedDeal.id, {
          stage,
          status: mapStageToDealStatus(stage),
          scheduledAt: null,
          idleExpiresAt: this.computeIdleExpiry(stage, now),
          lastScheduleLateNotifiedAt: shouldNotifyLateConfirmation
            ? now
            : lockedDeal.lastScheduleLateNotifiedAt,
          ...this.buildActivityUpdate(now),
        });

        return;
      }

      this.ensureTransitionAllowed(
        lockedDeal.stage,
        DealStage.PAYMENT_AWAITING,
      );

      const escrow = escrowRepo.create({
        dealId: lockedDeal.id,
        status: EscrowStatus.CREATED,
        amountNano: lockedDeal.listingSnapshot.priceNano,
        paidNano: '0',
        currency: lockedDeal.listingSnapshot.currency,
      });
      await escrowRepo.save(escrow);

      const amountNano =
        (lockedDeal.listingSnapshot as DealListingSnapshot).priceNano ?? '0';

      const paymentDeadlineAt = this.addMinutes(
        now,
        PAYMENTS_CONFIG.PAYMENT_WINDOW_MINUTES,
      );

      await escrowRepo.update(escrow.id, {
        status: EscrowStatus.AWAITING_PAYMENT,
        amountNano,
        paymentDeadlineAt,
      });

      await this.paymentsService.ensureDepositAddressForDeal(
        lockedDeal.id,
        manager,
      );

      const stage = DealStage.PAYMENT_AWAITING;
      await dealRepo.update(lockedDeal.id, {
        stage,
        status: mapStageToDealStatus(stage),
        idleExpiresAt: this.computeIdleExpiry(stage, now),
        ...this.buildActivityUpdate(now),
      });
    });

    if (lateRequestedTime) {
      const updatedDeal = await this.dealRepository.findOne({
        where: { id: deal.id },
      });

      if (shouldNotifyLateConfirmation && updatedDeal) {
        await this.dealsNotificationsService.notifyScheduleConfirmTooLate(
          updatedDeal,
        );
      }

      throw new DealServiceError(DealErrorCode.SCHEDULE_CONFIRM_TOO_LATE, {
        serverTime: now.toISOString(),
        requestedTime: (lateRequestedTime as Date).toISOString(),
      });
    }

    const updatedDeal = await this.dealRepository.findOne({
      where: { id: deal.id },
    });
    const updatedEscrow = await this.escrowRepository.findOne({
      where: { dealId: deal.id },
    });

    if (updatedDeal) {
      await this.dealsNotificationsService.notifyScheduleApproved(
        updatedDeal,
        updatedEscrow ?? null,
      );
      await this.dealsNotificationsService.notifyDealReviewAction(
        updatedDeal,
        userId,
        'approved',
      );
    }

    return { id: deal.id, stage: DealStage.PAYMENT_AWAITING };
  }

  async requestChangesByAdmin(
    userId: string,
    dealId: string,
    comment?: string,
    requestType?: ChangeRequestType,
  ) {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    await this.ensurePublisherAdmin(userId, deal);

    const resolvedType = requestType ?? this.resolveChangeRequestType(deal);
    const targetStage =
      resolvedType === 'creative'
        ? DealStage.CREATIVE_AWAITING_FOR_CHANGES
        : DealStage.SCHEDULE_AWAITING_FOR_CHANGES;

    this.ensureTransitionAllowed(deal.stage, targetStage);

    if (resolvedType === 'creative') {
      return this.applyCreativeChangesRequest(deal, comment);
    }

    return this.applyScheduleChangesRequest(deal, comment);
  }

  async rejectByAdmin(userId: string, dealId: string, reason?: string) {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    await this.ensurePublisherAdmin(userId, deal);

    this.ensureTransitionAllowed(deal.stage, DealStage.FINALIZED);

    const creative = await this.creativeRepository.findOne({
      where: { dealId, status: CreativeStatus.RECEIVED_IN_BOT },
      order: { version: 'DESC' },
    });

    if (!creative) {
      throw new DealServiceError(DealErrorCode.CREATIVE_NOT_SUBMITTED);
    }

    const now = new Date();
    let shouldRefund = false;

    await this.dataSource.transaction(async (manager) => {
      const creativeRepo = manager.getRepository(DealCreativeEntity);
      const dealRepo = manager.getRepository(DealEntity);
      const escrowRepo = manager.getRepository(DealEscrowEntity);

      await creativeRepo.update(creative.id, {
        status: CreativeStatus.REJECTED,
        adminComment: reason ?? null,
        reviewedAt: now,
      });

      await dealRepo.update(deal.id, {
        stage: DealStage.FINALIZED,
        status: DealStatus.CANCELED,
        cancelReason: reason ?? 'ADMIN_REJECTED',
        ...this.buildActivityUpdate(now),
      });

      const escrow = await escrowRepo.findOne({ where: { dealId: deal.id } });
      if (
        escrow &&
        [EscrowStatus.PAID_HELD, EscrowStatus.PAID_PARTIAL].includes(
          escrow.status,
        )
      ) {
        shouldRefund = true;
      }
    });

    if (shouldRefund) {
      await this.paymentsService.refundEscrow(
        deal.id,
        reason ?? 'ADMIN_REJECTED',
      );
    }

    const updatedDeal = await this.dealRepository.findOne({
      where: { id: deal.id },
    });
    if (updatedDeal) {
      await this.dealsNotificationsService.notifyAdvertiser(
        updatedDeal,
        'telegram.deal.creative.rejected_closed_advertiser',
      );
      await this.dealsNotificationsService.notifyDealReviewAction(
        updatedDeal,
        userId,
        'rejected',
      );
    }

    return { id: deal.id, stage: DealStage.FINALIZED };
  }

  private async ensureChangeRequestAllowed(
    userId: string,
    dealId: string,
    requestType: ChangeRequestType,
  ): Promise<void> {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    await this.ensurePublisherAdmin(userId, deal);

    const targetStage =
      requestType === 'creative'
        ? DealStage.CREATIVE_AWAITING_FOR_CHANGES
        : DealStage.SCHEDULE_AWAITING_FOR_CHANGES;

    this.ensureTransitionAllowed(deal.stage, targetStage);

    if (requestType === 'creative') {
      const creative = await this.creativeRepository.findOne({
        where: { dealId, status: CreativeStatus.RECEIVED_IN_BOT },
        order: { version: 'DESC' },
      });

      if (!creative) {
        throw new DealServiceError(DealErrorCode.CREATIVE_NOT_SUBMITTED);
      }
    }
  }

  private resolveChangeRequestType(deal: DealEntity): ChangeRequestType {
    if (deal.stage === DealStage.CREATIVE_AWAITING_CONFIRM) {
      return 'creative';
    }

    if (deal.stage === DealStage.SCHEDULING_AWAITING_CONFIRM) {
      return 'schedule';
    }

    throw new DealServiceError(DealErrorCode.INVALID_STATUS);
  }

  private async applyCreativeChangesRequest(
    deal: DealEntity,
    comment?: string,
  ): Promise<{ id: string; stage: DealStage }> {
    const creative = await this.creativeRepository.findOne({
      where: { dealId: deal.id, status: CreativeStatus.RECEIVED_IN_BOT },
      order: { version: 'DESC' },
    });

    if (!creative) {
      throw new DealServiceError(DealErrorCode.CREATIVE_NOT_SUBMITTED);
    }

    const now = new Date();
    const trimmedComment = comment?.trim() ?? '';

    await this.dataSource.transaction(async (manager) => {
      const creativeRepo = manager.getRepository(DealCreativeEntity);
      const dealRepo = manager.getRepository(DealEntity);

      await creativeRepo.update(creative.id, {
        status: CreativeStatus.REJECTED,
        adminComment: trimmedComment || null,
        reviewedAt: now,
      });

      const nextVersion = creative.version + 1;
      const newCreative = creativeRepo.create({
        dealId: deal.id,
        version: nextVersion,
        status: CreativeStatus.DRAFT,
      });
      await creativeRepo.save(newCreative);

      const stage = DealStage.CREATIVE_AWAITING_FOR_CHANGES;
      await dealRepo.update(deal.id, {
        stage,
        status: mapStageToDealStatus(stage),
        idleExpiresAt: this.computeIdleExpiry(stage, now),
        ...this.buildActivityUpdate(now),
      });
    });

    const commentText = trimmedComment || '-';
    const messageArgs = await this.buildChangeRequestMessageArgs(
      deal,
      commentText,
    );
    await this.dealsNotificationsService.notifyAdvertiser(
      deal,
      'telegram.deal.creative.changes_requested_advertiser',
      messageArgs,
    );

    return { id: deal.id, stage: DealStage.CREATIVE_AWAITING_FOR_CHANGES };
  }

  private async applyScheduleChangesRequest(
    deal: DealEntity,
    comment?: string,
  ): Promise<{ id: string; stage: DealStage }> {
    const now = new Date();
    const trimmedComment = comment?.trim() ?? '';
    const stage = DealStage.SCHEDULE_AWAITING_FOR_CHANGES;

    await this.dealRepository.update(deal.id, {
      stage,
      status: mapStageToDealStatus(stage),
      idleExpiresAt: this.computeIdleExpiry(stage, now),
      ...this.buildActivityUpdate(now),
    });

    const commentText = trimmedComment || '-';
    const messageArgs = await this.buildChangeRequestMessageArgs(
      deal,
      commentText,
    );
    await this.dealsNotificationsService.notifyAdvertiser(
      deal,
      'telegram.deal.schedule.changes_requested_advertiser',
      messageArgs,
    );

    return { id: deal.id, stage };
  }

  async handleCreativeApprovalFromTelegram(payload: {
    telegramUserId: string;
    dealId: string;
  }): Promise<{
    handled: boolean;
    messageKey?: string;
    messageArgs?: Record<string, any>;
  }> {
    const adminUserId = await this.resolveDealAdminUserIdByTelegram(
      payload.dealId,
      payload.telegramUserId,
    );

    if (!adminUserId) {
      return { handled: false };
    }

    try {
      await this.approveCreativeByAdmin(adminUserId, payload.dealId);
    } catch (error) {
      if (
        error instanceof DealServiceError &&
        error.code === DealErrorCode.UNAUTHORIZED
      ) {
        return {
          handled: true,
          messageKey: 'telegram.deal.creative.restore_bot_admin',
        };
      }
      throw error;
    }

    return {
      handled: true,
    };
  }

  async handleScheduleApprovalFromTelegram(payload: {
    telegramUserId: string;
    dealId: string;
  }): Promise<{
    handled: boolean;
    messageKey?: string;
    messageArgs?: Record<string, any>;
  }> {
    const adminUserId = await this.resolveDealAdminUserIdByTelegram(
      payload.dealId,
      payload.telegramUserId,
    );

    if (!adminUserId) {
      return { handled: false };
    }

    await this.approveScheduleByAdmin(adminUserId, payload.dealId);

    return {
      handled: true,
      messageKey: 'telegram.deal.schedule.approved',
      messageArgs: undefined,
    };
  }

  async handleCreativeRequestChangesFromTelegram(payload: {
    telegramUserId: string;
    dealId: string;
  }): Promise<{
    handled: boolean;
    messageKey?: string;
    messageArgs?: Record<string, any>;
  }> {
    const adminUserId = await this.resolveDealAdminUserIdByTelegram(
      payload.dealId,
      payload.telegramUserId,
    );

    if (!adminUserId) {
      return { handled: false };
    }

    await this.ensureChangeRequestAllowed(
      adminUserId,
      payload.dealId,
      'creative',
    );

    return {
      handled: true,
      messageKey: 'telegram.deal.creative.request_changes_prompt',
      messageArgs: { dealId: payload.dealId },
    };
  }

  async handleScheduleRequestChangesFromTelegram(payload: {
    telegramUserId: string;
    dealId: string;
  }): Promise<{
    handled: boolean;
    messageKey?: string;
    messageArgs?: Record<string, any>;
  }> {
    const adminUserId = await this.resolveDealAdminUserIdByTelegram(
      payload.dealId,
      payload.telegramUserId,
    );

    if (!adminUserId) {
      return { handled: false };
    }

    await this.ensureChangeRequestAllowed(
      adminUserId,
      payload.dealId,
      'schedule',
    );

    return {
      handled: true,
      messageKey: 'telegram.deal.schedule.request_changes_prompt',
      messageArgs: { dealId: payload.dealId },
    };
  }

  async handleAdminRequestChangesReply(payload: {
    telegramUserId: string;
    dealId: string;
    comment?: string;
    requestType: ChangeRequestType;
  }): Promise<{
    handled: boolean;
    messageKey?: string;
    messageArgs?: Record<string, any>;
  }> {
    const adminUserId = await this.resolveDealAdminUserIdByTelegram(
      payload.dealId,
      payload.telegramUserId,
    );

    if (!adminUserId) {
      return { handled: false };
    }

    try {
      await this.requestChangesByAdmin(
        adminUserId,
        payload.dealId,
        payload.comment,
        payload.requestType,
      );

      return {
        handled: true,
        messageKey:
          payload.requestType === 'creative'
            ? 'telegram.deal.creative.changes_requested'
            : 'telegram.deal.schedule.changes_requested',
        messageArgs: undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn('Failed to apply change request reply', {
        dealId: payload.dealId,
        requestType: payload.requestType,
        errorMessage,
      });

      return {
        handled: true,
        messageKey: 'telegram.deal.request_changes.failed',
        messageArgs: undefined,
      };
    }
  }

  async handleCreativeRejectFromTelegram(payload: {
    telegramUserId: string;
    dealId: string;
  }): Promise<{
    handled: boolean;
    messageKey?: string;
    messageArgs?: Record<string, any>;
  }> {
    const adminUserId = await this.resolveDealAdminUserIdByTelegram(
      payload.dealId,
      payload.telegramUserId,
    );

    if (!adminUserId) {
      return { handled: false };
    }

    await this.rejectByAdmin(adminUserId, payload.dealId, 'ADMIN_REJECTED');

    return {
      handled: true,
      messageKey: 'telegram.deal.creative.rejected_notified',
      messageArgs: undefined,
    };
  }

  async handleScheduleRejectFromTelegram(payload: {
    telegramUserId: string;
    dealId: string;
  }): Promise<{
    handled: boolean;
    messageKey?: string;
    messageArgs?: Record<string, any>;
  }> {
    const adminUserId = await this.resolveDealAdminUserIdByTelegram(
      payload.dealId,
      payload.telegramUserId,
    );

    if (!adminUserId) {
      return { handled: false };
    }

    await this.cancelDeal(adminUserId, payload.dealId, 'ADMIN_REJECTED');

    const updatedDeal = await this.dealRepository.findOne({
      where: { id: payload.dealId },
    });

    if (updatedDeal) {
      await this.dealsNotificationsService.notifyAdvertiser(
        updatedDeal,
        'telegram.deal.schedule.canceled_advertiser',
        { dealId: updatedDeal.id.slice(0, 8) },
      );
    }

    return {
      handled: true,
      messageKey: 'telegram.deal.schedule.canceled_notified',
      messageArgs: undefined,
    };
  }

  async cancelDeal(
    userId: string,
    dealId: string,
    reason?: string,
  ): Promise<{ id: string; stage: DealStage }> {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    const canCancelAsAdvertiser = deal.advertiserUserId === userId;
    const canCancelAsPublisher =
      (await this.membershipRepository.findOne({
        where: {
          channelId: deal.channelId,
          userId,
          isActive: true,
        },
      })) !== null;

    if (!canCancelAsAdvertiser && !canCancelAsPublisher) {
      throw new DealServiceError(DealErrorCode.UNAUTHORIZED);
    }

    const now = new Date();
    const stage = DealStage.FINALIZED;
    const cancelReason = reason ?? 'CANCELED';
    let refundedAmountNano = 0n;

    await this.dataSource.transaction(async (manager) => {
      const dealRepo = manager.getRepository(DealEntity);
      const escrowRepo = manager.getRepository(DealEscrowEntity);

      const lockedEscrow = await escrowRepo.findOne({
        where: { dealId: deal.id },
        lock: { mode: 'pessimistic_write' },
      });
      const lockedDeal = await dealRepo.findOne({
        where: { id: deal.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedDeal) {
        throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
      }

      const alreadyCanceled =
        lockedDeal.status === DealStatus.CANCELED &&
        lockedDeal.stage === DealStage.FINALIZED;
      if (!alreadyCanceled) {
        this.ensureTransitionAllowed(lockedDeal.stage, stage);
      }

      await dealRepo.update(lockedDeal.id, {
        status: DealStatus.CANCELED,
        stage,
        cancelReason,
        ...this.buildActivityUpdate(now),
      });

      if (
        !lockedEscrow ||
        ![EscrowStatus.PAID_HELD, EscrowStatus.PAID_PARTIAL].includes(
          lockedEscrow.status,
        )
      ) {
        return;
      }

      const amountNano = BigInt(lockedEscrow.paidNano ?? '0');
      if (amountNano <= 0n) {
        await escrowRepo.update(lockedEscrow.id, {
          status: EscrowStatus.REFUNDED,
        });
        return;
      }

      refundedAmountNano = await this.creditAdvertiserFromCanceledDeal(
        manager,
        lockedDeal,
        lockedEscrow,
        amountNano,
        cancelReason,
      );
    });

    if (refundedAmountNano > 0n) {
      await this.notifyAdminAboutRefundCredit(deal, refundedAmountNano);
      await this.dealsNotificationsService.notifyAdvertiser(
        deal,
        'telegram.deal.canceled_refund_available',
        {
          amountTon: formatTon(refundedAmountNano.toString()),
        },
      );
    } else {
      await this.dealsNotificationsService.notifyAdvertiser(
        deal,
        'telegram.deal.canceled_no_payment',
      );
    }

    return { id: deal.id, stage };
  }

  private async creditAdvertiserFromCanceledDeal(
    manager: EntityManager,
    deal: DealEntity,
    escrow: DealEscrowEntity,
    amountNano: bigint,
    reason: string,
  ): Promise<bigint> {
    const txRepo = manager.getRepository(TransactionEntity);
    const escrowRepo = manager.getRepository(DealEscrowEntity);
    const dealRepo = manager.getRepository(DealEntity);
    const idempotencyKey = `refund_to_available:${deal.id}`;

    await txRepo
      .createQueryBuilder('transaction')
      .setLock('pessimistic_write')
      .where('transaction.userId = :userId', {
        userId: deal.advertiserUserId,
      })
      .andWhere('transaction.currency = :currency', {
        currency: escrow.currency,
      })
      .orderBy('transaction.createdAt', 'DESC')
      .limit(1)
      .getOne();

    const existing = await txRepo.findOne({
      where: { idempotencyKey },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing) {
      return BigInt(existing.amountNano);
    }

    const payoutCompleted = await txRepo
      .createQueryBuilder('transaction')
      .where('transaction.dealId = :dealId', { dealId: deal.id })
      .andWhere('transaction.type = :type', {
        type: TransactionType.PAYOUT,
      })
      .andWhere('transaction.direction = :direction', {
        direction: TransactionDirection.OUT,
      })
      .andWhere('transaction.status = :status', {
        status: TransactionStatus.COMPLETED,
      })
      .getExists();
    if (payoutCompleted) {
      return 0n;
    }

    this.logger.log(
      'Deal canceled - crediting advertiser available balance (no on-chain refund).',
      JSON.stringify({
        dealId: deal.id,
        escrowId: escrow.id,
        advertiserUserId: deal.advertiserUserId,
        amountNano: amountNano.toString(),
      }),
    );

    await txRepo.save(
      txRepo.create({
        userId: deal.advertiserUserId,
        type: TransactionType.REFUND,
        direction: TransactionDirection.IN,
        status: TransactionStatus.COMPLETED,
        amountNano: amountNano.toString(),
        amountToUserNano: amountNano.toString(),
        totalDebitNano: '0',
        currency: escrow.currency,
        description: 'Deal canceled - funds returned to available balance',
        dealId: deal.id,
        escrowId: escrow.id,
        idempotencyKey,
        metadata: {
          eventType: 'DEAL_REFUND_TO_AVAILABLE',
          reason,
          refundableAmountNano: amountNano.toString(),
        },
        completedAt: new Date(),
      }),
    );

    await escrowRepo.update(escrow.id, {
      status: EscrowStatus.REFUNDED,
      refundedAt: new Date(),
    });
    await dealRepo.update(deal.id, { lastActivityAt: new Date() });

    return amountNano;
  }

  private async notifyAdminAboutRefundCredit(
    deal: DealEntity,
    amountNano: bigint,
  ): Promise<void> {
    const adminChatId = this.configService.get<string>('ADMIN_ALERTS_CHAT_ID');
    if (!adminChatId) {
      return;
    }

    const advertiser = await this.userRepository.findOne({
      where: { id: deal.advertiserUserId },
    });
    const username = advertiser?.username ? `@${advertiser.username}` : '-';
    const text = this.telegramI18nService.t(
      'en',
      'telegram.admin.refund_credited',
      {
        userId: deal.advertiserUserId,
        username,
        amountTon: formatTon(amountNano.toString()),
        amountNano: amountNano.toString(),
        dealId: deal.id,
        eventType: 'DEAL_REFUND_TO_AVAILABLE',
      },
    );

    await this.telegramSenderService.sendMessage(adminChatId, text, {
      parseMode: 'HTML',
    });
  }

  async listDeals(
    userId: string,
    options: {
      role?: 'all' | 'advertiser' | 'publisher';
      pendingPage?: number;
      pendingLimit?: number;
      activePage?: number;
      activeLimit?: number;
      completedPage?: number;
      completedLimit?: number;
    },
  ) {
    const role = options.role ?? 'all';

    const pending = await this.fetchDealsGroup(userId, role, {
      page: options.pendingPage ?? DEFAULT_PAGE,
      limit: options.pendingLimit ?? DEFAULT_LIMIT,
      statuses: [DealStatus.PENDING],
    });

    const active = await this.fetchDealsGroup(userId, role, {
      page: options.activePage ?? DEFAULT_PAGE,
      limit: options.activeLimit ?? DEFAULT_LIMIT,
      statuses: [DealStatus.ACTIVE],
    });

    const completed = await this.fetchDealsGroup(userId, role, {
      page: options.completedPage ?? DEFAULT_PAGE,
      limit: options.completedLimit ?? DEFAULT_LIMIT,
      statuses: [DealStatus.COMPLETED, DealStatus.CANCELED],
    });

    return {
      pending,
      active,
      completed,
    };
  }

  async getDeal(userId: string, dealId: string) {
    const deal = await this.dealRepository.findOne({
      where: { id: dealId },
      relations: ['listing', 'channel'],
    });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    const isAdvertiser = deal.advertiserUserId === userId;
    const isPublisher = deal.publisherUserId
      ? deal.publisherUserId === userId
      : (await this.membershipRepository.findOne({
          where: { channelId: deal.channelId, userId },
        })) !== null;

    if (!isAdvertiser && !isPublisher) {
      throw new DealServiceError(DealErrorCode.UNAUTHORIZED);
    }

    const viewer = await this.userRepository.findOne({ where: { id: userId } });

    const [escrow, publication, creative] = await Promise.all([
      this.escrowRepository.findOne({ where: { dealId: deal.id } }),
      this.publicationRepository.findOne({ where: { dealId: deal.id } }),
      this.creativeRepository.findOne({
        where: { dealId: deal.id },
        order: { version: 'DESC' },
      }),
    ]);

    return this.buildDealItem(
      deal,
      creative,
      escrow,
      publication,
      getUserTimeZone(viewer),
    );
  }

  async getPinVisibility(userId: string, dealId: string) {
    const deal = await this.dealRepository.findOne({
      where: { id: dealId },
    });

    if (!deal) {
      throw new DealServiceError(DealErrorCode.DEAL_NOT_FOUND);
    }

    const isAdvertiser = deal.advertiserUserId === userId;
    const isPublisher = deal.publisherUserId
      ? deal.publisherUserId === userId
      : (await this.membershipRepository.findOne({
          where: { channelId: deal.channelId, userId },
        })) !== null;

    if (!isAdvertiser && !isPublisher) {
      throw new DealServiceError(DealErrorCode.UNAUTHORIZED);
    }

    const publication = await this.publicationRepository.findOne({
      where: { dealId: deal.id },
    });

    const visibilityDurationHours =
      (deal.listingSnapshot as { visibilityDurationHours?: number })
        ?.visibilityDurationHours ?? 0;

    return {
      required: visibilityDurationHours !== 0,
      status:
        publication?.pinVisibilityStatus ?? PinVisibilityStatus.NOT_REQUIRED,
      missingCount: publication?.pinMissingCount ?? 0,
      firstSeenAt: publication?.pinMissingFirstSeenAt ?? null,
      lastCheckedAt: publication?.pinMissingLastCheckedAt ?? null,
      warningSentAt: publication?.pinMissingWarningSentAt ?? null,
    };
  }

  private async fetchDealsGroup(
    userId: string,
    role: 'all' | 'advertiser' | 'publisher',
    group: {
      page: number;
      limit: number;
      statuses: DealStatus[];
    },
  ) {
    const qb = this.dealRepository
      .createQueryBuilder('deal')
      .leftJoinAndSelect('deal.listing', 'listing')
      .leftJoinAndSelect('deal.channel', 'channel')
      .where('deal.status IN (:...statuses)', {
        statuses: group.statuses,
      })
      .orderBy('deal.lastActivityAt', 'DESC')
      .skip((group.page - 1) * group.limit)
      .take(group.limit);

    qb.leftJoin(
      ChannelMembershipEntity,
      'membership',
      'membership.channelId = deal.channelId AND membership.userId = :userId AND membership.isActive = true',
      { userId },
    );

    if (role === 'advertiser') {
      qb.andWhere('deal.advertiserUserId = :userId', { userId });
    } else if (role === 'publisher') {
      qb.andWhere(
        new Brackets((builder) => {
          builder
            .where('deal.publisherUserId = :userId', { userId })
            .orWhere(
              'deal.publisherUserId IS NULL AND membership.id IS NOT NULL',
            );
        }),
      );
    } else {
      qb.andWhere(
        new Brackets((builder) => {
          builder
            .where('deal.advertiserUserId = :userId', { userId })
            .orWhere('deal.publisherUserId = :userId', { userId })
            .orWhere(
              'deal.publisherUserId IS NULL AND membership.id IS NOT NULL',
            );
        }),
      );
    }

    const [deals, total] = await qb.getManyAndCount();
    const dealIds = deals.map((deal) => deal.id);

    const [escrows, publications, creatives] = await Promise.all([
      this.escrowRepository.find({ where: { dealId: In(dealIds) } }),
      this.publicationRepository.find({ where: { dealId: In(dealIds) } }),
      this.creativeRepository.find({
        where: { dealId: In(dealIds) },
        order: { version: 'DESC' },
      }),
    ]);

    const escrowMap = new Map(escrows.map((escrow) => [escrow.dealId, escrow]));
    const publicationMap = new Map(
      publications.map((publication) => [publication.dealId, publication]),
    );
    const creativeMap = new Map<string, DealCreativeEntity>();
    for (const creative of creatives) {
      if (!creativeMap.has(creative.dealId)) {
        creativeMap.set(creative.dealId, creative);
      }
    }

    const viewer = await this.userRepository.findOne({ where: { id: userId } });
    const viewerTimeZone = getUserTimeZone(viewer);

    const items = deals.map((deal) =>
      this.buildDealItem(
        deal,
        creativeMap.get(deal.id) ?? null,
        escrowMap.get(deal.id) ?? null,
        publicationMap.get(deal.id) ?? null,
        viewerTimeZone,
      ),
    );

    return {
      items,
      page: group.page,
      limit: group.limit,
      total,
    };
  }

  private buildDealItem(
    deal: DealEntity,
    creative: DealCreativeEntity | null,
    escrow: DealEscrowEntity | null,
    publication: DealPublicationEntity | null,
    viewerTimeZone: string,
  ) {
    const channel = deal.channel;

    return {
      id: deal.id,
      advertiserUserId: deal.advertiserUserId,
      publisherUserId: deal.publisherUserId,
      channelId: deal.channelId,
      status: deal.status,
      stage: deal.stage,
      avatarUrl: deal.channel.avatarUrl,
      scheduledAt: deal.scheduledAt,
      scheduledAtDisplay: this.buildDisplayTimeOrNull(
        deal.scheduledAt,
        viewerTimeZone,
      ),
      createdAt: deal.createdAt,
      createdAtDisplay: this.buildDisplayTimeOrNull(
        deal.createdAt,
        viewerTimeZone,
      ),
      idleExpiresAt: deal.idleExpiresAt,
      idleExpiresAtDisplay: this.buildDisplayTimeOrNull(
        deal.idleExpiresAt,
        viewerTimeZone,
      ),
      channel: channel
        ? {
            id: channel.id,
            title: channel.title,
            username: channel.username,
          }
        : null,
      listingSnapshot: deal.listingSnapshot,
      escrow: escrow
        ? {
            status: escrow.status,
            amountNano: escrow.amountNano,
            paidNano: escrow.paidNano,
            depositAddress: escrow.depositAddress,
            paymentDeadlineAt: escrow.paymentDeadlineAt,
            paymentDeadlineAtDisplay: this.buildDisplayTimeOrNull(
              escrow.paymentDeadlineAt,
              viewerTimeZone,
            ),
          }
        : null,
      creative: creative
        ? {
            id: creative.id,
            version: creative.version,
            status: creative.status,
            submittedAt: creative.submittedAt,
            reviewedAt: creative.reviewedAt,
          }
        : null,
      publication: publication
        ? {
            status: publication.status,
            publishedMessageId: publication.publishedMessageId,
            publishedAt: publication.publishedAt,
            publishedAtDisplay: this.buildDisplayTimeOrNull(
              publication.publishedAt,
              viewerTimeZone,
            ),
            mustRemainUntil: publication.mustRemainUntil,
            mustRemainUntilDisplay: this.buildDisplayTimeOrNull(
              publication.mustRemainUntil,
              viewerTimeZone,
            ),
            verifiedAt: publication.verifiedAt,
            verifiedAtDisplay: this.buildDisplayTimeOrNull(
              publication.verifiedAt,
              viewerTimeZone,
            ),
            error: publication.error,
          }
        : null,
    };
  }

  private buildDisplayTimeOrNull(
    value: Date | null | undefined,
    timeZone: string,
  ) {
    if (!value) {
      return null;
    }

    return buildDisplayTime(value, timeZone);
  }

  private resolveScheduleUtcInstant(scheduleInput: {
    scheduledAt?: string;
    publishAtUtc?: string;
    publishAtLocal?: string;
    timeZone?: string;
    utcOffsetMinutes?: number;
  }): Date {
    const publishAtUtc =
      scheduleInput.publishAtUtc ?? scheduleInput.scheduledAt;
    if (publishAtUtc) {
      const utcDate = new Date(publishAtUtc);
      if (!Number.isNaN(utcDate.getTime())) {
        return utcDate;
      }
    }

    const timeZone = this.resolveInputTimeZone(
      scheduleInput.timeZone,
      scheduleInput.utcOffsetMinutes,
    );

    if (scheduleInput.publishAtLocal && timeZone) {
      const fromLocal = this.convertLocalDateTimeToUtc(
        scheduleInput.publishAtLocal,
        timeZone,
      );
      if (fromLocal) {
        return fromLocal;
      }
    }

    throw new DealServiceError(DealErrorCode.INVALID_SCHEDULE_TIME);
  }

  private resolveInputTimeZone(
    timeZone?: string,
    utcOffsetMinutes?: number,
  ): string | null {
    const normalized = timeZone?.trim();
    if (normalized && isValidIanaTimeZone(normalized)) {
      return normalized;
    }

    if (
      !Number.isInteger(utcOffsetMinutes) ||
      (utcOffsetMinutes as number) % 60 !== 0
    ) {
      return null;
    }

    const hours = (utcOffsetMinutes as number) / 60;
    if (hours < -14 || hours > 14) {
      return null;
    }

    if (hours === 0) {
      return 'UTC';
    }

    return `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
  }

  private convertLocalDateTimeToUtc(
    value: string,
    timeZone: string,
  ): Date | null {
    const local = value.trim();
    const match = local.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/,
    );
    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute, secondRaw] = match;
    const second = Number(secondRaw ?? '0');
    const baseUtcMs = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      second,
    );

    const offsetPart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(baseUtcMs))
      .find((part) => part.type === 'timeZoneName')?.value;

    const offsetMatch = offsetPart?.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!offsetMatch) {
      return null;
    }

    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const offsetHours = Number(offsetMatch[2]);
    const offsetMinutes = Number(offsetMatch[3] ?? '0');
    const totalOffsetMinutes = sign * (offsetHours * 60 + offsetMinutes);

    return new Date(baseUtcMs - totalOffsetMinutes * 60_000);
  }
  private buildListingSnapshot(
    listing: ListingEntity,
    snapshotAt: Date,
  ): DealListingSnapshot {
    return {
      listingId: listing.id,
      channelId: listing.channelId,
      format: listing.format,
      priceNano: listing.priceNano,
      currency: listing.currency,
      tags: listing.tags,
      pinDurationHours: listing.pinDurationHours,
      visibilityDurationHours: listing.visibilityDurationHours,
      allowEdits: listing.allowEdits,
      allowLinkTracking: listing.allowLinkTracking,
      allowPinnedPlacement: listing.allowPinnedPlacement,
      requiresApproval: listing.requiresApproval,
      contentRulesText: listing.contentRulesText,
      version: listing.version ?? 1,
      snapshotAt: snapshotAt.toISOString(),
    };
  }

  private ensureTransitionAllowed(from: DealStage, to: DealStage) {
    try {
      assertTransitionAllowed(from, to);
    } catch (error) {
      if (error instanceof DealStateError) {
        throw new DealServiceError(DealErrorCode.INVALID_STATUS);
      }
      throw error;
    }
  }

  private buildActivityUpdate(now: Date) {
    return {
      lastActivityAt: now,
    };
  }

  private async buildChangeRequestMessageArgs(
    deal: DealEntity,
    comment: string,
  ): Promise<{
    dealId: string;
    channel: string;
    price: string;
    createdAt: string;
    comment: string;
  }> {
    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });
    const channelLabel = channel
      ? channel.username
        ? `@${channel.username}`
        : channel.title
      : '-';

    const price = deal.listingSnapshot?.priceNano
      ? `${formatTon(deal.listingSnapshot.priceNano)} ${
          deal.listingSnapshot.currency ?? DEFAULT_CURRENCY
        }`
      : '-';

    return {
      dealId: deal.id.slice(0, 8),
      channel: channelLabel,
      price,
      createdAt: this.formatUtcTimestamp(deal.createdAt),
      comment,
    };
  }

  private formatUtcTimestamp(value: Date): string {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');

    return `${year}.${month}.${day} ${hours}:${minutes}`;
  }

  private addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  private addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }

  private isLocalEnvironment(): boolean {
    return (process.env.NODE_ENV ?? '').toLowerCase() === 'local';
  }

  private computeIdleExpiry(stage: DealStage, now: Date): Date | null {
    switch (stage) {
      case DealStage.CREATIVE_AWAITING_CONFIRM:
        return this.addMinutes(now, DEALS_CONFIG.DEAL_IDLE_EXPIRE_MINUTES);
      case DealStage.CREATIVE_AWAITING_SUBMIT:
      case DealStage.CREATIVE_AWAITING_FOR_CHANGES:
        return this.addMinutes(
          now,
          DEALS_CONFIG.CREATIVE_SUBMIT_DEADLINE_MINUTES,
        );
      case DealStage.SCHEDULING_AWAITING_SUBMIT:
      case DealStage.SCHEDULE_AWAITING_FOR_CHANGES:
        return this.addMinutes(
          now,
          DEALS_CONFIG.SCHEDULE_SUBMIT_DEADLINE_MINUTES,
        );
      case DealStage.SCHEDULING_AWAITING_CONFIRM:
        return this.addHours(now, DEALS_CONFIG.ADMIN_RESPONSE_DEADLINE_HOURS);
      default:
        return null;
    }
  }

  private async ensurePublisherAdmin(userId: string, deal: DealEntity) {
    try {
      await this.channelModeratorsService.requireCanReviewDeals(
        deal.channelId,
        userId,
      );
    } catch (error) {
      this.logger.warn(
        `[ensurePublisherAdmin] unauthorized channelId=${deal.channelId} userId=${userId} dealId=${deal.id} error=${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      if (
        error instanceof ChannelServiceError &&
        error.code === ChannelErrorCode.NOT_ADMIN_ANYMORE
      ) {
        await this.cancelDealForAdminRightsLoss(deal);
      }
      throw new DealServiceError(DealErrorCode.UNAUTHORIZED);
    }

    if (!deal.publisherUserId || deal.publisherUserId !== userId) {
      await this.dealRepository.update(deal.id, {
        publisherUserId: userId,
      });
      deal.publisherUserId = userId;
    }
  }

  private async resolveDealAdminUserIdByTelegram(
    dealId: string,
    telegramUserId: string,
  ): Promise<string | null> {
    console.log(telegramUserId);
    console.log(dealId);
    const deal = await this.dealRepository.findOne({
      where: { id: dealId },
      select: ['id', 'channelId'],
    });

    if (!deal) {
      return null;
    }

    const memberships = await this.membershipRepository.find({
      where: {
        channelId: deal.channelId,
        telegramUserId,
        isActive: true,
        isManuallyDisabled: false,
        role: In([ChannelRole.OWNER, ChannelRole.MODERATOR]),
      },
      order: { createdAt: 'ASC' },
    });
    console.log(memberships);

    if (memberships.length === 0) {
      return null;
    }

    const reviewerMembership = memberships.find(
      (membership) =>
        membership.role === ChannelRole.OWNER || membership.canReviewDeals,
    );
    console.log(reviewerMembership);
    return reviewerMembership?.userId ?? null;
  }

  private async cancelDealForAdminRightsLoss(deal: DealEntity): Promise<void> {
    const now = new Date();
    await this.dealRepository.update(deal.id, {
      status: DealStatus.CANCELED,
      stage: DealStage.FINALIZED,
      cancelReason: 'ADMIN_RIGHTS_LOST',
      lastActivityAt: now,
    });

    await this.paymentsService.refundEscrow(deal.id, 'ADMIN_RIGHTS_LOST');

    await this.dealsNotificationsService.notifyAdvertiser(
      deal,
      'telegram.deal.canceled.admin_rights_lost',
    );
  }
}

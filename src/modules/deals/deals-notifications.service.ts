import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DealEntity } from './entities/deal.entity';
import { DealCreativeEntity } from './entities/deal-creative.entity';
import { DealEscrowEntity } from './entities/deal-escrow.entity';
import { ChannelEntity } from '../channels/entities/channel.entity';
import { ChannelParticipantsService } from '../channels/channel-participants.service';
import { DealsDeepLinkService } from './deals-deep-link.service';
import { User } from '../auth/entities/user.entity';
import { buildMiniAppDealLink } from '../telegram/bot/utils/miniapp-links';
import { formatTon } from '../payments/utils/bigint';
import { CurrencyCode } from '../../common/constants/currency/currency.constants';
import { TransactionEntity } from '../payments/entities/transaction.entity';
import { TransactionStatus } from '../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../common/constants/payments/transaction-type.constants';
import { getUserTimeZone } from '../../common/time/time.utils';
import {
  TelegramI18nService,
  TelegramLanguage,
} from '../telegram/i18n/telegram-i18n.service';
import {
  TelegramInlineButtonSpec,
  TelegramMessengerService,
} from '../telegram/telegram-messenger.service';

const NOTIFICATION_CONCURRENCY = 5;

type DealActionReason = 'verification' | 'approval' | 'payment' | 'publish';

type DealCompletionStatsPayload = {
  views: number | null;
  trackedChannels: number;
  subscribersDelta: number;
};

@Injectable()
export class DealsNotificationsService {
  private readonly logger = new Logger(DealsNotificationsService.name);

  constructor(
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    private readonly participantsService: ChannelParticipantsService,
    private readonly deepLinkService: DealsDeepLinkService,
    private readonly telegramI18nService: TelegramI18nService,
    @Inject(forwardRef(() => TelegramMessengerService))
    private readonly telegramMessengerService: TelegramMessengerService,
  ) {}

  async notifyPinMissingWarning(
    dealId: string,
    includeAllReviewers: boolean,
  ): Promise<void> {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });
    if (!deal) {
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });
    if (!channel) {
      return;
    }

    const recipients = await this.participantsService.getDealReviewers(
      deal.channelId,
      includeAllReviewers,
    );
    if (recipients.length === 0) {
      return;
    }

    const channelLabel = channel.username
      ? `@${channel.username}`
      : channel.title;
    const messageArgs = {
      channel: channelLabel,
      dealId: deal.id.slice(0, 8),
    };

    await this.runWithConcurrency(
      recipients,
      NOTIFICATION_CONCURRENCY,
      async (recipient) => {
        try {
          await this.telegramMessengerService.sendText(
            recipient.telegramId as string,
            'telegram.deal.pin_missing_warning',
            messageArgs,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to send pin warning: dealId=${deal.id} recipient=${recipient.id} error=${errorMessage}`,
          );
        }
      },
    );
  }

  async notifyPinMissingFinalized(
    dealId: string,
    includeAllReviewers: boolean,
  ): Promise<void> {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });
    if (!deal) {
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });
    if (!channel) {
      return;
    }

    const recipients = await this.participantsService.getDealReviewers(
      deal.channelId,
      includeAllReviewers,
    );

    const channelLabel = channel.username
      ? `@${channel.username}`
      : channel.title;
    const messageArgs = {
      channel: channelLabel,
      dealId: deal.id.slice(0, 8),
    };

    if (recipients.length > 0) {
      await this.runWithConcurrency(
        recipients,
        NOTIFICATION_CONCURRENCY,
        async (recipient) => {
          try {
            await this.telegramMessengerService.sendText(
              recipient.telegramId as string,
              'telegram.deal.pin_missing_finalized',
              messageArgs,
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to send pin finalized: dealId=${deal.id} recipient=${recipient.id} error=${errorMessage}`,
            );
          }
        },
      );
    }

    const advertiser = await this.userRepository.findOne({
      where: { id: deal.advertiserUserId },
    });
    if (advertiser?.telegramId) {
      await this.telegramMessengerService.sendText(
        advertiser.telegramId,
        'telegram.deal.pin_missing_finalized',
        messageArgs,
      );
    }
  }

  async notifyPinCheckUnavailable(dealId: string): Promise<void> {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });
    if (!deal) {
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });
    if (!channel) {
      return;
    }

    const owner = await this.userRepository.findOne({
      where: { id: channel.ownerUserId },
    });
    if (!owner?.telegramId) {
      return;
    }

    const channelLabel = channel.username
      ? `@${channel.username}`
      : channel.title;
    await this.telegramMessengerService.sendText(
      owner.telegramId,
      'telegram.deal.pin_check_unavailable',
      {
        channel: channelLabel,
        dealId: deal.id.slice(0, 8),
      },
    );
  }

  async notifyCreativeRequired(
    deal: DealEntity,
    advertiserTelegramId: string,
  ): Promise<void> {
    const link = this.deepLinkService.buildDealLink(deal.id);
    await this.telegramMessengerService.sendInlineKeyboard(
      advertiserTelegramId,
      'telegram.deal.creative_required.message',
      undefined,
      [[{ textKey: 'telegram.common.open_mini_app', webAppUrl: link }]],
    );
  }

  async notifyCreativeSubmitted(
    deal: DealEntity,
    creative: DealCreativeEntity,
  ): Promise<void> {
    if (!deal.channelId) {
      this.logger.warn(
        `Skipping creative notification: missing channelId for deal ${deal.id}`,
      );
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });
    if (!channel) {
      this.logger.warn(
        `Skipping creative notification: channel not found for deal ${deal.id}`,
      );
      return;
    }

    const recipients = await this.participantsService.getNotificationRecipients(
      deal.channelId,
    );
    if (recipients.length === 0) {
      this.logger.log(
        `No recipients found for creative notification: dealId=${deal.id} channelId=${deal.channelId}`,
      );
      return;
    }

    const scheduledAtValue = deal.scheduledAt ?? null;
    const channelLabel = channel.username
      ? `@${channel.username}`
      : channel.title;

    const link = this.deepLinkService.buildDealLink(deal.id);
    const buttons: TelegramInlineButtonSpec[][] = [
      [
        {
          textKey: 'telegram.deal.buttons.approve',
          callbackData: `approve_creative:${deal.id}`,
        },
      ],
      [
        {
          textKey: 'telegram.deal.buttons.request_changes',
          callbackData: `request_changes:${deal.id}`,
        },
      ],
      [
        {
          textKey: 'telegram.deal.buttons.reject',
          callbackData: `reject_creative:${deal.id}`,
        },
      ],
    ];
    const payload = (creative.payload ?? {}) as Record<string, unknown>;
    const creativeText = String(payload.text ?? payload.caption ?? '');
    const textContent = creativeText;
    const creativeType = String(payload.type ?? 'TEXT');
    const mediaFileId = payload.mediaFileId as string | undefined;

    await this.runWithConcurrency(
      recipients,
      NOTIFICATION_CONCURRENCY,
      async (recipient) => {
        try {
          const lang =
            this.telegramI18nService.resolveLanguageForUser(recipient);
          const scheduledAt = this.formatDeadlineForUser(
            scheduledAtValue,
            recipient,
            lang,
          );
          const actionDeadline = this.formatDeadlineForUser(
            deal.idleExpiresAt,
            recipient,
            lang,
          );
          const messageArgs = {
            channel: channelLabel,
            dealId: deal.id.slice(0, 8),
            scheduledAt,
            creativeText: textContent,
            actionDeadline,
          };
          if (creativeType === 'TEXT') {
            await this.telegramMessengerService.sendInlineKeyboard(
              recipient.telegramId as string,
              'telegram.deal.creative_submitted.message',
              messageArgs,
              buttons,
              { lang },
            );
          } else if (creativeType === 'IMAGE' && mediaFileId) {
            await this.telegramMessengerService.sendPhotoWithCaption(
              recipient.telegramId as string,
              mediaFileId,
              'telegram.deal.creative_submitted.message',
              messageArgs,
              { lang, buttons },
            );
          } else if (creativeType === 'VIDEO' && mediaFileId) {
            await this.telegramMessengerService.sendVideoWithCaption(
              recipient.telegramId as string,
              mediaFileId,
              'telegram.deal.creative_submitted.message',
              messageArgs,
              { lang, buttons },
            );
          } else {
            await this.telegramMessengerService.sendInlineKeyboard(
              recipient.telegramId as string,
              'telegram.deal.creative_submitted.unsupported_preview',
              {
                channel: channelLabel,
                dealId: deal.id.slice(0, 8),
                scheduledAt,
                actionDeadline,
              },
              buttons,
              { lang },
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to send creative notification: dealId=${deal.id} recipient=${recipient.id} error=${errorMessage}`,
          );
        }
      },
    );

    await this.notifyAdvertiserStep(
      deal,
      'telegram.deal.creative_submitted.advertiser',
    );
  }

  async notifyScheduleSubmitted(
    deal: DealEntity,
    creative: DealCreativeEntity,
  ): Promise<void> {
    if (!deal.channelId) {
      this.logger.warn(
        `Skipping schedule notification: missing channelId for deal ${deal.id}`,
      );
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });
    if (!channel) {
      this.logger.warn(
        `Skipping schedule notification: channel not found for deal ${deal.id}`,
      );
      return;
    }

    const recipients = await this.participantsService.getNotificationRecipients(
      deal.channelId,
    );
    if (recipients.length === 0) {
      this.logger.log(
        `No recipients found for schedule notification: dealId=${deal.id} channelId=${deal.channelId}`,
      );
      return;
    }

    const scheduledAtValue = deal.scheduledAt ?? null;
    const channelLabel = channel.username
      ? `@${channel.username}`
      : channel.title;

    const buttons: TelegramInlineButtonSpec[][] = [
      [
        {
          textKey: 'telegram.deal.buttons.confirm',
          callbackData: `approve_schedule:${deal.id}`,
        },
      ],
      [
        {
          textKey: 'telegram.deal.buttons.request_changes',
          callbackData: `request_schedule_changes:${deal.id}`,
        },
      ],
      [
        {
          textKey: 'telegram.deal.buttons.cancel',
          callbackData: `reject_schedule:${deal.id}`,
        },
      ],
    ];

    const payload = (creative.payload ?? {}) as Record<string, unknown>;
    const creativeText = String(payload.text ?? payload.caption ?? '');
    const textContent = creativeText;
    const creativeType = String(payload.type ?? 'TEXT');
    const mediaFileId = payload.mediaFileId as string | undefined;

    await this.runWithConcurrency(
      recipients,
      NOTIFICATION_CONCURRENCY,
      async (recipient) => {
        try {
          const lang =
            this.telegramI18nService.resolveLanguageForUser(recipient);
          const scheduledAt = this.formatDeadlineForUser(
            scheduledAtValue,
            recipient,
            lang,
          );
          const actionDeadline = this.formatDeadlineForUser(
            deal.idleExpiresAt,
            recipient,
            lang,
          );
          const messageArgs = {
            channel: channelLabel,
            dealId: deal.id.slice(0, 8),
            scheduledAt,
            creativeText: textContent,
            actionDeadline,
          };
          if (creativeType === 'TEXT') {
            await this.telegramMessengerService.sendInlineKeyboard(
              recipient.telegramId as string,
              'telegram.deal.schedule_submitted.message',
              messageArgs,
              buttons,
              { lang },
            );
          } else if (creativeType === 'IMAGE' && mediaFileId) {
            await this.telegramMessengerService.sendPhotoWithCaption(
              recipient.telegramId as string,
              mediaFileId,
              'telegram.deal.schedule_submitted.message',
              messageArgs,
              { lang, buttons },
            );
          } else if (creativeType === 'VIDEO' && mediaFileId) {
            await this.telegramMessengerService.sendVideoWithCaption(
              recipient.telegramId as string,
              mediaFileId,
              'telegram.deal.schedule_submitted.message',
              messageArgs,
              { lang, buttons },
            );
          } else {
            await this.telegramMessengerService.sendInlineKeyboard(
              recipient.telegramId as string,
              'telegram.deal.schedule_submitted.unsupported_preview',
              {
                channel: channelLabel,
                dealId: deal.id.slice(0, 8),
                scheduledAt,
                actionDeadline,
              },
              buttons,
              { lang },
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to send schedule notification: dealId=${deal.id} recipient=${recipient.id} error=${errorMessage}`,
          );
        }
      },
    );

    await this.notifyAdvertiserStep(
      deal,
      'telegram.deal.schedule_submitted.advertiser',
    );
  }

  async notifyDealReviewAction(
    deal: DealEntity,
    actorUserId: string,
    action: 'approved' | 'rejected',
  ): Promise<void> {
    if (!deal.channelId) {
      this.logger.warn(
        `Skipping review notification: missing channelId for deal ${deal.id}`,
      );
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });
    if (!channel) {
      this.logger.warn(
        `Skipping review notification: channel not found for deal ${deal.id}`,
      );
      return;
    }

    const recipients = await this.participantsService.getNotificationRecipients(
      deal.channelId,
    );
    const filteredRecipients = recipients.filter(
      (recipient) => recipient.id !== actorUserId,
    );

    if (filteredRecipients.length === 0) {
      this.logger.log(
        `No recipients found for review notification: dealId=${deal.id} channelId=${deal.channelId} actorUserId=${actorUserId}`,
      );
      return;
    }

    const actor = await this.userRepository.findOne({
      where: { id: actorUserId },
    });
    const adminName = this.resolveDisplayName(actor);
    const channelLabel = channel.username
      ? `@${channel.username}`
      : channel.title;
    const messageKey =
      action === 'approved'
        ? 'telegram.deal.admin_review.approved'
        : 'telegram.deal.admin_review.rejected';
    const priceNano = deal.listingSnapshot?.priceNano;
    const currency = deal.listingSnapshot?.currency ?? CurrencyCode.TON;
    await this.runWithConcurrency(
      filteredRecipients,
      NOTIFICATION_CONCURRENCY,
      async (recipient) => {
        try {
          const lang =
            this.telegramI18nService.resolveLanguageForUser(recipient);
          const publishTime = this.formatDeadlineForUser(
            deal.scheduledAt,
            recipient,
            lang,
          );
          const messageArgs = {
            adminName,
            channel: channelLabel,
            dealId: deal.id.slice(0, 8),
            price: priceNano ? formatTon(priceNano) : '-',
            currency,
            publishTime,
          };

          await this.telegramMessengerService.sendText(
            recipient.telegramId as string,
            messageKey,
            messageArgs,
            { lang },
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to send review notification: dealId=${deal.id} recipient=${recipient.id} error=${errorMessage}`,
          );
        }
      },
    );
  }

  async notifyAdvertiser(
    deal: DealEntity,
    messageKey: string,
    messageArgs?: Record<string, any>,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: deal.advertiserUserId },
    });
    if (!user?.telegramId) {
      return;
    }
    await this.telegramMessengerService.sendText(
      user.telegramId,
      messageKey,
      messageArgs,
      { lang: this.telegramI18nService.resolveLanguageForUser(user) },
    );
  }

  async notifyAdvertiserPartialPayment(
    deal: DealEntity,
    receivedNano: string,
    remainingNano: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: deal.advertiserUserId },
    });
    if (!user?.telegramId) {
      return;
    }

    const link = this.ensureMiniAppLink(deal.id);
    const messageArgs = {
      dealId: deal.id.slice(0, 8),
      received: formatTon(receivedNano),
      remaining: formatTon(remainingNano),
      currency: CurrencyCode.TON,
    };
    const buttons: TelegramInlineButtonSpec[][] = link
      ? [
          [
            {
              textKey: 'telegram.common.pay_in_app',
              webAppUrl: link,
            },
          ],
        ]
      : [];

    if (buttons.length) {
      await this.telegramMessengerService.sendInlineKeyboard(
        user.telegramId,
        'telegram.deal.partial_payment.message',
        messageArgs,
        buttons,
        { lang: this.telegramI18nService.resolveLanguageForUser(user) },
      );
    } else {
      await this.telegramMessengerService.sendText(
        user.telegramId,
        'telegram.deal.partial_payment.message',
        messageArgs,
        { lang: this.telegramI18nService.resolveLanguageForUser(user) },
      );
    }
  }

  async notifyPaymentConfirmed(deal: DealEntity): Promise<void> {
    const advertiser = await this.userRepository.findOne({
      where: { id: deal.advertiserUserId },
    });

    const transactionUrl = await this.resolveTransactionUrl(deal.id);
    const messageKey = transactionUrl
      ? 'telegram.deal.payment_confirmed.with_tx'
      : 'telegram.deal.payment_confirmed.message';
    const messageArgs = {
      dealId: deal.id.slice(0, 8),
      txUrl: transactionUrl ?? undefined,
    };
    const link = this.ensureMiniAppLink(deal.id);
    const buttons: TelegramInlineButtonSpec[][] = link
      ? [[{ textKey: 'telegram.common.open_mini_app', webAppUrl: link }]]
      : [];

    if (advertiser?.telegramId) {
      if (buttons.length) {
        await this.telegramMessengerService.sendInlineKeyboard(
          advertiser.telegramId,
          messageKey,
          messageArgs,
          buttons,
          {
            lang: this.telegramI18nService.resolveLanguageForUser(advertiser),
          },
        );
      } else {
        await this.telegramMessengerService.sendText(
          advertiser.telegramId,
          messageKey,
          messageArgs,
          {
            lang: this.telegramI18nService.resolveLanguageForUser(advertiser),
          },
        );
      }
    }

    const recipients = await this.participantsService.getNotificationRecipients(
      deal.channelId,
    );
    await this.runWithConcurrency(
      recipients,
      NOTIFICATION_CONCURRENCY,
      async (recipient) => {
        if (!recipient.telegramId) {
          return;
        }
        if (buttons.length) {
          await this.telegramMessengerService.sendInlineKeyboard(
            recipient.telegramId,
            messageKey,
            messageArgs,
            buttons,
            {
              lang: this.telegramI18nService.resolveLanguageForUser(recipient),
            },
          );
        } else {
          await this.telegramMessengerService.sendText(
            recipient.telegramId,
            messageKey,
            messageArgs,
            {
              lang: this.telegramI18nService.resolveLanguageForUser(recipient),
            },
          );
        }
      },
    );
  }

  async notifyDealActionRequired(
    deal: DealEntity,
    reason: DealActionReason,
  ): Promise<void> {
    await this.notifyDeal(deal, {
      type: 'ACTION_REQUIRED',
      messageKey: 'telegram.deal.notification.action_required',
      reasonKey: this.mapReasonKey(reason),
    });
  }

  async notifyPostNotPublishedAdmin(deal: DealEntity): Promise<void> {
    await this.notifyDeal(deal, {
      type: 'POST_NOT_PUBLISHED',
      messageKey: 'telegram.deal.notification.post_not_published_admin',
    });
  }

  async notifyPostPublishedAdmin(deal: DealEntity): Promise<void> {
    await this.notifyDeal(deal, {
      type: 'POST_PUBLISHED',
      messageKey: 'telegram.deal.notification.post_published_admin',
    });
  }

  async notifyPostCheckUnavailableAdmin(deal: DealEntity): Promise<void> {
    await this.notifyDeal(deal, {
      type: 'POST_CHECK_UNAVAILABLE',
      messageKey: 'telegram.deal.notification.post_check_unavailable_admin',
    });
  }

  async notifyPostPublishedAdvertiser(
    deal: DealEntity,
    mustRemainUntil: Date | null,
    postUrl: string | null,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: deal.advertiserUserId },
    });
    if (!user?.telegramId) {
      return;
    }
    const lang = this.telegramI18nService.resolveLanguageForUser(user);
    const mustRemainUntilText = this.formatDeadlineForUser(
      mustRemainUntil,
      user,
      lang,
    );

    if (postUrl) {
      await this.telegramMessengerService.sendInlineKeyboard(
        user.telegramId,
        'telegram.deal.post.published',
        {
          mustRemainUntil: mustRemainUntilText,
        },
        [[{ textKey: 'telegram.deal.buttons.open_post', url: postUrl }]],
        { lang },
      );

      return;
    }

    await this.telegramMessengerService.sendText(
      user.telegramId,
      'telegram.deal.post.published',
      {
        mustRemainUntil: mustRemainUntilText,
      },
      { lang },
    );
  }

  async notifyPostDeletedAdmin(deal: DealEntity): Promise<void> {
    await this.notifyDeal(deal, {
      type: 'POST_DELETED',
      messageKey: 'telegram.deal.notification.post_deleted_admin',
    });
  }

  async notifyPostEditedAdmin(deal: DealEntity): Promise<void> {
    await this.notifyDeal(deal, {
      type: 'POST_EDITED',
      messageKey: 'telegram.deal.notification.post_edited_admin',
    });
  }

  async notifyPostDeleteFailedAdmin(deal: DealEntity): Promise<void> {
    await this.notifyDeal(deal, {
      type: 'POST_DELETE_FAILED',
      messageKey: 'telegram.deal.notification.post_delete_failed_admin',
    });
  }

  async notifyDealCompletedAdmin(
    deal: DealEntity,
    amountNano: string,
    currency: CurrencyCode,
  ): Promise<void> {
    await this.notifyDeal(
      deal,
      {
        type: 'DEAL_COMPLETED',
        messageKey: 'telegram.deal.notification.deal_completed_admin',
      },
      {
        amount: formatTon(amountNano),
        currency,
      },
    );
  }

  async notifyDealCompletedAdvertiser(
    deal: DealEntity,
    amountNano: string,
    currency: CurrencyCode,
  ): Promise<void> {
    await this.notifyAdvertiser(
      deal,
      'telegram.deal.post.completed_advertiser_with_amount',
      {
        amount: formatTon(amountNano),
        currency,
      },
    );
  }

  async notifyDealCompletedStatsAdvertiser(
    deal: DealEntity,
    stats: DealCompletionStatsPayload,
  ): Promise<void> {
    await this.notifyAdvertiser(
      deal,
      'telegram.deal.post.completed_stats_advertiser',
      {
        views: this.formatOptionalStat(stats.views),
        trackedChannels: stats.trackedChannels,
        subscribersDelta: stats.subscribersDelta,
      },
    );
  }

  async notifyDealCompletedStatsAdmin(
    deal: DealEntity,
    stats: DealCompletionStatsPayload,
  ): Promise<void> {
    await this.notifyDeal(
      deal,
      {
        type: 'DEAL_COMPLETED_STATS',
        messageKey: 'telegram.deal.notification.deal_completed_admin_stats',
      },
      {
        views: this.formatOptionalStat(stats.views),
        trackedChannels: stats.trackedChannels,
        subscribersDelta: stats.subscribersDelta,
      },
    );
  }

  private async notifyDeal(
    deal: DealEntity,
    payload: { type: string; messageKey: string; reasonKey?: string },
    extraArgs?: Record<string, any>,
  ): Promise<void> {
    if (!deal.channelId) {
      this.logger.warn(
        `Skipping deal notification: missing channelId for deal ${deal.id}`,
      );
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: deal.channelId },
    });

    if (!channel) {
      this.logger.warn(
        `Skipping deal notification: channel not found for deal ${deal.id}`,
      );
      return;
    }

    const recipients = await this.participantsService.getNotificationRecipients(
      deal.channelId,
    );
    if (recipients.length === 0) {
      this.logger.log(
        `No recipients found for deal notification: dealId=${deal.id} channelId=${deal.channelId}`,
      );
      return;
    }

    const link = this.deepLinkService.buildDealLink(deal.id);
    const buttons: TelegramInlineButtonSpec[][] = [
      [{ textKey: 'telegram.common.open_deal', webAppUrl: link }],
    ];

    this.logger.log(
      `Sending deal notification ${payload.type}: dealId=${deal.id} channelId=${deal.channelId} recipients=${recipients.length}`,
    );

    await this.runWithConcurrency(
      recipients,
      NOTIFICATION_CONCURRENCY,
      async (recipient) => {
        try {
          if (!recipient.telegramId) {
            return;
          }
          const lang =
            this.telegramI18nService.resolveLanguageForUser(recipient);
          const channelLabel = channel.username
            ? `${channel.title} (@${channel.username})`
            : channel.title;
          const actionDeadline = this.formatDeadlineForUser(
            deal.idleExpiresAt,
            recipient,
            lang,
          );
          const args: Record<string, any> = {
            channel: channelLabel,
            dealId: deal.id.slice(0, 8),
            actionDeadline,
            ...(extraArgs ?? {}),
          };
          if (payload.reasonKey) {
            args.reason = this.telegramI18nService.t(lang, payload.reasonKey);
          }
          await this.telegramMessengerService.sendInlineKeyboard(
            recipient.telegramId,
            payload.messageKey,
            args,
            buttons,
            { lang },
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to send deal notification: dealId=${deal.id} recipient=${recipient.id} error=${errorMessage}`,
          );
        }
      },
    );
  }

  async notifyCreativeApproved(deal: DealEntity): Promise<void> {
    if (deal.channelId) {
      const link = this.deepLinkService.buildDealLink(deal.id);
      const buttons: TelegramInlineButtonSpec[][] = [
        [{ textKey: 'telegram.common.open_deal', webAppUrl: link }],
      ];

      const recipients =
        await this.participantsService.getNotificationRecipients(
          deal.channelId,
        );
      if (recipients.length === 0) {
        this.logger.log(
          `No recipients found for creative approved notification: dealId=${deal.id} channelId=${deal.channelId}`,
        );
      }

      await this.runWithConcurrency(
        recipients,
        NOTIFICATION_CONCURRENCY,
        async (recipient) => {
          if (!recipient.telegramId) {
            return;
          }
          const lang =
            this.telegramI18nService.resolveLanguageForUser(recipient);
          const actionDeadline = this.formatDeadlineForUser(
            deal.idleExpiresAt,
            recipient,
            lang,
          );
          await this.telegramMessengerService.sendInlineKeyboard(
            recipient.telegramId,
            'telegram.deal.creative_approved.admin',
            {
              dealId: deal.id.slice(0, 8),
              actionDeadline,
            },
            buttons,
            { lang },
          );
        },
      );
    } else {
      this.logger.warn(
        `Skipping creative approved admin notification: missing channelId for deal ${deal.id}`,
      );
    }

    await this.notifyAdvertiserStep(
      deal,
      'telegram.deal.creative_approved.advertiser',
    );
  }

  async notifyScheduleApproved(
    deal: DealEntity,
    escrow: DealEscrowEntity | null,
    options: { notifyAdvertiser?: boolean } = {},
  ): Promise<void> {
    if (deal.channelId) {
      const link = this.deepLinkService.buildDealLink(deal.id);
      const buttons: TelegramInlineButtonSpec[][] = [
        [{ textKey: 'telegram.common.open_deal', webAppUrl: link }],
      ];
      const paymentDeadline = escrow?.paymentDeadlineAt;

      const recipients =
        await this.participantsService.getNotificationRecipients(
          deal.channelId,
        );
      if (recipients.length === 0) {
        this.logger.log(
          `No recipients found for schedule approved notification: dealId=${deal.id} channelId=${deal.channelId}`,
        );
      }

      await this.runWithConcurrency(
        recipients,
        NOTIFICATION_CONCURRENCY,
        async (recipient) => {
          if (!recipient.telegramId) {
            return;
          }
          const lang =
            this.telegramI18nService.resolveLanguageForUser(recipient);
          const deadlineLabel = this.formatDeadlineForUser(
            paymentDeadline,
            recipient,
            lang,
          );
          await this.telegramMessengerService.sendInlineKeyboard(
            recipient.telegramId,
            'telegram.deal.schedule_approved.admin',
            {
              dealId: deal.id.slice(0, 8),
              paymentDeadline: deadlineLabel,
            },
            buttons,
            { lang },
          );
        },
      );
    } else {
      this.logger.warn(
        `Skipping schedule approved admin notification: missing channelId for deal ${deal.id}`,
      );
    }

    if (options.notifyAdvertiser !== false) {
      const paymentDeadline = escrow?.paymentDeadlineAt ?? null;
      const amountNano = escrow?.amountNano ?? null;
      const currency = escrow?.currency ?? null;
      await this.notifyAdvertiserStep(
        deal,
        'telegram.deal.schedule_approved.advertiser',
        paymentDeadline,
        this.buildPaymentButtons(deal.id),
        (lang) => ({
          amount: amountNano
            ? formatTon(amountNano)
            : this.telegramI18nService.t(lang, 'telegram.common.tbd'),
          currency:
            currency ?? this.telegramI18nService.t(lang, 'telegram.common.tbd'),
        }),
      );
    }
  }

  async notifyScheduleConfirmTooLate(deal: DealEntity): Promise<void> {
    if (deal.channelId) {
      const recipients =
        await this.participantsService.getNotificationRecipients(
          deal.channelId,
        );

      await this.runWithConcurrency(
        recipients,
        NOTIFICATION_CONCURRENCY,
        async (recipient) => {
          if (!recipient.telegramId) {
            return;
          }

          await this.telegramMessengerService.sendText(
            recipient.telegramId,
            'telegram.deal.schedule_confirm_too_late.admin',
            {},
            {
              lang: this.telegramI18nService.resolveLanguageForUser(recipient),
            },
          );
        },
      );
    }

    await this.notifyAdvertiser(
      deal,
      'telegram.deal.schedule_confirm_too_late.advertiser',
    );
  }

  private formatUtcTimestamp(value: Date): string {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');

    return `${year}.${month}.${day} ${hours}:${minutes}`;
  }

  private mapReasonKey(reason: DealActionReason): string {
    switch (reason) {
      case 'verification':
        return 'telegram.deal.action_reason.verification';
      case 'approval':
        return 'telegram.deal.action_reason.approval';
      case 'payment':
        return 'telegram.deal.action_reason.payment';
      case 'publish':
        return 'telegram.deal.action_reason.publish';
      default:
        return 'telegram.deal.action_reason.generic';
    }
  }

  private ensureMiniAppLink(dealId: string): string | null {
    const link = buildMiniAppDealLink(dealId);
    try {
      const url = new URL(link);
      if (url.protocol !== 'https:') {
        this.logger.warn(`Invalid Mini App URL protocol for deal ${dealId}`);
        return null;
      }
      return link;
    } catch (error) {
      this.logger.warn(`Invalid Mini App URL for deal ${dealId}`);
      return null;
    }
  }

  private async resolveTransactionUrl(dealId: string): Promise<string | null> {
    const transaction = await this.transactionRepository.findOne({
      where: {
        dealId,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.COMPLETED,
      },
      order: { confirmedAt: 'DESC' },
    });

    if (!transaction) {
      return null;
    }

    if (transaction.externalExplorerUrl) {
      return transaction.externalExplorerUrl;
    }

    if (transaction.externalTxHash) {
      return this.buildTonScanUrl(transaction.externalTxHash);
    }

    return null;
  }

  private buildTonScanUrl(txHash: string): string {
    return `https://tonscan.org/ru/tx/${txHash}`;
  }

  private formatDeadlineForUser(
    value: Date | null | undefined,
    user: User | null | undefined,
    lang: TelegramLanguage,
  ): string {
    if (!value) {
      return this.telegramI18nService.t(lang, 'telegram.common.tbd');
    }

    const timeZone = getUserTimeZone(user);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);

    const partsMap = parts.reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

    const gmtOffset =
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'shortOffset',
      })
        .formatToParts(value)
        .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';

    const localDateTime = `${partsMap.day}.${partsMap.month}.${partsMap.year} ${partsMap.hour}:${partsMap.minute} ${gmtOffset}`;

    return this.telegramI18nService.t(
      lang,
      'telegram.common.local_time_with_gmt',
      {
        localDateTime,
      },
    );
  }

  private async notifyAdvertiserStep(
    deal: DealEntity,
    messageKey: string,
    deadline?: Date | null,
    buttons?: TelegramInlineButtonSpec[][],
    extraArgs?:
      | Record<string, any>
      | ((lang: TelegramLanguage) => Record<string, any>),
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: deal.advertiserUserId },
    });
    if (!user?.telegramId) {
      return;
    }

    const resolvedButtons = buttons ?? [
      [
        {
          textKey: 'telegram.common.open_deal',
          webAppUrl: this.deepLinkService.buildDealLink(deal.id),
        },
      ],
    ];
    const lang = this.telegramI18nService.resolveLanguageForUser(user);
    const actionDeadline = this.formatDeadlineForUser(
      deadline ?? deal.idleExpiresAt,
      user,
      lang,
    );

    const resolvedExtraArgs =
      typeof extraArgs === 'function' ? extraArgs(lang) : extraArgs;

    await this.telegramMessengerService.sendInlineKeyboard(
      user.telegramId,
      messageKey,
      {
        dealId: deal.id.slice(0, 8),
        actionDeadline,
        paymentDeadline: actionDeadline,
        ...resolvedExtraArgs,
      },
      resolvedButtons,
      { lang },
    );
  }

  private buildPaymentButtons(dealId: string): TelegramInlineButtonSpec[][] {
    const link = this.ensureMiniAppLink(dealId);
    if (!link) {
      return [
        [
          {
            textKey: 'telegram.common.open_deal',
            webAppUrl: this.deepLinkService.buildDealLink(dealId),
          },
        ],
      ];
    }
    return [
      [
        {
          textKey: 'telegram.common.pay_in_app',
          webAppUrl: link,
        },
      ],
    ];
  }

  private resolveDisplayName(user?: User | null): string {
    if (!user) {
      return 'Admin';
    }
    const fullName = [user.firstName, user.lastName]
      .filter((value) => Boolean(value))
      .join(' ')
      .trim();
    if (fullName) {
      return fullName;
    }
    if (user.username) {
      return user.username;
    }
    return 'Admin';
  }

  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<void>,
  ): Promise<void> {
    const queue = [...items];
    const workerCount = Math.min(limit, queue.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) {
          return;
        }
        await task(item);
      }
    });

    await Promise.all(workers);
  }

  private formatOptionalStat(value: number | null): string {
    if (value === null || Number.isNaN(value)) {
      return '-';
    }

    return String(value);
  }
}

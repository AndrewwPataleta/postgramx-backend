import type { QueryDeepPartialEntity } from '../../../core/typeorm.types';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DealPublicationEntity } from '../entities/deal-publication.entity';
import { ChannelEntity } from '../../channels/entities/channel.entity';
import { DealStage } from '../../../common/constants/deals/deal-stage.constants';
import { DealStatus } from '../../../common/constants/deals/deal-status.constants';
import { DEAL_PUBLICATION_ERRORS } from '../../../common/constants/deals/deal-publication-errors.constants';
import {
  TelegramChannelPostsService,
  TelegramMessageNotFoundError,
  TelegramMethodUnavailableError,
} from '../../telegram/services/telegram-channel-posts.service';
import { PublicationStatus } from '../../../common/constants/deals/publication-status.constants';

import {
  fingerprintEntities,
  fingerprintKeyboard,
  fingerprintMedia,
  normalizeText,
  TelegramMessage,
} from '../publication/telegramMessageFingerprint';
import { MIN_EDIT_CHECK_INTERVAL_MS } from '../../../common/constants/deals/deal-post-monitor.constants';
import { DEAL_DELIVERY_POSTING_CRON } from '../../../config/deal-delivery.config';

const TELEGRAM_POST_VERIFY_PROVIDER =
  process.env.TELEGRAM_POST_VERIFY_PROVIDER ?? 'mtproto';

@Injectable()
export class DealPostMonitorService {
  private readonly logger = new Logger(DealPostMonitorService.name);

  constructor(
    @InjectRepository(DealPublicationEntity)
    private readonly publicationRepository: Repository<DealPublicationEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    private readonly telegramChannelPostsService: TelegramChannelPostsService,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(DEAL_DELIVERY_POSTING_CRON)
  async runEditedPostCheckCron(): Promise<void> {
    if (TELEGRAM_POST_VERIFY_PROVIDER !== 'bot') {
      return;
    }
    const lockKey = 'deals:post-edited-check';
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

  async handleEditedChannelPost(payload: {
    chatId?: string | number | null;
    username?: string | null;
    messageId: string | number;
  }): Promise<void> {
    if (TELEGRAM_POST_VERIFY_PROVIDER !== 'bot') {
      return;
    }
    const channel = await this.resolveChannel(payload.chatId, payload.username);
    if (!channel) {
      return;
    }

    const now = new Date();
    const messageId = String(payload.messageId);

    await this.checkPublicationByChannelAndMessage({
      channel,
      messageId,
      now,
    });
  }

  private async handleBatch(): Promise<void> {
    const now = new Date();
    const allowedStages = [
      DealStage.POSTED_VERIFYING,
      DealStage.DELIVERY_CONFIRMED,
    ];

    const candidates = await this.publicationRepository
      .createQueryBuilder('publication')
      .innerJoinAndSelect('publication.deal', 'deal')
      .innerJoinAndSelect('deal.channel', 'channel')
      .where('deal.stage IN (:...stages)', { stages: allowedStages })
      .andWhere('deal.status = :status', { status: DealStatus.ACTIVE })
      .andWhere('publication.status = :publicationStatus', {
        publicationStatus: PublicationStatus.POSTED,
      })
      .andWhere('publication.publishedMessageId IS NOT NULL')
      .getMany();

    for (const publication of candidates) {
      if (!publication.deal?.channel || !publication.publishedMessageId) {
        continue;
      }

      await this.checkPublicationByChannelAndMessage({
        channel: publication.deal.channel,
        messageId: publication.publishedMessageId,
        now,
      });
    }
  }

  private async checkPublicationByChannelAndMessage(payload: {
    channel: ChannelEntity;
    messageId: string;
    now: Date;
  }): Promise<void> {
    const { channel, messageId, now } = payload;

    await this.dataSource.transaction(async (manager) => {
      const publication = await manager
        .getRepository(DealPublicationEntity)
        .createQueryBuilder('publication')
        .setLock('pessimistic_write')
        .innerJoinAndSelect('publication.deal', 'deal')
        .where('publication.publishedMessageId = :messageId', { messageId })
        .andWhere('deal.channelId = :channelId', { channelId: channel.id })
        .getOne();

      if (!publication?.deal) {
        return;
      }

      if (
        ![DealStage.POSTED_VERIFYING, DealStage.DELIVERY_CONFIRMED].includes(
          publication.deal.stage,
        ) ||
        publication.deal.status !== DealStatus.ACTIVE
      ) {
        return;
      }

      if (publication.error === DEAL_PUBLICATION_ERRORS.POST_EDITED) {
        return;
      }

      if (
        publication.lastCheckedAt &&
        now.getTime() - publication.lastCheckedAt.getTime() <
          MIN_EDIT_CHECK_INTERVAL_MS
      ) {
        return;
      }

      const currentMessageState = await this.fetchCurrentMessage(
        channel,
        messageId,
      );
      if (currentMessageState.state === 'unavailable') {
        return;
      }

      if (currentMessageState.state === 'deleted') {
        await manager
          .getRepository(DealPublicationEntity)
          .update(publication.id, {
            lastCheckedAt: now,
            error: DEAL_PUBLICATION_ERRORS.POST_EDITED,
          });

        this.logger.warn(
          JSON.stringify({
            event: 'post_deleted_detected',
            dealId: publication.dealId,
            publicationId: publication.id,
            messageId: publication.publishedMessageId,
            channelId: channel.id,
          }),
        );
        return;
      }

      const currentMessage = currentMessageState.message;

      if (!this.hasBaselineSnapshot(publication)) {
        await manager
          .getRepository(DealPublicationEntity)
          .update(publication.id, {
            ...this.snapshotFromMessage(currentMessage),
            lastCheckedAt: now,
          } as QueryDeepPartialEntity<DealPublicationEntity>);
        this.logger.log(
          JSON.stringify({
            event: 'post_snapshot_captured_late',
            dealId: publication.dealId,
            publicationId: publication.id,
            messageId: publication.publishedMessageId,
            channelId: channel.id,
          }),
        );
        return;
      }

      const currentText = normalizeText(currentMessage.text);
      const currentCaption = normalizeText(currentMessage.caption);
      const currentMediaFingerprint = fingerprintMedia(currentMessage);
      const currentKeyboardFingerprint = fingerprintKeyboard(currentMessage);
      const currentEntitiesFingerprint = fingerprintEntities(currentMessage);

      const baselineEntitiesFingerprint =
        (publication.publishedMessageSnapshotJson?.entitiesFingerprint as
          | string
          | undefined) ?? 'none';

      const textDiff = publication.publishedMessageText !== currentText;
      const captionDiff =
        publication.publishedMessageCaption !== currentCaption;
      const mediaDiff =
        publication.publishedMessageMediaFingerprint !==
        currentMediaFingerprint;
      const keyboardDiff =
        publication.publishedMessageKeyboardFingerprint !==
        currentKeyboardFingerprint;
      const entitiesDiff =
        baselineEntitiesFingerprint !== currentEntitiesFingerprint;

      const isEdited =
        textDiff || captionDiff || mediaDiff || keyboardDiff || entitiesDiff;

      await manager
        .getRepository(DealPublicationEntity)
        .update(publication.id, {
          lastCheckedAt: now,
          ...(isEdited ? { error: DEAL_PUBLICATION_ERRORS.POST_EDITED } : {}),
        });

      if (isEdited) {
        this.logger.warn(
          JSON.stringify({
            event: 'post_edited_detected',
            dealId: publication.dealId,
            publicationId: publication.id,
            messageId: publication.publishedMessageId,
            channelId: channel.id,
            diffs: {
              text: textDiff,
              caption: captionDiff,
              media: mediaDiff,
              keyboard: keyboardDiff,
              entities: entitiesDiff,
            },
          }),
        );
      }
    });
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

  private async fetchCurrentMessage(
    channel: ChannelEntity,
    messageId: string | null,
  ): Promise<
    | { state: 'ok'; message: TelegramMessage }
    | { state: 'deleted' }
    | { state: 'unavailable' }
  > {
    if (!messageId) {
      return { state: 'unavailable' };
    }

    if (!channel.telegramChatId && !channel.username) {
      return { state: 'unavailable' };
    }

    try {
      const message = await this.telegramChannelPostsService.getChannelMessage(
        channel.telegramChatId ?? `@${channel.username}`,
        messageId,
      );

      if (!message) {
        return { state: 'unavailable' };
      }

      return { state: 'ok', message };
    } catch (error) {
      if (error instanceof TelegramMethodUnavailableError) {
        return { state: 'unavailable' };
      }

      if (error instanceof TelegramMessageNotFoundError) {
        return { state: 'deleted' };
      }

      const message = error instanceof Error ? error.message : String(error);
      const [errorCode] = message.split(':');
      if (errorCode === '400' || errorCode === '403' || errorCode === '404') {
        this.logger.warn(
          `Skip edited-post check due Telegram API error for message ${messageId}: ${message}`,
        );
        return { state: 'unavailable' };
      }
      this.logger.warn(
        `Unexpected Telegram API error for message ${messageId}: ${message}`,
      );
      return { state: 'unavailable' };
    }
  }

  private hasBaselineSnapshot(publication: DealPublicationEntity): boolean {
    return (
      publication.publishedMessageText !== null ||
      publication.publishedMessageCaption !== null ||
      publication.publishedMessageMediaFingerprint !== null ||
      publication.publishedMessageKeyboardFingerprint !== null
    );
  }

  private snapshotFromMessage(
    message: TelegramMessage,
  ): Partial<DealPublicationEntity> {
    return {
      publishedMessageText: normalizeText(message.text),
      publishedMessageCaption: normalizeText(message.caption),
      publishedMessageMediaFingerprint: fingerprintMedia(message),
      publishedMessageKeyboardFingerprint: fingerprintKeyboard(message),
      publishedMessageSnapshotJson: {
        source: 'telegram_api',
        text: message.text ?? null,
        caption: message.caption ?? null,
        mediaFingerprint: fingerprintMedia(message),
        keyboard: message.reply_markup?.inline_keyboard ?? null,
        entitiesFingerprint: fingerprintEntities(message),
      },
    };
  }

  private async resolveChannel(
    chatId?: string | number | null,
    username?: string | null,
  ): Promise<ChannelEntity | null> {
    const chatIdValue =
      chatId !== undefined && chatId !== null ? String(chatId) : null;
    const usernameValue = username
      ? String(username).replace('@', '').toLowerCase()
      : null;
    if (!chatIdValue && !usernameValue) {
      return null;
    }

    const candidates = await this.channelRepository.find({
      where: [
        ...(chatIdValue ? [{ telegramChatId: chatIdValue }] : []),
        ...(usernameValue ? [{ username: usernameValue }] : []),
      ],
    });

    if (candidates.length > 1) {
      this.logger.warn(
        `Multiple channels matched edited post: chatId=${chatIdValue} username=${usernameValue}`,
      );
    }

    return candidates[0] ?? null;
  }
}

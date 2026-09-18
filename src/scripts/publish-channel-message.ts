'use strict';

import type { EntityManager, Repository, ObjectLiteral } from 'typeorm';

const { randomUUID } = require('crypto');
const dotenv = require('dotenv');
const { AppDataSource } = require('../database/datasource');
const { User } = require('../modules/auth/entities/user.entity');
const {
  ChannelEntity,
} = require('../modules/channels/entities/channel.entity');
const {
  ChannelMembershipEntity,
} = require('../modules/channels/entities/channel-membership.entity');
const { ChannelRole } = require('../modules/channels/types/channel-role.enum');
const { DealEntity } = require('../modules/deals/entities/deal.entity');
const {
  DealCreativeEntity,
} = require('../modules/deals/entities/deal-creative.entity');
const {
  DealEscrowEntity,
} = require('../modules/deals/entities/deal-escrow.entity');
const {
  DealPublicationEntity,
} = require('../modules/deals/entities/deal-publication.entity');
const {
  DealStatus,
} = require('../common/constants/deals/deal-status.constants');
const { DealStage } = require('../common/constants/deals/deal-stage.constants');
const {
  EscrowStatus,
} = require('../common/constants/deals/deal-escrow-status.constants');
const {
  CreativeStatus,
} = require('../common/constants/deals/creative-status.constants');
const {
  PublicationStatus,
} = require('../common/constants/deals/publication-status.constants');
const {
  PinVisibilityStatus,
} = require('../common/constants/deals/pin-visibility-status.constants');
const {
  CurrencyCode,
} = require('../common/constants/currency/currency.constants');
const {
  ListingFormat,
} = require('../common/constants/channels/listing-format.constants');

const SYSTEM_ADVERTISER_EMAIL = 'system-script-advertiser@postgramx.local';
const DEFAULT_PRICE_NANO = '1000000000';
const DEFAULT_VISIBLE_HOURS = 24;

function resolveMode() {
  const mode = (process.env.NODE_ENV || 'local').toLowerCase();
  if (mode === 'prod') {
    return 'production';
  }
  return mode;
}

dotenv.config({ path: `.env.${resolveMode()}`, override: true });

function printUsage() {
  console.log(
    [
      'Usage:',
      '  NODE_ENV=local npm run telegram:publish-channel-message -- 6d9654dd-a354-4357-b32e-533c8447b734 970a8d8b-e7ff-43b7-88a2-6efc805108f0 "qweqweqw"',
      '',
      'Description:',
      '  Creates full deal records (creative/escrow/publication timeline) and performs the final publish step to Telegram channel.',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]) {
  const [userId, channelId, ...textParts] = argv;
  const text = textParts.join(' ').trim();

  if (!userId || !channelId || !text) {
    printUsage();
    throw new Error('Missing required arguments: userId, channelId, text.');
  }

  return { userId, channelId, text };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function resolveTelegramChatId(channel: ObjectLiteral) {
  if (channel.telegramChatId) {
    return channel.telegramChatId;
  }
  if (channel.username) {
    return `@${channel.username}`;
  }
  return null;
}

async function telegramApi(token: string, method: string, payload: Record<string, unknown>) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  const body = await response.json();

  if (!response.ok || !body.ok) {
    throw new Error(
      body.description || `Telegram API ${method} request failed.`,
    );
  }

  return body.result;
}

async function ensureScriptAdvertiser(userRepository: Repository<ObjectLiteral>) {
  let advertiser = await userRepository.findOne({
    where: { email: SYSTEM_ADVERTISER_EMAIL },
  });

  if (!advertiser) {
    advertiser = userRepository.create({
      email: SYSTEM_ADVERTISER_EMAIL,
      username: 'system_script_advertiser',
      firstName: 'System',
      lastName: 'Advertiser',
      lang: 'en',
      isActive: true,
      isPremium: false,
    });
    advertiser = await userRepository.save(advertiser);
  }

  return advertiser;
}

async function ensurePublisherAccess(manager: EntityManager, userId: string, channel: ObjectLiteral) {
  if (channel.ownerUserId === userId) {
    return;
  }

  const membershipRepository = manager.getRepository(ChannelMembershipEntity);
  const membership = await membershipRepository.findOne({
    where: {
      channelId: channel.id,
      userId,
      isActive: true,
    },
  });

  if (
    !membership ||
    ![ChannelRole.OWNER, ChannelRole.MODERATOR].includes(membership.role)
  ) {
    throw new Error('User has no moderator/owner access to this channel.');
  }
}

function buildListingSnapshot(channelId: string) {
  return {
    listingId: randomUUID(),
    channelId,
    format: ListingFormat.POST,
    priceNano: DEFAULT_PRICE_NANO,
    currency: CurrencyCode.TON,
    tags: ['script', 'manual_publish'],
    pinDurationHours: null,
    visibilityDurationHours: DEFAULT_VISIBLE_HOURS,
    allowEdits: false,
    allowLinkTracking: false,
    allowPinnedPlacement: false,
    requiresApproval: true,
    contentRulesText:
      'Generated by publish-channel-message.ts (final publish step).',
    version: 1,
    snapshotAt: new Date().toISOString(),
  };
}

async function run() {
  const { userId, channelId, text } = parseArgs(process.argv.slice(2));
  const token = requiredEnv('BOT_TOKEN');

  await AppDataSource.initialize();

  try {
    const summary = await AppDataSource.transaction(async (manager: EntityManager) => {
      const userRepository = manager.getRepository(User);
      const channelRepository = manager.getRepository(ChannelEntity);
      const dealRepository = manager.getRepository(DealEntity);
      const creativeRepository = manager.getRepository(DealCreativeEntity);
      const escrowRepository = manager.getRepository(DealEscrowEntity);
      const publicationRepository = manager.getRepository(
        DealPublicationEntity,
      );

      const publisher = await userRepository.findOne({ where: { id: userId } });
      if (!publisher) {
        throw new Error(`Publisher user not found: ${userId}`);
      }

      const channel = await channelRepository.findOne({
        where: { id: channelId },
      });
      if (!channel) {
        throw new Error(`Channel not found: ${channelId}`);
      }

      await ensurePublisherAccess(manager, userId, channel);

      const chatId = resolveTelegramChatId(channel);
      if (!chatId) {
        throw new Error(
          'Channel has no telegramChatId/username for publishing.',
        );
      }

      const advertiser = await ensureScriptAdvertiser(userRepository);
      const now = new Date();
      const mustRemainUntil = new Date(
        now.getTime() + DEFAULT_VISIBLE_HOURS * 60 * 60 * 1000,
      );

      const deal = await dealRepository.save(
        dealRepository.create({
          advertiserUserId: advertiser.id,
          publisherUserId: publisher.id,
          channelId: channel.id,
          listingId: null,
          createdByUserId: advertiser.id,
          status: DealStatus.ACTIVE,
          stage: DealStage.POST_PUBLISHING,
          scheduledAt: now,
          lastActivityAt: now,
          idleExpiresAt: null,
          listingSnapshot: buildListingSnapshot(channel.id),
        }),
      );

      await creativeRepository.save(
        creativeRepository.create({
          dealId: deal.id,
          version: 1,
          status: CreativeStatus.APPROVED,
          submittedByUserId: advertiser.id,
          submittedAt: now,
          reviewedAt: now,
          payload: {
            type: 'text',
            text,
            source: 'script_final_publish_step',
          },
        }),
      );

      await escrowRepository.save(
        escrowRepository.create({
          dealId: deal.id,
          status: EscrowStatus.PAID_HELD,
          currency: CurrencyCode.TON,
          amountNano: DEFAULT_PRICE_NANO,
          paidNano: DEFAULT_PRICE_NANO,
          paidAt: now,
          heldAt: now,
        }),
      );

      const telegramMessage = await telegramApi(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      });

      await publicationRepository.save(
        publicationRepository.create({
          dealId: deal.id,
          status: PublicationStatus.POSTED,
          publishedMessageId: String(telegramMessage.message_id),
          telegramChatId: String(telegramMessage.chat?.id ?? chatId),
          telegramMessageId: String(telegramMessage.message_id),
          publishedAt: now,
          postedAt: now,
          mustRemainUntil,
          pinVisibilityStatus: PinVisibilityStatus.NOT_REQUIRED,
          verifiedAt: null,
          lastCheckedAt: now,
          error: null,
          publishedMessageText: text,
          publishedMessageCaption: null,
          publishedMessageMediaFingerprint: 'none',
          publishedMessageKeyboardFingerprint: 'none',
          publishedMessageSnapshotJson: {
            source: 'publish-channel-message-script',
            text,
            messageId: telegramMessage.message_id,
          },
        }),
      );

      await dealRepository.update(deal.id, {
        stage: DealStage.POSTED_VERIFYING,
        status: DealStatus.ACTIVE,
        lastActivityAt: now,
      });

      return {
        dealId: deal.id,
        publicationId: String(telegramMessage.message_id),
        channelId: channel.id,
      };
    });

    console.log('Deal final publish step completed.');
    console.log(`dealId: ${summary.dealId}`);
    console.log(`publicationId(messageId): ${summary.publicationId}`);
    console.log(`channelId: ${summary.channelId}`);
    console.log(`publisherUserId: ${userId}`);
  } finally {
    await AppDataSource.destroy();
  }
}

run().catch((error) => {
  console.error(
    'Failed to publish deal:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});

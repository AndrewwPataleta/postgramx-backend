'use strict';

import type { EntityManager, Repository, ObjectLiteral } from 'typeorm';

const { randomUUID } = require('crypto');
const { AppDataSource } = require('../database/datasource');
const { User } = require('../modules/auth/entities/user.entity');
const {
  ChannelEntity,
} = require('../modules/channels/entities/channel.entity');
const {
  ChannelStatus,
} = require('../modules/channels/types/channel-status.enum');
const { DealEntity } = require('../modules/deals/entities/deal.entity');
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
  PublicationStatus,
} = require('../common/constants/deals/publication-status.constants');
const {
  TransactionEntity,
} = require('../modules/payments/entities/transaction.entity');
const {
  TransactionType,
} = require('../common/constants/payments/transaction-type.constants');
const {
  TransactionDirection,
} = require('../common/constants/payments/transaction-direction.constants');
const {
  TransactionStatus,
} = require('../common/constants/payments/transaction-status.constants');
const {
  CurrencyCode,
} = require('../common/constants/currency/currency.constants');
const {
  ListingFormat,
} = require('../common/constants/channels/listing-format.constants');

const DEFAULT_AMOUNT_NANO = '1000000000';
const ADVERTISER_EMAIL = 'system-advertiser@postgramx.local';

function printUsage() {
  console.log(
    [
      'Usage:',
      '  NODE_ENV=local ts-node -r tsconfig-paths/register src/scripts/create-withdrawable-balance.ts <userId> [amountNano]',
      '',
      'Example:',
      '  NODE_ENV=stage ts-node -r tsconfig-paths/register src/scripts/create-withdrawable-balance.ts 82a3ffa6-0eae-4e19-8a2b-8c015cf1bf9c 2500000000',
    ].join('\n'),
  );
}

function parseAmountNano(value: string) {
  if (!value) {
    return DEFAULT_AMOUNT_NANO;
  }

  if (!/^[0-9]+$/.test(value)) {
    throw new Error(
      `Amount must be a positive integer string in nano units, received: ${value}`,
    );
  }

  return value;
}

async function ensureAdvertiserUser(userRepository: Repository<ObjectLiteral>) {
  let advertiser = await userRepository.findOne({
    where: { email: ADVERTISER_EMAIL },
  });

  if (!advertiser) {
    advertiser = userRepository.create({
      email: ADVERTISER_EMAIL,
      username: 'system_advertiser',
      firstName: 'System',
      lastName: 'Advertiser',
      isActive: true,
      isPremium: false,
      lang: 'en',
    });
    advertiser = await userRepository.save(advertiser);
  }

  return advertiser;
}

async function ensurePublisherChannel(channelRepository: Repository<ObjectLiteral>, userId: string) {
  const baseUsername = `withdrawal_${userId.replace(/-/g, '').slice(0, 12)}`;
  let channel = await channelRepository.findOne({
    where: { username: baseUsername },
  });

  if (!channel) {
    channel = channelRepository.create({
      username: baseUsername,
      title: `Withdrawal Channel ${baseUsername}`,
      createdByUserId: userId,
      ownerUserId: userId,
      status: ChannelStatus.VERIFIED,
      subscribersCount: 1,
      avgViews: 1,
      isDisabled: false,
      verifiedAt: new Date(),
      lastCheckedAt: new Date(),
      avatarUrl: null,
      languageStats: { en: 1 },
    });
    channel = await channelRepository.save(channel);
  }

  return channel;
}

async function createWithdrawableBalance(userId: string, amountNano: string) {
  await AppDataSource.initialize();

  try {
    await AppDataSource.transaction(async (manager: EntityManager) => {
      const userRepository = manager.getRepository(User);
      const channelRepository = manager.getRepository(ChannelEntity);
      const dealRepository = manager.getRepository(DealEntity);
      const escrowRepository = manager.getRepository(DealEscrowEntity);
      const publicationRepository = manager.getRepository(
        DealPublicationEntity,
      );
      const transactionRepository = manager.getRepository(TransactionEntity);

      const publisher = await userRepository.findOne({ where: { id: userId } });
      if (!publisher) {
        throw new Error(`User not found: ${userId}`);
      }

      const advertiser = await ensureAdvertiserUser(userRepository);
      const channel = await ensurePublisherChannel(channelRepository, userId);

      const listingSnapshot = {
        listingId: randomUUID(),
        channelId: channel.id,
        format: ListingFormat.POST,
        priceNano: amountNano,
        currency: CurrencyCode.TON,
        tags: ['script', 'withdrawal'],
        pinDurationHours: null,
        visibilityDurationHours: 24,
        allowEdits: false,
        allowLinkTracking: false,
        allowPinnedPlacement: false,
        requiresApproval: false,
        contentRulesText: 'Generated by create-withdrawable-balance script.',
        version: 1,
        snapshotAt: new Date().toISOString(),
      };

      const deal = dealRepository.create({
        advertiserUserId: advertiser.id,
        publisherUserId: publisher.id,
        channelId: channel.id,
        listingId: null,
        createdByUserId: advertiser.id,
        status: DealStatus.COMPLETED,
        stage: DealStage.FINALIZED,
        scheduledAt: null,
        lastActivityAt: new Date(),
        idleExpiresAt: null,
        cancelReason: null,
        listingSnapshot,
      });
      const savedDeal = await dealRepository.save(deal);

      const escrow = escrowRepository.create({
        dealId: savedDeal.id,
        status: EscrowStatus.PAYOUT_PENDING,
        currency: CurrencyCode.TON,
        amountNano,
        paidNano: amountNano,
        depositWalletId: null,
        depositAddress: null,
        paymentDeadlineAt: null,
        paidAt: new Date(),
        heldAt: new Date(),
        payoutId: null,
        refundedAt: null,
        refundId: null,
        paidOutAt: null,
        lastSeenLt: null,
        lastSeenTxHash: null,
      });
      const savedEscrow = await escrowRepository.save(escrow);

      const publication = publicationRepository.create({
        dealId: savedDeal.id,
        status: PublicationStatus.VERIFIED,
        publishedMessageId: null,
        publishedAt: new Date(),
        mustRemainUntil: null,
        verifiedAt: new Date(),
        lastCheckedAt: new Date(),
        error: null,
      });
      await publicationRepository.save(publication);

      const idempotencyKey = `escrow_release_script:${savedEscrow.id}`;
      await transactionRepository.save(
        transactionRepository.create({
          userId: publisher.id,
          type: TransactionType.PAYOUT,
          direction: TransactionDirection.IN,
          status: TransactionStatus.COMPLETED,
          amountNano,
          amountToUserNano: amountNano,
          totalDebitNano: '0',
          currency: CurrencyCode.TON,
          dealId: savedDeal.id,
          escrowId: savedEscrow.id,
          channelId: channel.id,
          description: 'Escrow release (scripted)',
          idempotencyKey,
          confirmedAt: new Date(),
          completedAt: new Date(),
        }),
      );

      console.log('Withdrawable balance created.');
      console.log(`User: ${publisher.id}`);
      console.log(`Deal: ${savedDeal.id}`);
      console.log(`Escrow: ${savedEscrow.id}`);
      console.log(`Amount (nano): ${amountNano}`);
    });
  } finally {
    await AppDataSource.destroy();
  }
}

async function run() {
  const [, , userId, amountArg] = process.argv;

  if (!userId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const amountNano = parseAmountNano(amountArg);

  await createWithdrawableBalance(userId, amountNano);
}

run().catch((error) => {
  console.error('Failed to create withdrawable balance:', error);
  process.exitCode = 1;
});

module.exports = { createWithdrawableBalance };

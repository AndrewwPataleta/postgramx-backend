'use strict';

import type { EntityManager, ObjectLiteral } from 'typeorm';

const dotenv = require('dotenv');
const { AppDataSource } = require('../database/datasource');
const {
  ChannelEntity,
} = require('../modules/channels/entities/channel.entity');
const {
  ChannelMembershipEntity,
} = require('../modules/channels/entities/channel-membership.entity');
const { ChannelRole } = require('../modules/channels/types/channel-role.enum');
const { DealEntity } = require('../modules/deals/entities/deal.entity');
const {
  DealPublicationEntity,
} = require('../modules/deals/entities/deal-publication.entity');
const {
  DEAL_PUBLICATION_ERRORS,
} = require('../common/constants/deals/deal-publication-errors.constants');
const { DealStage } = require('../common/constants/deals/deal-stage.constants');

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
      '  NODE_ENV=local npm run telegram:edit-channel-publication -- b5d3cfbf-9ccc-447b-bdf9-34492ce4e73d d8aee2de-c53f-46a1-a2a8-5c44c2757561 "zxc"',
      '',
      'publicationId accepts either:',
      '  - Telegram message_id',
      '  - internal deal_publications.id (uuid)',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]) {
  const [userId, publicationId, ...textParts] = argv;
  const text = textParts.join(' ').trim();

  if (!userId || !publicationId || !text) {
    printUsage();
    throw new Error('Missing required arguments: userId, publicationId, text.');
  }

  return { userId, publicationId, text };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
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

async function ensureEditorAccess(manager: EntityManager, userId: string, channel: ObjectLiteral) {
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
    throw new Error(
      'User has no moderator/owner access to edit this publication.',
    );
  }
}

async function run() {
  const { userId, publicationId, text } = parseArgs(process.argv.slice(2));
  const token = requiredEnv('BOT_TOKEN');

  await AppDataSource.initialize();

  try {
    const result = await AppDataSource.transaction(async (manager: EntityManager) => {
      const publicationRepository = manager.getRepository(
        DealPublicationEntity,
      );
      const channelRepository = manager.getRepository(ChannelEntity);
      const dealRepository = manager.getRepository(DealEntity);

      const publication = isUuid(publicationId)
        ? await publicationRepository.findOne({ where: { id: publicationId } })
        : await publicationRepository.findOne({
            where: { publishedMessageId: publicationId },
          });

      if (!publication) {
        throw new Error(
          `Publication not found by id/messageId: ${publicationId}`,
        );
      }

      const deal = await dealRepository.findOne({
        where: { id: publication.dealId },
      });
      if (!deal) {
        throw new Error(
          `Deal not found for publication: ${publication.dealId}`,
        );
      }

      const channel = await channelRepository.findOne({
        where: { id: deal.channelId },
      });
      if (!channel) {
        throw new Error(`Channel not found for deal: ${deal.id}`);
      }

      await ensureEditorAccess(manager, userId, channel);

      const chatId =
        publication.telegramChatId || resolveTelegramChatId(channel);
      if (!chatId) {
        throw new Error(
          'Unable to resolve channel chat id for edit operation.',
        );
      }

      if (!publication.publishedMessageId) {
        throw new Error('Publication has no Telegram message id.');
      }

      await telegramApi(token, 'editMessageText', {
        chat_id: chatId,
        message_id: Number(publication.publishedMessageId),
        text,
        parse_mode: 'HTML',
      });

      const now = new Date();
      await publicationRepository.update(publication.id, {
        publishedMessageText: text,
        lastCheckedAt: now,
        error: DEAL_PUBLICATION_ERRORS.POST_EDITED,
        publishedMessageSnapshotJson: {
          source: 'edit-channel-publication-script',
          editedByUserId: userId,
          editedAt: now.toISOString(),
          text,
        },
      });

      if (deal.stage === DealStage.POSTED_VERIFYING) {
        await dealRepository.update(deal.id, {
          lastActivityAt: now,
        });
      }

      return {
        dealId: deal.id,
        publicationDbId: publication.id,
        publicationMessageId: publication.publishedMessageId,
        channelId: channel.id,
      };
    });

    console.log('Deal publication text updated.');
    console.log(`dealId: ${result.dealId}`);
    console.log(`publicationDbId: ${result.publicationDbId}`);
    console.log(`publicationId(messageId): ${result.publicationMessageId}`);
    console.log(`channelId: ${result.channelId}`);
    console.log(`editorUserId: ${userId}`);
    console.log(
      `flowNote: publication marked with error=${DEAL_PUBLICATION_ERRORS.POST_EDITED}`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

run().catch((error) => {
  console.error(
    'Failed to edit publication:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});

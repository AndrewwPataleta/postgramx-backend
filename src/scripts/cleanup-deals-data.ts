'use strict';

import type { EntityMetadata } from 'typeorm';

const { AppDataSource } = require('../database/datasource');
const {
  ChannelEntity,
} = require('../modules/channels/entities/channel.entity');
const {
  ListingEntity,
} = require('../modules/listings/entities/listing.entity');
const { User } = require('../modules/auth/entities/user.entity');

const KEEP_ENTITIES = new Set([ChannelEntity, ListingEntity, User]);

function quoteTablePath(tablePath: string) {
  return tablePath
    .split('.')
    .map((part: string) => `"${part}"`)
    .join('.');
}

async function cleanupDealsData() {
  await AppDataSource.initialize();

  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    const tablePaths = AppDataSource.entityMetadatas
      .filter((metadata: EntityMetadata) => !KEEP_ENTITIES.has(metadata.target))
      .map((metadata: EntityMetadata) => metadata.tablePath);

    if (tablePaths.length === 0) {
      console.log('No tables to truncate.');
      return;
    }

    const tablesList = tablePaths.map(quoteTablePath).join(', ');
    await queryRunner.query(`TRUNCATE TABLE ${tablesList} CASCADE;`);

    console.log('Cleared all non-channel/listing/user data.');
  } finally {
    await queryRunner.release();
    await AppDataSource.destroy();
  }
}

cleanupDealsData().catch((error) => {
  console.error('Failed to cleanup deal-related data:', error);
  process.exitCode = 1;
});

module.exports = { cleanupDealsData };

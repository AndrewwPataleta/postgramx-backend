'use strict';

const { AppDataSource } = require('../database/datasource');
const {
  ChannelEntity,
} = require('../modules/channels/entities/channel.entity');
const {
  ListingEntity,
} = require('../modules/listings/entities/listing.entity');
const { User } = require('../modules/auth/entities/user.entity');

const MOCK_PREFIX = 'mock_listing_';
const MOCK_EMAIL = 'mock-listing-user@postgramx.local';

async function cleanupLocalMock() {
  await AppDataSource.initialize();

  try {
    const channelRepository = AppDataSource.getRepository(ChannelEntity);
    const listingRepository = AppDataSource.getRepository(ListingEntity);
    const userRepository = AppDataSource.getRepository(User);

    const mockChannels = await channelRepository
      .createQueryBuilder('channel')
      .where('channel.username LIKE :prefix', { prefix: `${MOCK_PREFIX}%` })
      .getMany();

    if (mockChannels.length > 0) {
      const mockChannelIds = mockChannels.map(
        (channel: { id: string }) => channel.id,
      );

      await listingRepository
        .createQueryBuilder()
        .delete()
        .where('channelId IN (:...ids)', { ids: mockChannelIds })
        .execute();

      await channelRepository
        .createQueryBuilder()
        .delete()
        .where('id IN (:...ids)', { ids: mockChannelIds })
        .execute();
    }

    await userRepository
      .createQueryBuilder()
      .delete()
      .where('email = :email', { email: MOCK_EMAIL })
      .execute();

    console.log('Local mock listings cleaned.');
  } finally {
    await AppDataSource.destroy();
  }
}

cleanupLocalMock().catch((error) => {
  console.error('Failed to cleanup local mock listings:', error);
  process.exitCode = 1;
});

module.exports = { cleanupLocalMock };

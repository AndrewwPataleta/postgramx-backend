'use strict';

const { AppDataSource } = require('../database/datasource');
const {
  ChannelEntity,
} = require('../modules/channels/entities/channel.entity');
const {
  ChannelStatus,
} = require('../modules/channels/types/channel-status.enum');
const {
  ListingEntity,
} = require('../modules/listings/entities/listing.entity');
const {
  ListingFormat,
} = require('../common/constants/channels/listing-format.constants');
const {
  CurrencyCode,
} = require('../common/constants/currency/currency.constants');
const { User } = require('../modules/auth/entities/user.entity');

const MOCK_PREFIX = 'mock_listing_';
const MOCK_EMAIL = 'mock-listing-user@postgramx.local';

const BASE_MOCK_CHANNELS = [
  {
    username: `${MOCK_PREFIX}tech`,
    title: 'Mock Tech Deals',
    subscribersCount: 12400,
    avgViews: 5600,
  },
  {
    username: `${MOCK_PREFIX}design`,
    title: 'Mock Design Picks',
    subscribersCount: 8300,
    avgViews: 3200,
  },
  {
    username: `${MOCK_PREFIX}crypto`,
    title: 'Mock Crypto Insights',
    subscribersCount: 20500,
    avgViews: 9800,
  },
  {
    username: `${MOCK_PREFIX}gaming`,
    title: 'Mock Gaming News',
    subscribersCount: 15200,
    avgViews: 6200,
  },
  {
    username: `${MOCK_PREFIX}travel`,
    title: 'Mock Travel Deals',
    subscribersCount: 9800,
    avgViews: 4100,
  },
  {
    username: `${MOCK_PREFIX}food`,
    title: 'Mock Food Digest',
    subscribersCount: 11300,
    avgViews: 4700,
  },
  {
    username: `${MOCK_PREFIX}music`,
    title: 'Mock Music Drops',
    subscribersCount: 16700,
    avgViews: 7300,
  },
  {
    username: `${MOCK_PREFIX}sports`,
    title: 'Mock Sports Highlights',
    subscribersCount: 22100,
    avgViews: 10200,
  },
  {
    username: `${MOCK_PREFIX}news`,
    title: 'Mock Daily News',
    subscribersCount: 30400,
    avgViews: 15000,
  },
  {
    username: `${MOCK_PREFIX}science`,
    title: 'Mock Science Weekly',
    subscribersCount: 8900,
    avgViews: 3800,
  },
  {
    username: `${MOCK_PREFIX}finance`,
    title: 'Mock Finance Updates',
    subscribersCount: 14200,
    avgViews: 6100,
  },
  {
    username: `${MOCK_PREFIX}fashion`,
    title: 'Mock Fashion Picks',
    subscribersCount: 7600,
    avgViews: 3100,
  },
  {
    username: `${MOCK_PREFIX}movies`,
    title: 'Mock Movie Premieres',
    subscribersCount: 19800,
    avgViews: 8700,
  },
  {
    username: `${MOCK_PREFIX}books`,
    title: 'Mock Book Club',
    subscribersCount: 6400,
    avgViews: 2500,
  },
  {
    username: `${MOCK_PREFIX}fitness`,
    title: 'Mock Fitness Plans',
    subscribersCount: 9300,
    avgViews: 3900,
  },
  {
    username: `${MOCK_PREFIX}education`,
    title: 'Mock Learning Hub',
    subscribersCount: 11000,
    avgViews: 4500,
  },
  {
    username: `${MOCK_PREFIX}startup`,
    title: 'Mock Startup Radar',
    subscribersCount: 8700,
    avgViews: 3400,
  },
  {
    username: `${MOCK_PREFIX}autos`,
    title: 'Mock Auto World',
    subscribersCount: 12600,
    avgViews: 5200,
  },
  {
    username: `${MOCK_PREFIX}nature`,
    title: 'Mock Nature Watch',
    subscribersCount: 7100,
    avgViews: 2800,
  },
  {
    username: `${MOCK_PREFIX}art`,
    title: 'Mock Art Studio',
    subscribersCount: 5900,
    avgViews: 2300,
  },
];

const MOCK_CHANNEL_TOTAL = 500;

const GENERATED_MOCK_CHANNELS = Array.from(
  { length: Math.max(0, MOCK_CHANNEL_TOTAL - BASE_MOCK_CHANNELS.length) },
  (_, index) => {
    const channelIndex = index + 1;
    const subscribersCount = 3000 + channelIndex * 37;
    const avgViews = Math.max(900, Math.round(subscribersCount * 0.45));

    return {
      username: `${MOCK_PREFIX}channel_${channelIndex}`,
      title: `Mock Channel ${channelIndex}`,
      subscribersCount,
      avgViews,
    };
  },
);

const MOCK_CHANNELS = [...BASE_MOCK_CHANNELS, ...GENERATED_MOCK_CHANNELS];

async function seedLocalMock() {
  await AppDataSource.initialize();

  try {
    const userRepository = AppDataSource.getRepository(User);
    const channelRepository = AppDataSource.getRepository(ChannelEntity);
    const listingRepository = AppDataSource.getRepository(ListingEntity);

    let mockUser = await userRepository.findOne({
      where: { email: MOCK_EMAIL },
    });
    if (!mockUser) {
      mockUser = userRepository.create({
        email: MOCK_EMAIL,
        username: 'mock_listing_user',
        firstName: 'Mock',
        lastName: 'Listing',
        isActive: true,
        isPremium: false,
        lang: 'en',
      });
      mockUser = await userRepository.save(mockUser);
    }

    for (const [index, channelData] of MOCK_CHANNELS.entries()) {
      let channel = await channelRepository.findOne({
        where: { username: channelData.username },
      });

      if (!channel) {
        channel = channelRepository.create({
          username: channelData.username,
          title: channelData.title,
          createdByUserId: mockUser.id,
          ownerUserId: mockUser.id,
          status: ChannelStatus.VERIFIED,
          subscribersCount: channelData.subscribersCount,
          avgViews: channelData.avgViews,
          isDisabled: false,
          verifiedAt: new Date(),
          lastCheckedAt: new Date(),
          avatarUrl: null,
          languageStats: { en: 0.8 },
        });
        channel = await channelRepository.save(channel);
      }

      const existingListings = await listingRepository.find({
        where: { channelId: channel.id, isActive: true },
        order: { createdAt: 'ASC' },
        take: 2,
      });

      if (existingListings.length < 2) {
        const listingsToCreate = [];
        for (
          let listingIndex = existingListings.length;
          listingIndex < 2;
          listingIndex += 1
        ) {
          listingsToCreate.push(
            listingRepository.create({
              channelId: channel.id,
              createdByUserId: mockUser.id,
              format: ListingFormat.POST,
              priceNano: String(
                1_500_000_000 +
                  index * 200_000_000 +
                  listingIndex * 250_000_000,
              ),
              currency: CurrencyCode.TON,
              pinDurationHours: listingIndex === 0 ? 12 : 24,
              visibilityDurationHours: listingIndex === 0 ? 48 : 72,
              allowEdits: true,
              allowLinkTracking: true,
              allowPinnedPlacement: listingIndex === 1,
              requiresApproval: false,
              isActive: true,
              contentRulesText: 'Mock listing rules for local development.',
              tags: [
                'mock',
                'local',
                channelData.username.replace(MOCK_PREFIX, ''),
                listingIndex === 0 ? 'standard' : 'premium',
              ],
              version: 1,
            }),
          );
        }
        await listingRepository.save(listingsToCreate);
      }
    }

    console.log('Local mock listings seeded.');
  } finally {
    await AppDataSource.destroy();
  }
}

seedLocalMock().catch((error) => {
  console.error('Failed to seed local mock listings:', error);
  process.exitCode = 1;
});

module.exports = { seedLocalMock };

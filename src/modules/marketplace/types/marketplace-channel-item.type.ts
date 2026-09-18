import { CurrencyCode } from '../../../common/constants/currency/currency.constants';

export type MarketplaceChannelItem = {
  id: string;
  name: string;
  username: string | null;
  about: string | null;
  avatarUrl: string | null;
  verified: boolean;
  currency: CurrencyCode;
  tags: string[];
  preview: {
    listingCount: number;
    subsCount: number | null;
    listingFrom: string | null;
  };
};

export type MarketplaceChannelsResponse = {
  items: MarketplaceChannelItem[];
  page: number;
  limit: number;
  total: number;
};

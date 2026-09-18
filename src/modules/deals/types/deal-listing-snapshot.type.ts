import { ListingFormat } from '../../../common/constants/channels/listing-format.constants';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';

export type DealListingSnapshot = {
  listingId: string;
  channelId: string;
  format: ListingFormat;
  priceNano: string;
  currency: CurrencyCode;
  tags: string[];
  pinDurationHours: number | null;
  visibilityDurationHours: number;
  allowEdits: boolean;
  allowLinkTracking: boolean;
  allowPinnedPlacement: boolean;
  requiresApproval: boolean;
  contentRulesText: string;
  version: number;
  snapshotAt: string;
};

import { Repository } from 'typeorm';
import { ListingEntity } from '../entities/listing.entity';

export type ChannelPreviewMode = 'owner' | 'marketplace';

export type ChannelPreviewSummary = {
  listingCount: number;
  listingFrom: string | null;
};

const NANO_BASE = 1_000_000_000n;

function formatNanoToTon(nano: string): string {
  const nanoValue = BigInt(nano);
  const whole = nanoValue / NANO_BASE;
  const fraction = nanoValue % NANO_BASE;

  if (fraction === 0n) {
    return whole.toString();
  }

  let fractionStr = fraction.toString().padStart(9, '0');
  fractionStr = fractionStr.replace(/0+$/, '');

  return `${whole.toString()}.${fractionStr}`;
}

export async function buildChannelPreview(
  listingRepository: Repository<ListingEntity>,
  channelIds: string[],
  mode: ChannelPreviewMode,
): Promise<Map<string, ChannelPreviewSummary>> {
  const previews = new Map<string, ChannelPreviewSummary>();

  for (const channelId of channelIds) {
    previews.set(channelId, { listingCount: 0, listingFrom: null });
  }

  if (channelIds.length === 0) {
    return previews;
  }

  const baseQuery = listingRepository
    .createQueryBuilder('listing')
    .where('listing.channelId IN (:...channelIds)', { channelIds });

  if (mode === 'marketplace') {
    baseQuery.andWhere('listing.isActive = :isActive', { isActive: true });
  }

  const counts = await baseQuery
    .clone()
    .select('listing.channelId', 'channelId')
    .addSelect('COUNT(*)', 'listingCount')
    .groupBy('listing.channelId')
    .getRawMany<{ channelId: string; listingCount: string }>();

  for (const row of counts) {
    const entry = previews.get(row.channelId);
    if (entry) {
      entry.listingCount = Number(row.listingCount ?? 0);
    }
  }

  const minPrices = await baseQuery
    .clone()
    .select('listing.channelId', 'channelId')
    .addSelect('MIN(listing.priceNano)', 'minPriceNano')
    .groupBy('listing.channelId')
    .getRawMany<{ channelId: string; minPriceNano: string | null }>();

  for (const row of minPrices) {
    const entry = previews.get(row.channelId);
    if (!entry) {
      continue;
    }
    entry.listingFrom = row.minPriceNano
      ? formatNanoToTon(row.minPriceNano)
      : null;
  }

  return previews;
}

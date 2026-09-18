import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChannelEntity } from '../channels/entities/channel.entity';
import { ChannelMembershipEntity } from '../channels/entities/channel-membership.entity';
import { ChannelStatus } from '../channels/types/channel-status.enum';
import { ChannelRole } from '../channels/types/channel-role.enum';
import { ListingEntity } from './entities/listing.entity';
import {
  ListingServiceError,
  ListingServiceErrorCode,
} from './errors/listing.errors';
import {
  ListingListItem,
  mapListingToListItem,
} from './types/listing-list-item.type';
import { definedOnly } from '../../common/utils/defined-only';
import { ListingFormat } from '../../common/constants/channels/listing-format.constants';
import { SYSTEM_LISTING_TAGS } from '../../common/constants/channels/listing-tags.constants';
import { CurrencyCode } from '../../common/constants/currency/currency.constants';

const REQUIRED_TAG = SYSTEM_LISTING_TAGS.PRE_APPROVED;

@Injectable()
export class ListingsService {
  constructor(
    @InjectRepository(ListingEntity)
    private readonly listingRepository: Repository<ListingEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelMembershipEntity)
    private readonly membershipRepository: Repository<ChannelMembershipEntity>,
  ) {}

  async createListing(
    data: {
      channelId: string;
      format: ListingFormat;
      priceTon: number;
      pinDurationHours?: number | null;
      visibilityDurationHours: number;
      allowEdits: boolean;
      allowLinkTracking: boolean;
      allowPinnedPlacement: boolean;
      requiresApproval: boolean;
      contentRulesText?: string;
      tags: string[];
      isActive: boolean;
    },
    userId: string,
  ) {
    const channel = await this.channelRepository.findOne({
      where: { id: data.channelId },
    });

    if (!channel) {
      throw new ListingServiceError(ListingServiceErrorCode.CHANNEL_NOT_FOUND);
    }

    if (channel.ownerUserId !== userId) {
      throw new ListingServiceError(
        ListingServiceErrorCode.UNAUTHORIZED_CHANNEL_ACCESS,
      );
    }

    if (channel.status !== ChannelStatus.VERIFIED || channel.isDisabled) {
      throw new ListingServiceError(
        ListingServiceErrorCode.CHANNEL_NOT_VERIFIED,
      );
    }

    if (data.format !== ListingFormat.POST) {
      throw new ListingServiceError(ListingServiceErrorCode.INVALID_FORMAT);
    }

    if (data.requiresApproval !== true) {
      throw new ListingServiceError(
        ListingServiceErrorCode.INVALID_REQUIRES_APPROVAL,
      );
    }

    const isPinnedPlacement =
      data.pinDurationHours !== null && data.pinDurationHours !== undefined;
    if (data.allowPinnedPlacement !== isPinnedPlacement) {
      throw new ListingServiceError(ListingServiceErrorCode.INVALID_PIN_RULE);
    }

    const normalizedTags = this.normalizeTags(data.tags);
    if (!this.hasRequiredTag(normalizedTags)) {
      throw new ListingServiceError(
        ListingServiceErrorCode.TAGS_MISSING_REQUIRED,
      );
    }

    const priceNano = this.parseTonToNano(data.priceTon);

    const listing = this.listingRepository.create({
      channelId: data.channelId,
      createdByUserId: userId,
      format: ListingFormat.POST,
      priceNano,
      currency: CurrencyCode.TON,
      pinDurationHours: data.pinDurationHours ?? null,
      visibilityDurationHours: data.visibilityDurationHours,
      allowEdits: data.allowEdits,
      allowLinkTracking: data.allowLinkTracking,
      allowPinnedPlacement: data.allowPinnedPlacement,
      requiresApproval: data.requiresApproval,
      contentRulesText: data.contentRulesText ?? '',
      tags: normalizedTags,
      isActive: data.isActive,
    });

    const saved = await this.listingRepository.save(listing);

    return {
      id: saved.id,
      channelId: saved.channelId,
      format: saved.format,
      priceNano: saved.priceNano,
      currency: saved.currency,
      pinDurationHours: saved.pinDurationHours,
      visibilityDurationHours: saved.visibilityDurationHours,
      allowEdits: saved.allowEdits,
      requiresApproval: saved.requiresApproval,
      contentRulesText: saved.contentRulesText,
      tags: saved.tags,
      isActive: saved.isActive,
      allowLinkTracking: saved.allowLinkTracking,
      allowPinnedPlacement: saved.allowPinnedPlacement,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }

  async listByChannel(
    channelId: string,
    userId: string,
    options?: {
      page?: number;
      limit?: number;
      onlyActive?: boolean;
      sort?: 'recent' | 'price_asc' | 'price_desc';
    },
  ): Promise<{
    items: ListingListItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      throw new ListingServiceError(ListingServiceErrorCode.CHANNEL_NOT_FOUND);
    }

    const page = options?.page ?? 1;
    const limit = Math.min(options?.limit ?? 20, 50);
    const offset = (page - 1) * limit;
    const onlyActive = options?.onlyActive ?? true;
    const sort = options?.sort ?? 'recent';

    const query = this.listingRepository
      .createQueryBuilder('listing')
      .where('listing.channelId = :channelId', { channelId });

    if (onlyActive) {
      query.andWhere('listing.isActive = :isActive', { isActive: true });
    }

    switch (sort) {
      case 'price_asc':
        query.orderBy('listing.priceNano', 'ASC');
        query.addOrderBy('listing.createdAt', 'DESC');
        break;
      case 'price_desc':
        query.orderBy('listing.priceNano', 'DESC');
        query.addOrderBy('listing.createdAt', 'DESC');
        break;
      case 'recent':
      default:
        query.orderBy('listing.createdAt', 'DESC');
        break;
    }

    query.skip(offset).take(limit);

    const [listings, total] = await query.getManyAndCount();

    return {
      items: listings.map(mapListingToListItem),
      page,
      limit,
      total,
    };
  }

  async updateListing(
    data: {
      id: string;
      priceTon?: number;
      pinDurationHours?: number | null;
      visibilityDurationHours?: number;
      allowEdits?: boolean;
      allowLinkTracking?: boolean;
      tags?: string[];
      contentRulesText?: string;
      isActive?: boolean;
    },
    userId: string,
  ) {
    const listing = await this.listingRepository
      .createQueryBuilder('listing')
      .leftJoinAndSelect('listing.channel', 'channel')
      .where('listing.id = :id', { id: data.id })
      .getOne();

    if (!listing) {
      throw new ListingServiceError(ListingServiceErrorCode.LISTING_NOT_FOUND);
    }

    const isOwner = listing.channel?.ownerUserId === userId;
    const membership = await this.membershipRepository.findOne({
      where: {
        channelId: listing.channelId,
        userId,
        isActive: true,
        isManuallyDisabled: false,
        role: In([ChannelRole.OWNER, ChannelRole.MODERATOR]),
      },
    });

    if (!isOwner && !membership) {
      throw new ListingServiceError(ListingServiceErrorCode.LISTING_FORBIDDEN);
    }

    let normalizedTags: string[] | undefined;
    if (data.tags !== undefined) {
      normalizedTags = this.normalizeTags(data.tags);
      if (!this.hasRequiredTag(normalizedTags)) {
        throw new ListingServiceError(
          ListingServiceErrorCode.TAGS_MISSING_REQUIRED,
        );
      }
    }

    const updatePayload = definedOnly({
      priceNano:
        data.priceTon !== undefined
          ? this.parseTonToNano(data.priceTon)
          : undefined,
      pinDurationHours: data.pinDurationHours,
      allowPinnedPlacement:
        data.pinDurationHours !== undefined
          ? data.pinDurationHours !== null
          : undefined,
      visibilityDurationHours: data.visibilityDurationHours,
      allowEdits: data.allowEdits,
      allowLinkTracking: data.allowLinkTracking,
      tags: normalizedTags,
      contentRulesText: data.contentRulesText,
      isActive: data.isActive,
      version: listing.version,
    });

    if (Object.keys(updatePayload).length === 0) {
      throw new ListingServiceError(
        ListingServiceErrorCode.LISTING_UPDATE_INVALID,
      );
    }

    updatePayload.version = (listing.version ?? 1) + 1;

    const saved = await this.listingRepository.save({
      ...listing,
      ...updatePayload,
    });

    return mapListingToListItem(saved);
  }

  private normalizeTags(tags: string[]): string[] {
    const unique = new Map<string, string>();

    for (const tag of tags) {
      const trimmed = tag.trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toLowerCase();
      if (!unique.has(key)) {
        unique.set(key, trimmed);
      }
    }

    return Array.from(unique.values());
  }

  private hasRequiredTag(tags: string[]): boolean {
    const required = REQUIRED_TAG.toLowerCase();
    return tags.some((tag) => tag.toLowerCase() === required);
  }

  private parseTonToNano(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      throw new ListingServiceError(ListingServiceErrorCode.INVALID_PRICE);
    }

    let normalized = value.toString();
    if (normalized.includes('e') || normalized.includes('E')) {
      normalized = value.toFixed(9);
    }

    normalized = normalized.replace(/(\.\d*?)0+$/, '$1');
    normalized = normalized.replace(/\.$/, '');

    const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(normalized);
    if (!match) {
      throw new ListingServiceError(ListingServiceErrorCode.INVALID_PRICE);
    }

    const wholePart = match[1];
    const fractionPart = match[2] ?? '';
    if (fractionPart.length > 9) {
      throw new ListingServiceError(ListingServiceErrorCode.INVALID_PRICE);
    }

    const fractionPadded = fractionPart.padEnd(9, '0');
    const nano =
      BigInt(wholePart) * 1000000000n + BigInt(fractionPadded || '0');

    if (nano <= 0n) {
      throw new ListingServiceError(ListingServiceErrorCode.INVALID_PRICE);
    }

    return nano.toString();
  }
}

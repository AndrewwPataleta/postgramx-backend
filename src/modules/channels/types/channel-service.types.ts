import { ChannelRole } from './channel-role.enum';
import { ChannelStatus } from './channel-status.enum';
import { ChannelErrorCode } from './channel-error-code.enum';
import { TelegramAdminStatus } from '../entities/channel-membership.entity';
import { ListingListItem } from '../../listings/types/listing-list-item.type';

export type ChannelPreview = {
  normalizedUsername: string;
  title: string;
  username: string;
  telegramChatId: number | null;
  type: 'channel';
  isPublic: true;
  nextStep: 'ADD_BOT_AS_ADMIN';
  subscribers: number | null;
  avatarUrl: string | null;
  description: string | null;
};

export type ChannelLinkResult = {
  id: string;
  status: ChannelStatus;
};

export type ChannelVerifyResult = {
  channelId: string;
  status: ChannelStatus;
  role: ChannelRole;
  verifiedAt?: string;
  error?: { code: ChannelErrorCode; message: string };
  permissions?: Record<string, unknown>;
  adminsSync?: 'ok' | 'failed';
};

export type ChannelListItem = {
  id: string;
  username: string;
  title: string;
  status: ChannelStatus;
  telegramChatId: string | null;
  avatarUrl: string | null;
  subscribers: number | null;
  avgViews: number | null;
  isDisabled: boolean;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  membership: {
    role: ChannelRole;
    telegramAdminStatus: TelegramAdminStatus | null;
    lastRecheckAt: Date | null;
  };
  preview: {
    listingCount: number;
    subsCount: number | null;
    listingFrom: string | null;
  };
  listings?: ListingListItem[];
};

export type ChannelListResponse = {
  items: ChannelListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type ChannelDetails = {
  id: string;
  username: string;
  title: string;
  status: ChannelStatus;
  telegramChatId: string | null;
  avatarUrl: string | null;
  subscribers: number | null;
  avgViews: number | null;
  isDisabled: boolean;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  languageStats: Record<string, unknown> | null;
  membership: {
    role: ChannelRole;
    telegramAdminStatus: TelegramAdminStatus | null;
    lastRecheckAt: Date | null;
  };
  listings?: ListingListItem[];
};

export type ChannelDisabledResult = {
  channelId: string;
  isDisabled: boolean;
};

export type ChannelUnlinkResult = {
  channelId: string;
  unlinked: boolean;
};

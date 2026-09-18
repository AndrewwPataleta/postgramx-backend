import { HttpStatus } from '@nestjs/common';
import { mapEnumValue } from '../../core/enum-mapper.util';
import { ChannelErrorCode } from './types/channel-error-code.enum';

const CHANNEL_STATUS_BY_CODE: Partial<Record<ChannelErrorCode, HttpStatus>> = {
  [ChannelErrorCode.INVALID_USERNAME]: HttpStatus.BAD_REQUEST,
  [ChannelErrorCode.CHANNEL_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ChannelErrorCode.BOT_FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.USER_NOT_ADMIN]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.BOT_NOT_ADMIN]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.BOT_MISSING_RIGHTS]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.USER_NOT_MEMBER]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.MEMBERSHIP_DISABLED]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.MEMBERSHIP_INACTIVE]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.NOT_ADMIN]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.NOT_ADMIN_ANYMORE]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.MISSING_RIGHTS]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.USER_NOT_CREATOR]: HttpStatus.FORBIDDEN,
  [ChannelErrorCode.CHANNEL_ALREADY_LINKED]: HttpStatus.CONFLICT,
  [ChannelErrorCode.MODERATOR_NOT_ADMIN]: HttpStatus.BAD_REQUEST,
  [ChannelErrorCode.NOT_A_CHANNEL]: HttpStatus.BAD_REQUEST,
  [ChannelErrorCode.CHANNEL_PRIVATE_OR_NO_USERNAME]: HttpStatus.BAD_REQUEST,
};

const CHANNEL_MESSAGE_KEY_BY_CODE: Partial<Record<ChannelErrorCode, string>> = {
  [ChannelErrorCode.INVALID_USERNAME]: 'channels.errors.invalid_username',
  [ChannelErrorCode.CHANNEL_NOT_FOUND]: 'channels.errors.channel_not_found',
  [ChannelErrorCode.NOT_A_CHANNEL]: 'channels.errors.not_a_channel',
  [ChannelErrorCode.CHANNEL_PRIVATE_OR_NO_USERNAME]:
    'channels.errors.channel_private_or_no_username',
  [ChannelErrorCode.BOT_FORBIDDEN]: 'channels.errors.bot_forbidden',
  [ChannelErrorCode.USER_NOT_ADMIN]: 'channels.errors.user_not_admin',
  [ChannelErrorCode.BOT_NOT_ADMIN]: 'channels.errors.bot_not_admin',
  [ChannelErrorCode.BOT_MISSING_RIGHTS]: 'channels.errors.bot_missing_rights',
  [ChannelErrorCode.USER_NOT_MEMBER]: 'channels.errors.user_not_member',
  [ChannelErrorCode.MEMBERSHIP_DISABLED]: 'channels.errors.membership_disabled',
  [ChannelErrorCode.MEMBERSHIP_INACTIVE]: 'channels.errors.membership_inactive',
  [ChannelErrorCode.NOT_ADMIN]: 'channels.errors.not_admin',
  [ChannelErrorCode.NOT_ADMIN_ANYMORE]: 'channels.errors.not_admin_anymore',
  [ChannelErrorCode.MISSING_RIGHTS]: 'channels.errors.missing_rights',
  [ChannelErrorCode.USER_NOT_CREATOR]: 'channels.errors.user_not_creator',
  [ChannelErrorCode.CHANNEL_ALREADY_LINKED]:
    'channels.errors.channel_already_linked',
  [ChannelErrorCode.MODERATOR_NOT_ADMIN]: 'channels.errors.moderator_not_admin',
};

export const mapChannelErrorToStatus = (code: ChannelErrorCode): HttpStatus => {
  return mapEnumValue(code, CHANNEL_STATUS_BY_CODE, HttpStatus.BAD_REQUEST);
};

export const mapChannelErrorToMessageKey = (code: ChannelErrorCode): string => {
  return mapEnumValue(
    code,
    CHANNEL_MESSAGE_KEY_BY_CODE,
    'channels.errors.channel_not_found',
  );
};

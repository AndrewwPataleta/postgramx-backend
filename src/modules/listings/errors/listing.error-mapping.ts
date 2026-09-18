import { HttpStatus } from '@nestjs/common';
import { mapEnumValue } from '../../../core/enum-mapper.util';
import { ListingServiceErrorCode } from './listing.errors';

const LISTING_STATUS_BY_CODE: Partial<
  Record<ListingServiceErrorCode, HttpStatus>
> = {
  [ListingServiceErrorCode.CHANNEL_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ListingServiceErrorCode.UNAUTHORIZED_CHANNEL_ACCESS]: HttpStatus.FORBIDDEN,
  [ListingServiceErrorCode.CHANNEL_NOT_VERIFIED]: HttpStatus.FORBIDDEN,
  [ListingServiceErrorCode.LISTING_FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ListingServiceErrorCode.LISTING_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ListingServiceErrorCode.INVALID_FORMAT]: HttpStatus.BAD_REQUEST,
  [ListingServiceErrorCode.INVALID_AVAILABILITY_RANGE]: HttpStatus.BAD_REQUEST,
  [ListingServiceErrorCode.INVALID_PIN_RULE]: HttpStatus.BAD_REQUEST,
  [ListingServiceErrorCode.TAGS_MISSING_REQUIRED]: HttpStatus.BAD_REQUEST,
  [ListingServiceErrorCode.INVALID_REQUIRES_APPROVAL]: HttpStatus.BAD_REQUEST,
  [ListingServiceErrorCode.INVALID_PRICE]: HttpStatus.BAD_REQUEST,
  [ListingServiceErrorCode.LISTING_UPDATE_INVALID]: HttpStatus.BAD_REQUEST,
};

const LISTING_MESSAGE_KEY_BY_CODE: Partial<
  Record<ListingServiceErrorCode, string>
> = {
  [ListingServiceErrorCode.CHANNEL_NOT_FOUND]:
    'listings.errors.channelNotFound',
  [ListingServiceErrorCode.UNAUTHORIZED_CHANNEL_ACCESS]:
    'listings.errors.unauthorized',
  [ListingServiceErrorCode.CHANNEL_NOT_VERIFIED]:
    'listings.errors.channelNotVerified',
  [ListingServiceErrorCode.INVALID_FORMAT]: 'listings.errors.invalidFormat',
  [ListingServiceErrorCode.INVALID_AVAILABILITY_RANGE]:
    'listings.errors.invalidAvailability',
  [ListingServiceErrorCode.INVALID_PIN_RULE]:
    'listings.errors.invalidPinnedRule',
  [ListingServiceErrorCode.TAGS_MISSING_REQUIRED]:
    'listings.errors.tagsMissingRequired',
  [ListingServiceErrorCode.INVALID_REQUIRES_APPROVAL]:
    'listings.errors.invalidRequiresApproval',
  [ListingServiceErrorCode.INVALID_PRICE]: 'listings.errors.invalidPrice',
  [ListingServiceErrorCode.LISTING_NOT_FOUND]: 'listings.errors.notFound',
  [ListingServiceErrorCode.LISTING_FORBIDDEN]: 'listings.errors.forbidden',
  [ListingServiceErrorCode.LISTING_UPDATE_INVALID]:
    'listings.errors.invalidUpdate',
};

export const mapListingErrorToStatus = (
  code: ListingServiceErrorCode,
): HttpStatus => {
  return mapEnumValue(code, LISTING_STATUS_BY_CODE, HttpStatus.BAD_REQUEST);
};

export const mapListingErrorToMessageKey = (
  code: ListingServiceErrorCode,
): string => {
  return mapEnumValue(
    code,
    LISTING_MESSAGE_KEY_BY_CODE,
    'listings.errors.invalidAvailability',
  );
};

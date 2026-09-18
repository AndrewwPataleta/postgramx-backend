import { HttpStatus } from '@nestjs/common';
import { DealErrorCode } from '../../common/constants/errors/error-codes.constants';
import { mapEnumValue } from '../../core/enum-mapper.util';

const DEAL_STATUS_BY_CODE: Partial<Record<DealErrorCode, HttpStatus>> = {
  [DealErrorCode.DEAL_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [DealErrorCode.LISTING_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [DealErrorCode.UNAUTHORIZED]: HttpStatus.FORBIDDEN,
  [DealErrorCode.INVALID_SCHEDULE_TIME]: HttpStatus.BAD_REQUEST,
  [DealErrorCode.LISTING_DISABLED]: HttpStatus.BAD_REQUEST,
  [DealErrorCode.SELF_DEAL_NOT_ALLOWED]: HttpStatus.BAD_REQUEST,
  [DealErrorCode.INVALID_STATUS]: HttpStatus.BAD_REQUEST,
  [DealErrorCode.ACTIVE_PENDING_LIMIT_REACHED]: HttpStatus.BAD_REQUEST,
  [DealErrorCode.DEADLINE_PASSED]: HttpStatus.BAD_REQUEST,
  [DealErrorCode.CREATIVE_NOT_SUBMITTED]: HttpStatus.BAD_REQUEST,
  [DealErrorCode.SCHEDULE_CONFIRM_TOO_LATE]: HttpStatus.BAD_REQUEST,
};

const DEAL_MESSAGE_KEY_BY_CODE: Partial<Record<DealErrorCode, string>> = {
  [DealErrorCode.LISTING_NOT_FOUND]: 'deals.errors.listingNotFound',
  [DealErrorCode.LISTING_DISABLED]: 'deals.errors.listingDisabled',
  [DealErrorCode.UNAUTHORIZED]: 'deals.errors.unauthorized',
  [DealErrorCode.INVALID_SCHEDULE_TIME]: 'deals.errors.invalidScheduleTime',
  [DealErrorCode.INVALID_STATUS]: 'errors.deals.deal_not_actionable',
  [DealErrorCode.DEAL_NOT_FOUND]: 'deals.errors.dealNotFound',
  [DealErrorCode.SELF_DEAL_NOT_ALLOWED]: 'deals.errors.selfDealNotAllowed',
  [DealErrorCode.ACTIVE_PENDING_LIMIT_REACHED]:
    'errors.deals.active_pending_limit',
  [DealErrorCode.DEADLINE_PASSED]: 'errors.deals.deadline_passed',
  [DealErrorCode.CREATIVE_NOT_SUBMITTED]: 'errors.deals.creative_not_submitted',
  [DealErrorCode.SCHEDULE_CONFIRM_TOO_LATE]:
    'deals.errors.scheduleConfirmTooLate',
};

export const mapDealErrorToStatus = (code: DealErrorCode): HttpStatus => {
  return mapEnumValue(code, DEAL_STATUS_BY_CODE, HttpStatus.BAD_REQUEST);
};

export const mapDealErrorToMessageKey = (code: DealErrorCode): string => {
  return mapEnumValue(
    code,
    DEAL_MESSAGE_KEY_BY_CODE,
    'errors.validation_failed',
  );
};

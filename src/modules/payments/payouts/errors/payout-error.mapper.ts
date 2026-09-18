import { PayoutErrorCode } from './payout-service.error';
import { mapEnumValue } from '../../../../core/enum-mapper.util';

const PAYOUT_STATUS_BY_CODE: Partial<Record<PayoutErrorCode, number>> = {
  [PayoutErrorCode.WALLET_NOT_CONNECTED]: 400,
  [PayoutErrorCode.INVALID_AMOUNT]: 400,
  [PayoutErrorCode.INSUFFICIENT_BALANCE]: 400,
  [PayoutErrorCode.INSUFFICIENT_LIQUIDITY]: 409,
  [PayoutErrorCode.BLOCKED_LIQUIDITY]: 409,
  [PayoutErrorCode.PAYOUT_ALREADY_IN_PROGRESS]: 409,
  [PayoutErrorCode.DAILY_WITHDRAW_LIMIT]: 429,
  [PayoutErrorCode.INTERNAL_ERROR]: 500,
};

const PAYOUT_MESSAGE_KEY_BY_CODE: Partial<Record<PayoutErrorCode, string>> = {
  [PayoutErrorCode.WALLET_NOT_CONNECTED]:
    'payments.errors.wallet_not_connected',
  [PayoutErrorCode.INVALID_AMOUNT]: 'payments.errors.invalid_amount',
  [PayoutErrorCode.INSUFFICIENT_BALANCE]: 'payments.errors.insufficient_funds',
  [PayoutErrorCode.INSUFFICIENT_LIQUIDITY]:
    'payments.errors.insufficient_liquidity',
  [PayoutErrorCode.BLOCKED_LIQUIDITY]: 'payments.errors.insufficient_liquidity',
  [PayoutErrorCode.PAYOUT_ALREADY_IN_PROGRESS]:
    'payments.errors.payout_already_in_progress',
  [PayoutErrorCode.DAILY_WITHDRAW_LIMIT]:
    'payments.errors.daily_withdraw_limit',
  [PayoutErrorCode.INTERNAL_ERROR]: 'payments.errors.internal_error',
};

export function mapPayoutErrorToStatus(code: PayoutErrorCode): number {
  return mapEnumValue(code, PAYOUT_STATUS_BY_CODE, 500);
}

export function mapPayoutErrorToMessageKey(code: PayoutErrorCode): string {
  return mapEnumValue(
    code,
    PAYOUT_MESSAGE_KEY_BY_CODE,
    'payments.errors.internal_error',
  );
}

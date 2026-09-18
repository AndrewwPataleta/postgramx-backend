import { BalanceErrorCode } from './balance-service.error';
import { mapEnumValue } from '../../../../core/enum-mapper.util';

const BALANCE_STATUS_BY_CODE: Partial<Record<BalanceErrorCode, number>> = {
  [BalanceErrorCode.CURRENCY_UNSUPPORTED]: 400,
};

const BALANCE_MESSAGE_KEY_BY_CODE: Partial<Record<BalanceErrorCode, string>> = {
  [BalanceErrorCode.CURRENCY_UNSUPPORTED]:
    'errors.balance.currency_unsupported',
};

export function mapBalanceErrorToStatus(code: BalanceErrorCode): number {
  return mapEnumValue(code, BALANCE_STATUS_BY_CODE, 400);
}

export function mapBalanceErrorToMessageKey(code: BalanceErrorCode): string {
  return mapEnumValue(
    code,
    BALANCE_MESSAGE_KEY_BY_CODE,
    'errors.validation_failed',
  );
}

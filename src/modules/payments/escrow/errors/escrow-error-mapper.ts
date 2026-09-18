import { EscrowServiceErrorCode } from './escrow-service.error';
import { mapEnumValue } from '../../../../core/enum-mapper.util';

const ESCROW_STATUS_BY_CODE: Partial<Record<EscrowServiceErrorCode, number>> = {
  [EscrowServiceErrorCode.DEAL_NOT_FOUND]: 404,
  [EscrowServiceErrorCode.FORBIDDEN]: 403,
  [EscrowServiceErrorCode.INVALID_TRANSITION]: 400,
  [EscrowServiceErrorCode.ESCROW_ALREADY_INITIALIZED]: 409,
  [EscrowServiceErrorCode.ESCROW_AMOUNT_MISMATCH]: 409,
  [EscrowServiceErrorCode.ESCROW_WALLET_MISSING]: 409,
  [EscrowServiceErrorCode.ESCROW_AMOUNT_NOT_SET]: 400,
  [EscrowServiceErrorCode.MOCK_DISABLED]: 403,
};

const ESCROW_MESSAGE_KEY_BY_CODE: Partial<
  Record<EscrowServiceErrorCode, string>
> = {
  [EscrowServiceErrorCode.DEAL_NOT_FOUND]: 'payments.errors.deal_not_found',
  [EscrowServiceErrorCode.FORBIDDEN]: 'payments.errors.forbidden',
  [EscrowServiceErrorCode.INVALID_TRANSITION]:
    'payments.errors.invalid_transition',
  [EscrowServiceErrorCode.ESCROW_ALREADY_INITIALIZED]:
    'payments.errors.escrow_already_initialized',
  [EscrowServiceErrorCode.ESCROW_AMOUNT_MISMATCH]:
    'payments.errors.escrow_amount_mismatch',
  [EscrowServiceErrorCode.ESCROW_WALLET_MISSING]:
    'payments.errors.escrow_wallet_missing',
  [EscrowServiceErrorCode.ESCROW_AMOUNT_NOT_SET]:
    'payments.errors.escrow_amount_missing',
  [EscrowServiceErrorCode.MOCK_DISABLED]: 'payments.errors.mock_disabled',
};

export function mapEscrowErrorToStatus(code: EscrowServiceErrorCode): number {
  return mapEnumValue(code, ESCROW_STATUS_BY_CODE, 400);
}

export function mapEscrowErrorToMessageKey(
  code: EscrowServiceErrorCode,
): string {
  return mapEnumValue(
    code,
    ESCROW_MESSAGE_KEY_BY_CODE,
    'errors.validation_failed',
  );
}

import { BalanceErrorCode } from '../../../../common/constants/errors/error-codes.constants';

export { BalanceErrorCode };

export class BalanceServiceError extends Error {
  constructor(public readonly code: BalanceErrorCode) {
    super(code);
  }
}

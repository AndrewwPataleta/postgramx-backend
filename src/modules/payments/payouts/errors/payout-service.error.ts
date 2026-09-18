import { PayoutErrorCode } from '../../../../common/constants/errors/error-codes.constants';

export { PayoutErrorCode };

export class PayoutServiceError extends Error {
  constructor(
    public readonly code: PayoutErrorCode,
    public readonly details?: Record<string, string>,
  ) {
    super(code);
  }
}

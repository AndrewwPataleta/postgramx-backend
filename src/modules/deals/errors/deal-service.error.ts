import { DealErrorCode } from '../../../common/constants/errors/error-codes.constants';

export { DealErrorCode };

export class DealServiceError extends Error {
  constructor(
    public readonly code: DealErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

import { ServiceError } from '../../../core/service-error';
import { ChannelErrorCode } from '../types/channel-error-code.enum';

export class ChannelServiceError extends ServiceError<ChannelErrorCode> {
  constructor(code: ChannelErrorCode) {
    super(code);
  }
}

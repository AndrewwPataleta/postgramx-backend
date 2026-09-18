import { Body, Controller, HttpException, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { I18n, I18nContext } from 'nestjs-i18n';
import { dtoValidationPipe } from '../../../common/pipes/dto-validation.pipe';
import { assertUser } from '../../../core/controller-utils';
import { AuthType } from '../../../common/constants/auth/auth-types.constants';
import { PlatformType } from '../../../common/constants/platform/platform-types.constants';
import { PayoutRequestDto } from './dto/payout-request.dto';
import { PayoutsService } from './payouts.service';
import {
  mapPayoutErrorToMessageKey,
  mapPayoutErrorToStatus,
} from './errors/payout-error.mapper';
import { PayoutServiceError } from './errors/payout-service.error';

@Controller('payments/payouts')
@ApiTags('payments')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Post('request')
  @ApiOperation({ summary: 'Request payout' })
  @ApiBody({
    schema: {
      example: {
        platformType: PlatformType.TELEGRAM,
        authType: AuthType.TELEGRAM,
        token: '<initData>',
        data: {
          amountNano: '1000000000',
          currency: 'TON',
          mode: 'AMOUNT',
        },
      },
    },
  })
  async requestPayout(
    @Body(dtoValidationPipe) dto: PayoutRequestDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);
    const headerKey = req.headers['idempotency-key'];
    const idempotencyKey =
      typeof headerKey === 'string' ? headerKey : undefined;

    try {
      return await this.payoutsService.requestPayout({
        userId: user.id,
        amountNano: dto.data.amountNano,
        currency: dto.data.currency,
        mode: dto.data.mode,
        idempotencyKey,
      });
    } catch (error) {
      if (error instanceof PayoutServiceError) {
        const status = mapPayoutErrorToStatus(error.code);
        const messageKey = mapPayoutErrorToMessageKey(error.code);
        const message = await i18n.t(messageKey);
        throw new HttpException(
          {
            code: error.code,
            message,
            details: error.details,
          },
          status,
        );
      }
      throw error;
    }
  }
}

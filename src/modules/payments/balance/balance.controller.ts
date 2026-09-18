import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { I18n, I18nContext } from 'nestjs-i18n';
import { dtoValidationPipe } from '../../../common/pipes/dto-validation.pipe';
import { assertUser, handleMappedError } from '../../../core/controller-utils';
import { BalanceOverviewDto } from './dto/balance-overview.dto';
import { BalanceService } from './balance.service';
import { BalanceServiceError } from './errors/balance-service.error';
import {
  mapBalanceErrorToMessageKey,
  mapBalanceErrorToStatus,
} from './errors/balance-error.mapper';
import { AuthType } from '../../../common/constants/auth/auth-types.constants';
import { PlatformType } from '../../../common/constants/platform/platform-types.constants';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';

@Controller('payments/balance')
@ApiTags('payments')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Post('overview')
  @ApiOperation({ summary: 'Get balance overview' })
  @ApiBody({
    schema: {
      example: {
        platformType: PlatformType.TELEGRAM,
        authType: AuthType.TELEGRAM,
        token: '<initData>',
        data: {
          currency: CurrencyCode.TON,
        },
      },
    },
  })
  async getOverview(
    @Body(dtoValidationPipe) dto: BalanceOverviewDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);
    try {
      return await this.balanceService.getOverview(user.id, dto.data.currency);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: BalanceServiceError,
        mapStatus: mapBalanceErrorToStatus,
        mapMessageKey: mapBalanceErrorToMessageKey,
      });
    }
  }
}

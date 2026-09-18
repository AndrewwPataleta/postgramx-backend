import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { I18n, I18nContext } from 'nestjs-i18n';
import { dtoValidationPipe } from '../../../common/pipes/dto-validation.pipe';
import { assertUser, handleMappedError } from '../../../core/controller-utils';
import { DealEscrowStatusDto } from './dto/deal-escrow-status.dto';
import { InitDealEscrowDto } from './dto/init-deal-escrow.dto';
import { EscrowService } from './escrow.service';
import { EscrowServiceError } from './errors/escrow-service.error';
import {
  mapEscrowErrorToMessageKey,
  mapEscrowErrorToStatus,
} from './errors/escrow-error-mapper';

@Controller('payments/escrow')
@ApiTags('payments')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('deal/init')
  @ApiOperation({ summary: 'Initialize escrow for a deal' })
  @ApiBody({ type: InitDealEscrowDto })
  async initDealEscrow(
    @Body(dtoValidationPipe) dto: InitDealEscrowDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.escrowService.initDealEscrow(user.id, dto.data.dealId);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: EscrowServiceError,
        mapStatus: mapEscrowErrorToStatus,
        mapMessageKey: mapEscrowErrorToMessageKey,
      });
    }
  }

  @Post('deal/status')
  @ApiOperation({ summary: 'Get escrow status for a deal' })
  @ApiBody({ type: DealEscrowStatusDto })
  async getDealEscrowStatus(
    @Body(dtoValidationPipe) dto: DealEscrowStatusDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.escrowService.getDealEscrowStatus(
        user.id,
        dto.data.dealId,
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: EscrowServiceError,
        mapStatus: mapEscrowErrorToStatus,
        mapMessageKey: mapEscrowErrorToMessageKey,
      });
    }
  }
}

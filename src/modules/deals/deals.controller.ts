import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { I18n, I18nContext } from 'nestjs-i18n';
import { dtoValidationPipe } from '../../common/pipes/dto-validation.pipe';
import { assertUser, handleMappedError } from '../../core/controller-utils';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { CreativeStatusDto } from './dto/creative-status.dto';
import { CreativeSubmitDto } from './dto/creative-submit.dto';
import { DealDetailDto } from './dto/deal-detail.dto';
import { AdminApproveDto } from './dto/admin-approve.dto';
import { AdminRequestChangesDto } from './dto/admin-request-changes.dto';
import { AdminRejectDto } from './dto/admin-reject.dto';
import { GetDealDto } from './dto/get-deal.dto';
import { ListDealsDto } from './dto/list-deals.dto';
import { ScheduleDealDto } from './dto/schedule-deal.dto';
import { DealServiceError } from './errors/deal-service.error';
import {
  mapDealErrorToMessageKey,
  mapDealErrorToStatus,
} from './deal-error-mapper';
import { CancelDealDto } from './dto/cancel-deal.dto';
import { AuthType } from '../../common/constants/auth/auth-types.constants';
import { PlatformType } from '../../common/constants/platform/platform-types.constants';
import { PaymentsService } from '../payments/payments.service';
import { DealPaymentPrepareDto } from './dto/deal-payment-prepare.dto';
import { PostAnalyticsService } from '../post-analytics/services/post-analytics.service';
import { CreativeReviewActionDto } from './dto/creative-review-action.dto';

@Controller('deals')
@ApiTags('deals')
export class DealsController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly paymentsService: PaymentsService,
    private readonly postAnalyticsService: PostAnalyticsService,
  ) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a deal from a listing' })
  @ApiBody({ type: CreateDealDto })
  async createDeal(
    @Body(dtoValidationPipe) dto: CreateDealDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.createDeal(
        user.id,
        dto.data.listingId,
        dto.data.brief,
        dto.data.scheduledAt,
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('list')
  @ApiOperation({ summary: 'List deals grouped by status' })
  @ApiBody({ type: ListDealsDto })
  async listDeals(
    @Body(dtoValidationPipe) dto: ListDealsDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.listDeals(user.id, dto.data);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('get')
  @ApiOperation({ summary: 'Get deal by id' })
  @ApiBody({ type: GetDealDto })
  async getDeal(
    @Body(dtoValidationPipe) dto: GetDealDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.getDeal(user.id, dto.data.dealId);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post(':id/payment/prepare')
  @ApiOperation({ summary: 'Prepare payment for a deal' })
  @ApiBody({
    type: DealPaymentPrepareDto,
    schema: {
      example: {
        platformType: PlatformType.TELEGRAM,
        authType: AuthType.TELEGRAM,
        token: '<initData>',
        data: {},
      },
    },
  })
  async preparePayment(
    @Param('id') dealId: string,
    @Body(dtoValidationPipe) _dto: DealPaymentPrepareDto,
    @Req() req: Request,
  ) {
    const user = assertUser(req);
    const deal = await this.dealsService.getDeal(user.id, dealId);
    if (deal.advertiserUserId !== user.id) {
      throw new ForbiddenException();
    }
    return this.paymentsService.ensureDepositAddressForDeal(dealId);
  }

  @Post('detail')
  @ApiOperation({ summary: 'Get deal details for timeline screen' })
  @ApiBody({
    type: DealDetailDto,
    schema: {
      example: {
        platformType: PlatformType.TELEGRAM,
        authType: AuthType.TELEGRAM,
        token: '<initData>',
        data: { id: '<deal uuid>' },
      },
    },
  })
  async detail(
    @Body(dtoValidationPipe) dto: DealDetailDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.getDeal(user.id, dto.data.id);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Get(':id/post-analytics')
  @ApiOperation({ summary: 'Get post analytics for a deal' })
  async getPostAnalytics(
    @Param('id') dealId: string,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      await this.dealsService.getDeal(user.id, dealId);
      return await this.postAnalyticsService.getDealAnalytics(dealId);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Get(':id/pin-visibility')
  @ApiOperation({ summary: 'Get pin visibility status for a deal' })
  async getPinVisibility(
    @Param('id') dealId: string,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.getPinVisibility(user.id, dealId);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('schedule')
  @ApiOperation({ summary: 'Schedule a deal posting time' })
  @ApiBody({ type: ScheduleDealDto })
  async scheduleDeal(
    @Body(dtoValidationPipe) dto: ScheduleDealDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.scheduleDeal(user.id, dto.data.id, {
        scheduledAt: dto.data.scheduledAt,
        publishAtUtc: dto.data.publishAtUtc,
        publishAtLocal: dto.data.publishAtLocal,
        timeZone: dto.data.timeZone,
        utcOffsetMinutes: dto.data.utcOffsetMinutes,
      });
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('creative/submit')
  @ApiOperation({ summary: 'Submit creative confirmation for a deal' })
  @ApiBody({ type: CreativeSubmitDto })
  async submitCreative(
    @Body(dtoValidationPipe) dto: CreativeSubmitDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.submitCreative(user.id, dto.data.dealId);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('creative/status')
  @ApiOperation({ summary: 'Get creative status for a deal' })
  @ApiBody({ type: CreativeStatusDto })
  async getCreativeStatus(
    @Body(dtoValidationPipe) dto: CreativeStatusDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.getCreativeStatus(
        user.id,
        dto.data.dealId,
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('creative/approve')
  @ApiOperation({ summary: 'Approve creative via API' })
  @ApiBody({ type: CreativeReviewActionDto })
  async approveCreative(
    @Body(dtoValidationPipe) dto: CreativeReviewActionDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.approveCreativeByAdmin(
        user.id,
        dto.data.id,
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('creative/edits')
  @ApiOperation({ summary: 'Request creative edits via API' })
  @ApiBody({ type: CreativeReviewActionDto })
  async requestCreativeEdits(
    @Body(dtoValidationPipe) dto: CreativeReviewActionDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.requestChangesByAdmin(
        user.id,
        dto.data.id,
        undefined,
        'creative',
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('creative/reject')
  @ApiOperation({ summary: 'Reject creative via API' })
  @ApiBody({ type: CreativeReviewActionDto })
  async rejectCreative(
    @Body(dtoValidationPipe) dto: CreativeReviewActionDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.rejectByAdmin(user.id, dto.data.id);
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('admin/approve')
  @ApiOperation({ summary: 'Approve a deal as admin' })
  @ApiBody({ type: AdminApproveDto })
  async approveDealByAdmin(
    @Body(dtoValidationPipe) dto: AdminApproveDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.approveCreativeByAdmin(
        user.id,
        dto.data.dealId,
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('admin/requestChanges')
  @ApiOperation({ summary: 'Request creative changes as admin' })
  @ApiBody({ type: AdminRequestChangesDto })
  async requestChangesByAdmin(
    @Body(dtoValidationPipe) dto: AdminRequestChangesDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.requestChangesByAdmin(
        user.id,
        dto.data.dealId,
        dto.data.comment,
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('admin/reject')
  @ApiOperation({ summary: 'Reject a deal as admin' })
  @ApiBody({ type: AdminRejectDto })
  async rejectByAdmin(
    @Body(dtoValidationPipe) dto: AdminRejectDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.rejectByAdmin(
        user.id,
        dto.data.dealId,
        dto.data.reason,
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Cancel a deal' })
  @ApiBody({ type: CancelDealDto })
  async cancelDeal(
    @Body(dtoValidationPipe) dto: CancelDealDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);

    try {
      return await this.dealsService.cancelDeal(
        user.id,
        dto.data.dealId,
        dto.data.reason,
      );
    } catch (error) {
      await handleMappedError(error, i18n, {
        errorType: DealServiceError,
        mapStatus: mapDealErrorToStatus,
        mapMessageKey: mapDealErrorToMessageKey,
      });
    }
  }
}

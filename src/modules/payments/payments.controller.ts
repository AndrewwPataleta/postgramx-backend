import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { I18n, I18nContext } from 'nestjs-i18n';
import { dtoValidationPipe } from '../../common/pipes/dto-validation.pipe';
import { assertUser } from '../../core/controller-utils';
import { GetTransactionDto } from './dto/get-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { PaymentsService } from './payments.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { AuthType } from '../../common/constants/auth/auth-types.constants';
import { PlatformType } from '../../common/constants/platform/platform-types.constants';
import { TransactionStatus } from '../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../common/constants/payments/transaction-type.constants';
import { TransactionDirection } from '../../common/constants/payments/transaction-direction.constants';
import { CurrencyCode } from '../../common/constants/currency/currency.constants';

@Controller('payments')
@ApiTags('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('transactions/list')
  @ApiOperation({
    summary: "List user's transactions with filters and pagination",
  })
  @ApiBody({
    schema: {
      example: {
        platformType: PlatformType.TELEGRAM,
        authType: AuthType.TELEGRAM,
        token: '<initData>',
        data: {
          page: 1,
          limit: 20,
          status: TransactionStatus.COMPLETED,
          sort: 'recent',
          order: 'desc',
        },
      },
    },
  })
  async list(
    @Body(dtoValidationPipe) dto: ListTransactionsDto,
    @Req() req: Request,
    @I18n() i18n: I18nContext,
  ) {
    const user = assertUser(req);
    return this.paymentsService.listTransactionsForUser(
      user.id,
      dto.data,
      i18n,
    );
  }

  @Post('transactions/:id')
  @ApiOperation({ summary: 'Get a transaction for current user' })
  @ApiBody({
    schema: {
      example: {
        platformType: PlatformType.TELEGRAM,
        authType: AuthType.TELEGRAM,
        token: '<initData>',
        data: {},
      },
    },
  })
  async getTransaction(
    @Param('id') id: string,
    @Body(dtoValidationPipe) dto: GetTransactionDto,
    @Req() req: Request,
  ) {
    const user = assertUser(req);
    return this.paymentsService.getTransactionForUser(user.id, id);
  }

  @Post('transactions')
  @ApiOperation({
    summary: `Create ${CurrencyCode.TON} transaction and generate deposit address`,
  })
  @ApiBody({
    schema: {
      example: {
        platformType: PlatformType.TELEGRAM,
        authType: AuthType.TELEGRAM,
        token: '<initData>',
        data: {
          type: TransactionType.DEPOSIT,
          direction: TransactionDirection.IN,
          amountNano: '1000000000',
          description: 'Ad campaign payment',
          dealId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        },
      },
    },
  })
  async createTransaction(
    @Body(dtoValidationPipe) dto: CreateTransactionDto,
    @Req() req: Request,
  ) {
    const user = assertUser(req);

    return this.paymentsService.createTransaction({
      ...dto.data,
      userId: user.id,
    });
  }
}

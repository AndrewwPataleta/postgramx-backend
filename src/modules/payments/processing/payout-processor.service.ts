import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PayoutRequestEntity } from '../entities/payout-request.entity';
import { RefundRequestEntity } from '../entities/refund-request.entity';
import { RequestStatus } from '../../../common/constants/payments/request-status.constants';
import { UserWalletEntity } from '../entities/user-wallet.entity';
import { TransactionEntity } from '../entities/transaction.entity';
import { TransactionDirection } from '../../../common/constants/payments/transaction-direction.constants';
import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../../common/constants/payments/transaction-type.constants';
import { TonHotWalletService } from '../ton/ton-hot-wallet.service';
import { TonTransferEntity } from '../entities/ton-transfer.entity';
import { TonTransferStatus } from '../../../common/constants/payments/ton-transfer-status.constants';
import { TonTransferType } from '../../../common/constants/payments/ton-transfer-type.constants';
import { LiquidityService } from './liquidity.service';
import { PaymentsProcessingConfigService } from './payments-processing-config.service';
import { AdminAlertsService } from './admin-alerts.service';
import { TonSweepService } from './ton-sweep.service';
import { DealEscrowEntity } from '../../deals/entities/deal-escrow.entity';
import { EscrowWalletEntity } from '../entities/escrow-wallet.entity';
import { EscrowStatus } from '../../../common/constants/deals/deal-escrow-status.constants';
import { TelegramPermissionsService } from '../../telegram/telegram-permissions.service';
import {
  InsufficientHotLiquidityError,
  SweepFailedError,
  SweepNotWorthItError,
} from './payments-processing.errors';
import { withAdvisoryLock } from './advisory-lock';
import { ADVISORY_LOCKS } from '../../../common/constants';
import { buildIdempotencyKey } from '../../../common/utils/idempotency.util';
import { DealEntity } from '../../deals/entities/deal.entity';

@Injectable()
export class PayoutProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PayoutProcessor');
  private job?: CronJob;
  private isRunning = false;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly dataSource: DataSource,
    @InjectRepository(PayoutRequestEntity)
    private readonly payoutRepository: Repository<PayoutRequestEntity>,
    @InjectRepository(RefundRequestEntity)
    private readonly refundRepository: Repository<RefundRequestEntity>,
    @InjectRepository(UserWalletEntity)
    private readonly userWalletRepository: Repository<UserWalletEntity>,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectRepository(TonTransferEntity)
    private readonly transferRepository: Repository<TonTransferEntity>,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepository: Repository<DealEscrowEntity>,
    @InjectRepository(EscrowWalletEntity)
    private readonly escrowWalletRepository: Repository<EscrowWalletEntity>,
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    private readonly tonHotWalletService: TonHotWalletService,
    private readonly liquidityService: LiquidityService,
    private readonly config: PaymentsProcessingConfigService,
    private readonly adminAlertsService: AdminAlertsService,
    private readonly tonSweepService: TonSweepService,
    private readonly telegramPermissionsService: TelegramPermissionsService,
  ) {}

  onModuleInit(): void {
    const expression = `*/${this.config.payoutCronEverySeconds} * * * * *`;
    this.job = new CronJob(expression, () => {
      void this.processQueue();
    });
    this.schedulerRegistry.addCronJob('payout-processor', this.job);
    this.job.start();
    this.logger.log(`Payout processor scheduled: ${expression}`);
  }

  onModuleDestroy(): void {
    if (this.job) {
      this.job.stop();
      this.schedulerRegistry.deleteCronJob('payout-processor');
    }
  }

  async processQueue(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    let lowLiquidityNotified = false;
    try {
      const payouts = await this.payoutRepository.find({
        where: { status: In([RequestStatus.CREATED, RequestStatus.FAILED]) },
        take: this.config.payoutBatchLimit,
        order: { updatedAt: 'ASC' },
      });

      for (const payout of payouts) {
        await this.processPayout(payout, () => {
          if (!lowLiquidityNotified) {
            lowLiquidityNotified = true;
            return true;
          }
          return false;
        });
      }

      const refunds = await this.refundRepository.find({
        where: { status: In([RequestStatus.CREATED, RequestStatus.FAILED]) },
        take: this.config.payoutBatchLimit,
        order: { updatedAt: 'ASC' },
      });

      for (const refund of refunds) {
        await this.processRefund(refund, () => {
          if (!lowLiquidityNotified) {
            lowLiquidityNotified = true;
            return true;
          }
          return false;
        });
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processPayout(
    payout: PayoutRequestEntity,
    notifyLowLiquidityOnce: () => boolean,
  ): Promise<void> {
    await withAdvisoryLock(
      this.dataSource,
      buildIdempotencyKey(ADVISORY_LOCKS.TON_PAYOUT, payout.id),
      async () => {
        const payload = await this.dataSource.transaction(async (manager) => {
          const payoutRepo = manager.getRepository(PayoutRequestEntity);
          const locked = await payoutRepo.findOne({
            where: { id: payout.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (
            !locked ||
            ![RequestStatus.CREATED, RequestStatus.FAILED].includes(
              locked.status,
            )
          ) {
            return null;
          }

          locked.status = RequestStatus.PROCESSING;
          locked.attemptCount += 1;
          await payoutRepo.save(locked);

          return locked;
        });

        if (!payload) {
          return;
        }

        const wallet = await this.userWalletRepository.findOne({
          where: { userId: payload.userId, isActive: true },
        });
        if (!wallet) {
          await this.failRequest('payout', payload.id, 'User wallet not set');
          this.logger.warn(
            `Payout failed: wallet missing`,
            JSON.stringify({
              dealId: payload.dealId,
              requestId: payload.id,
            }),
          );
          return;
        }

        const permissionsOk = await this.ensurePayoutPermissions(
          payload.dealId,
          payload.userId,
        );
        if (!permissionsOk) {
          await this.failRequest(
            'payout',
            payload.id,
            'Permission check failed',
          );
          this.logger.warn(
            `Payout failed: permissions check failed`,
            JSON.stringify({
              dealId: payload.dealId,
              requestId: payload.id,
            }),
          );
          return;
        }

        await this.handleOutgoingTransfer({
          kind: 'payout',
          requestId: payload.id,
          userId: payload.userId,
          dealId: payload.dealId,
          amountNano: BigInt(payload.amountNano),
          currency: payload.currency,
          toAddress: wallet.tonAddress,
          notifyLowLiquidityOnce,
        });
      },
    );
  }

  private async processRefund(
    refund: RefundRequestEntity,
    notifyLowLiquidityOnce: () => boolean,
  ): Promise<void> {
    await withAdvisoryLock(this.dataSource, `refund:${refund.id}`, async () => {
      const payload = await this.dataSource.transaction(async (manager) => {
        const refundRepo = manager.getRepository(RefundRequestEntity);
        const locked = await refundRepo.findOne({
          where: { id: refund.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !locked ||
          ![RequestStatus.CREATED, RequestStatus.FAILED].includes(locked.status)
        ) {
          return null;
        }

        locked.status = RequestStatus.PROCESSING;
        locked.attemptCount += 1;
        await refundRepo.save(locked);

        return locked;
      });

      if (!payload) {
        return;
      }

      const wallet = await this.userWalletRepository.findOne({
        where: { userId: payload.userId, isActive: true },
      });
      if (!wallet) {
        await this.failRequest('refund', payload.id, 'User wallet not set');
        this.logger.warn(
          `Refund failed: wallet missing`,
          JSON.stringify({
            dealId: payload.dealId,
            requestId: payload.id,
          }),
        );
        return;
      }

      await this.handleOutgoingTransfer({
        kind: 'refund',
        requestId: payload.id,
        userId: payload.userId,
        dealId: payload.dealId,
        amountNano: BigInt(payload.amountNano),
        currency: payload.currency,
        toAddress: wallet.tonAddress,
        notifyLowLiquidityOnce,
      });
    });
  }

  private async handleOutgoingTransfer(options: {
    kind: 'payout' | 'refund';
    requestId: string;
    userId: string;
    dealId: string;
    amountNano: bigint;
    currency: string;
    toAddress: string;
    notifyLowLiquidityOnce: () => boolean;
  }): Promise<void> {
    const idempotencyKey = `${options.kind}:${options.requestId}`;
    const existing = await this.transferRepository.findOne({
      where: { idempotencyKey },
    });

    if (existing && existing.status !== TonTransferStatus.FAILED) {
      await this.markRequestSent(
        options.kind,
        options.requestId,
        existing.txHash,
      );
      await this.markEscrowSettled(options.kind, options.dealId);
      if (
        existing.status === TonTransferStatus.COMPLETED ||
        existing.status === TonTransferStatus.SIMULATED
      ) {
        await this.createTransactionRecord(
          options,
          TransactionStatus.COMPLETED,
          existing.txHash,
          null,
        );
      }
      return;
    }

    try {
      const liquidity = await this.liquidityService.canSpendFromHot(
        options.amountNano,
      );
      if (
        this.config.hotWalletLowLiquidityThresholdNano > 0n &&
        liquidity.balanceNano <=
          this.config.hotWalletLowLiquidityThresholdNano &&
        options.notifyLowLiquidityOnce()
      ) {
        await this.adminAlertsService.notifyLowLiquidity({
          balanceNano: liquidity.balanceNano.toString(),
          thresholdNano:
            this.config.hotWalletLowLiquidityThresholdNano.toString(),
          reserveNano: this.config.hotWalletMinReserveNano.toString(),
        });
      }
      if (!liquidity.canSpend) {
        if (options.notifyLowLiquidityOnce()) {
          await this.adminAlertsService.notifyLowLiquidity({
            balanceNano: liquidity.balanceNano.toString(),
            reserveNano: this.config.hotWalletMinReserveNano.toString(),
          });
        }
        if (this.config.sweepFallbackEnabled) {
          await this.attemptSweepAndRetry(options, liquidity.balanceNano);
          return;
        }
        throw new InsufficientHotLiquidityError();
      }

      await this.sendFromHotWallet(options, idempotencyKey);
    } catch (error) {
      await this.handleFailure(options, error);
    }
  }

  private async attemptSweepAndRetry(
    options: {
      kind: 'payout' | 'refund';
      requestId: string;
      userId: string;
      dealId: string;
      amountNano: bigint;
      currency: string;
      toAddress: string;
      notifyLowLiquidityOnce: () => boolean;
    },
    hotBalanceNano: bigint,
  ): Promise<void> {
    try {
      const escrow = await this.escrowRepository.findOne({
        where: { dealId: options.dealId },
      });
      if (!escrow?.depositWalletId) {
        throw new SweepFailedError('Deposit wallet not found');
      }
      if (!this.config.sweepOnlyForThisDeal) {
        this.logger.warn(
          `Sweep configured for non-deal wallets, using deal wallet ${escrow.depositWalletId}`,
        );
      }

      const wallet = await this.escrowWalletRepository.findOne({
        where: { id: escrow.depositWalletId },
      });
      if (!wallet) {
        throw new SweepFailedError('Deposit wallet missing');
      }

      const sweepResult = await this.tonSweepService.sweepDepositToHot({
        dealId: options.dealId,
        wallet,
        needNano: options.amountNano,
      });
      if (!sweepResult) {
        throw new SweepFailedError('Sweep lock not acquired');
      }

      await this.adminAlertsService.notifyFallbackSweepUsed({
        dealId: options.dealId,
        amountNano: sweepResult.amountNano.toString(),
        fromAddress: wallet.address,
      });

      const liquidity = await this.liquidityService.canSpendFromHot(
        options.amountNano,
      );
      if (!liquidity.canSpend) {
        throw new InsufficientHotLiquidityError();
      }

      await this.sendFromHotWallet(
        options,
        `${options.kind}:${options.requestId}`,
      );
    } catch (error) {
      if (
        error instanceof SweepFailedError ||
        error instanceof SweepNotWorthItError
      ) {
        await this.adminAlertsService.notifySweepFailed({
          dealId: options.dealId,
          error: error instanceof Error ? error.message : String(error),
          hotBalanceNano: hotBalanceNano.toString(),
        });
      }
      await this.handleFailure(options, error);
    }
  }

  private async sendFromHotWallet(
    options: {
      kind: 'payout' | 'refund';
      requestId: string;
      userId: string;
      dealId: string;
      amountNano: bigint;
      currency: string;
      toAddress: string;
    },
    idempotencyKey: string,
  ): Promise<void> {
    const now = new Date();
    const transfer = this.transferRepository.create({
      transactionId: null,
      dealId: options.dealId,
      escrowWalletId: null,
      idempotencyKey,
      type:
        options.kind === 'payout'
          ? TonTransferType.PAYOUT
          : TonTransferType.REFUND,
      status: this.config.payoutDryRun
        ? TonTransferStatus.SIMULATED
        : TonTransferStatus.CREATED,
      network: options.currency as any,
      fromAddress: this.config.hotWalletAddress ?? '',
      toAddress: options.toAddress,
      amountNano: options.amountNano.toString(),
      txHash: null,
      observedAt: now,
      raw: { dryRun: this.config.payoutDryRun },
    });

    if (this.config.payoutDryRun) {
      await this.transferRepository.save(transfer);
      await this.markRequestSent(options.kind, options.requestId, null);
      await this.markEscrowSettled(options.kind, options.dealId);
      await this.createTransactionRecord(
        options,
        TransactionStatus.COMPLETED,
        null,
        null,
      );
      this.logger.log(
        `Dry run ${options.kind} recorded for deal ${options.dealId}`,
      );
      return;
    }

    const { txHash } = await this.tonHotWalletService.sendTon({
      toAddress: options.toAddress,
      amountNano: options.amountNano,
    });

    transfer.txHash = txHash;
    transfer.status = TonTransferStatus.COMPLETED;
    await this.transferRepository.save(transfer);

    await this.markRequestSent(options.kind, options.requestId, txHash);
    await this.markEscrowSettled(options.kind, options.dealId);
    await this.createTransactionRecord(
      options,
      TransactionStatus.COMPLETED,
      txHash,
      null,
    );

    this.logger.log(
      `${options.kind} sent`,
      JSON.stringify({
        dealId: options.dealId,
        requestId: options.requestId,
        amountNano: options.amountNano.toString(),
        toAddress: options.toAddress,
      }),
    );
  }

  private async handleFailure(
    options: {
      kind: 'payout' | 'refund';
      requestId: string;
      userId: string;
      dealId: string;
      amountNano: bigint;
      currency: string;
      toAddress: string;
      notifyLowLiquidityOnce: () => boolean;
    },
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await this.failRequest(options.kind, options.requestId, errorMessage);
    const isLiquidityError =
      error instanceof InsufficientHotLiquidityError ||
      error instanceof SweepNotWorthItError ||
      error instanceof SweepFailedError;
    const status = isLiquidityError
      ? TransactionStatus.BLOCKED_LIQUIDITY
      : TransactionStatus.FAILED;
    const errorCode = isLiquidityError ? 'INSUFFICIENT_LIQUIDITY' : null;
    await this.createTransactionRecord(options, status, null, errorCode);
    if (isLiquidityError) {
      const hotBalance = await this.liquidityService.getHotBalanceNano();
      let depositBalance: string | null = null;
      let depositDeployed: boolean | null = null;
      const escrow = await this.escrowRepository.findOne({
        where: { dealId: options.dealId },
      });
      if (escrow?.depositAddress) {
        const state = await this.liquidityService.getDepositWalletBalanceState(
          escrow.depositAddress,
        );
        depositBalance = state.balanceNano.toString();
        depositDeployed = state.isDeployed;
      }
      await this.adminAlertsService.notifyManualActionNeeded({
        dealId: options.dealId,
        reason: errorMessage,
        amountNano: options.amountNano.toString(),
        toAddress: options.toAddress,
        hotBalanceNano: hotBalance.toString(),
        depositBalanceNano: depositBalance,
        depositWalletDeployed: depositDeployed,
      });
    }
    this.logger.warn(
      `${options.kind} failed`,
      JSON.stringify({
        dealId: options.dealId,
        requestId: options.requestId,
        error: errorMessage,
      }),
    );
  }

  private async markRequestSent(
    kind: 'payout' | 'refund',
    requestId: string,
    txHash: string | null,
  ): Promise<void> {
    if (kind === 'payout') {
      await this.payoutRepository.update(requestId, {
        status: RequestStatus.SENT,
        txHash,
        errorMessage: null,
      });
    } else {
      await this.refundRepository.update(requestId, {
        status: RequestStatus.SENT,
        txHash,
        errorMessage: null,
      });
    }
  }

  private async failRequest(
    kind: 'payout' | 'refund',
    requestId: string,
    errorMessage: string,
  ): Promise<void> {
    if (kind === 'payout') {
      await this.payoutRepository.update(requestId, {
        status: RequestStatus.FAILED,
        errorMessage,
      });
    } else {
      await this.refundRepository.update(requestId, {
        status: RequestStatus.FAILED,
        errorMessage,
      });
    }
  }

  private async markEscrowSettled(
    kind: 'payout' | 'refund',
    dealId: string,
  ): Promise<void> {
    if (kind === 'payout') {
      await this.escrowRepository.update(
        { dealId },
        { status: EscrowStatus.PAID_OUT, paidOutAt: new Date() },
      );
    } else {
      await this.escrowRepository.update(
        { dealId },
        { status: EscrowStatus.REFUNDED, refundedAt: new Date() },
      );
    }
  }

  private async createTransactionRecord(
    options: {
      kind: 'payout' | 'refund';
      requestId: string;
      userId: string;
      dealId: string;
      amountNano: bigint;
      currency: string;
    },
    status: TransactionStatus,
    txHash: string | null,
    errorCode: string | null,
  ): Promise<void> {
    const existing = await this.transactionRepository.findOne({
      where: {
        sourceRequestId: options.requestId,
        type:
          options.kind === 'payout'
            ? TransactionType.PAYOUT
            : TransactionType.REFUND,
      },
    });

    if (existing) {
      await this.transactionRepository.update(existing.id, {
        status,
        externalTxHash: txHash ?? existing.externalTxHash,
        errorCode,
        idempotencyKey:
          existing.idempotencyKey ?? `${options.kind}:${options.requestId}`,
        completedAt:
          status === TransactionStatus.COMPLETED
            ? new Date()
            : existing.completedAt,
      });
      return;
    }

    await this.transactionRepository.save(
      this.transactionRepository.create({
        userId: options.userId,
        type:
          options.kind === 'payout'
            ? TransactionType.PAYOUT
            : TransactionType.REFUND,
        direction: TransactionDirection.OUT,
        status,
        amountNano: options.amountNano.toString(),
        currency: options.currency as any,
        dealId: options.dealId,
        description: options.kind === 'payout' ? 'Payout' : 'Refund',
        externalTxHash: txHash,
        errorCode,
        sourceRequestId: options.requestId,
        idempotencyKey: `${options.kind}:${options.requestId}`,
        completedAt: status === TransactionStatus.COMPLETED ? new Date() : null,
      }),
    );
  }

  private async ensurePayoutPermissions(
    dealId: string,
    publisherUserId: string,
  ): Promise<boolean> {
    const deal = await this.dealRepository.findOne({ where: { id: dealId } });
    if (!deal?.channelId) {
      return false;
    }

    const botCheck = await this.telegramPermissionsService.checkBotIsAdmin(
      deal.channelId,
    );
    if (!botCheck.ok) {
      return false;
    }

    const userCheck = await this.telegramPermissionsService.checkUserIsAdmin(
      publisherUserId,
      deal.channelId,
    );
    return userCheck.ok;
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { TransactionEntity } from '../entities/transaction.entity';
import { TonTransferEntity } from '../entities/ton-transfer.entity';
import { TransactionType } from '../../../common/constants/payments/transaction-type.constants';
import { TransactionDirection } from '../../../common/constants/payments/transaction-direction.constants';
import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';
import { TonTransferStatus } from '../../../common/constants/payments/ton-transfer-status.constants';
import { TonTransferType } from '../../../common/constants/payments/ton-transfer-type.constants';
import { TonHotWalletService } from '../ton/ton-hot-wallet.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentsProcessingConfigService } from './payments-processing-config.service';
import { withAdvisoryLock } from './advisory-lock';
import { ensureTransitionAllowed } from '../payouts/payout-state';
import { TelegramMessengerService } from '../../telegram/telegram-messenger.service';
import { TelegramSenderService } from '../../telegram/telegram-sender.service';
import { User } from '../../auth/entities/user.entity';
import { NotificationLogEntity } from '../entities/notification-log.entity';
import { formatTon } from '../utils/bigint';
import {
  ADVISORY_LOCKS,
  CRON_JOB_NAMES,
  IDEMPOTENCY_PREFIX,
} from '../../../common/constants';
import { buildIdempotencyKey } from '../../../common/utils/idempotency.util';

@Injectable()
export class PayoutExecutionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PayoutExecution');
  private job?: CronJob;
  private isRunning = false;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly dataSource: DataSource,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectRepository(TonTransferEntity)
    private readonly transferRepository: Repository<TonTransferEntity>,
    @InjectRepository(NotificationLogEntity)
    private readonly notificationLogRepository: Repository<NotificationLogEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly ledgerService: LedgerService,
    private readonly tonHotWalletService: TonHotWalletService,
    private readonly config: PaymentsProcessingConfigService,
    private readonly telegramMessengerService: TelegramMessengerService,
    private readonly telegramSenderService: TelegramSenderService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const expression = `*/${this.config.payoutCronEverySeconds} * * * * *`;
    this.job = new CronJob(expression, () => {
      void this.processQueue();
    });
    this.schedulerRegistry.addCronJob(
      CRON_JOB_NAMES.PAYOUT_EXECUTION,
      this.job,
    );
    this.job.start();
    this.logger.log(`Payout execution scheduled: ${expression}`);
  }

  onModuleDestroy(): void {
    if (this.job) {
      this.job.stop();
      this.schedulerRegistry.deleteCronJob(CRON_JOB_NAMES.PAYOUT_EXECUTION);
    }
  }

  async processQueue(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      const payouts = await this.transactionRepository.find({
        where: {
          type: TransactionType.PAYOUT,
          direction: TransactionDirection.OUT,
          status: In([
            TransactionStatus.PENDING,
            TransactionStatus.BLOCKED_LIQUIDITY,
          ]),
        },
        take: this.config.payoutBatchLimit,
        order: { updatedAt: 'ASC' },
      });

      for (const payout of payouts) {
        await this.processPayout(payout);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processPayout(payout: TransactionEntity): Promise<void> {
    await withAdvisoryLock(
      this.dataSource,
      buildIdempotencyKey(ADVISORY_LOCKS.TON_PAYOUT, payout.id),
      async () => {
        const locked = await this.dataSource.transaction(async (manager) => {
          const txRepo = manager.getRepository(TransactionEntity);
          const transferRepo = manager.getRepository(TonTransferEntity);
          const current = await txRepo.findOne({
            where: { id: payout.id },
            lock: { mode: 'pessimistic_write' },
          });

          if (
            !current ||
            current.type !== TransactionType.PAYOUT ||
            current.direction !== TransactionDirection.OUT
          ) {
            return null;
          }

          if (
            ![
              TransactionStatus.PENDING,
              TransactionStatus.BLOCKED_LIQUIDITY,
            ].includes(current.status)
          ) {
            return null;
          }

          if (current.externalTxHash) {
            this.logger.log(
              `Skip broadcast: already has tx hash`,
              JSON.stringify({
                payoutId: current.id,
                userId: current.userId,
                idempotencyKey: current.idempotencyKey,
                externalTxHash: current.externalTxHash,
              }),
            );
            return null;
          }

          if (!current.destinationAddress) {
            await this.failPayout(
              txRepo,
              current,
              'Destination address missing',
            );
            return null;
          }

          let transfer: TonTransferEntity | null = null;
          if (current.tonTransferId) {
            transfer = await transferRepo.findOne({
              where: { id: current.tonTransferId },
            });
            if (
              transfer &&
              ![TonTransferStatus.FAILED, TonTransferStatus.CREATED].includes(
                transfer.status,
              )
            ) {
              this.logger.log(
                `Skip broadcast: already broadcasted`,
                JSON.stringify({
                  payoutId: current.id,
                  userId: current.userId,
                  idempotencyKey: current.idempotencyKey,
                  tonTransferId: transfer.id,
                  status: transfer.status,
                }),
              );
              return null;
            }
            if (transfer && transfer.status === TonTransferStatus.FAILED) {
              await this.failPayout(
                txRepo,
                current,
                'Existing transfer failed',
              );
              return null;
            }
            if (!transfer) {
              await this.failPayout(
                txRepo,
                current,
                'Missing transfer for payout',
              );
              return null;
            }
          }

          const amountToUserNano = BigInt(
            current.amountToUserNano || current.amountNano,
          );
          const totalDebitNano = BigInt(
            current.totalDebitNano || current.amountNano,
          );
          if (amountToUserNano <= 0n || totalDebitNano <= 0n) {
            await this.failPayout(txRepo, current, 'Invalid payout amount');
            return null;
          }

          const balance = await this.ledgerService.getWithdrawableBalance(
            current.userId,
            current.currency,
            manager,
          );
          const availableForPayout =
            BigInt(balance.withdrawableNano) + totalDebitNano;
          if (availableForPayout < totalDebitNano) {
            await this.failPayout(
              txRepo,
              current,
              'Reserved balance is insufficient',
            );
            return null;
          }

          if (!current.tonTransferId) {
            const idempotencyKey = buildIdempotencyKey(
              IDEMPOTENCY_PREFIX.PAYOUT,
              current.id,
            );
            transfer = await transferRepo.findOne({
              where: { idempotencyKey },
            });
            if (!transfer) {
              const now = new Date();
              const observedWindowMs = 6 * 60 * 60 * 1000;
              transfer = transferRepo.create({
                transactionId: current.id,
                dealId: current.dealId ?? null,
                escrowWalletId: null,
                idempotencyKey,
                type: TonTransferType.PAYOUT,
                status: this.config.payoutDryRun
                  ? TonTransferStatus.SIMULATED
                  : TonTransferStatus.CREATED,
                network: current.currency,
                fromAddress: this.config.hotWalletAddress ?? '',
                toAddress: current.destinationAddress,
                amountNano: current.amountToUserNano ?? current.amountNano,
                txHash: null,
                observedAt: this.config.payoutDryRun ? now : null,
                raw: { dryRun: this.config.payoutDryRun },
                errorMessage: null,
              });
              transfer = await transferRepo.save(transfer);

              await txRepo.update(current.id, {
                expectedObservedAfter: new Date(
                  now.getTime() - observedWindowMs,
                ),
                expectedObservedBefore: new Date(
                  now.getTime() + observedWindowMs,
                ),
              });
            }

            await txRepo.update(current.id, {
              tonTransferId: transfer.id,
            });
            current.tonTransferId = transfer.id;
          }

          return {
            payout: current,
            transfer,
          };
        });

        if (!locked) {
          return;
        }

        const { payout: lockedPayout, transfer } = locked;
        if (!transfer) {
          return;
        }

        if (
          lockedPayout.type !== TransactionType.PAYOUT ||
          lockedPayout.direction !== TransactionDirection.OUT
        ) {
          this.logger.warn(
            `Skip broadcast: invalid payout type or direction`,
            JSON.stringify({
              payoutId: lockedPayout.id,
              type: lockedPayout.type,
              direction: lockedPayout.direction,
            }),
          );
          return;
        }

        if (
          lockedPayout.externalTxHash ||
          lockedPayout.tonTransferId !== transfer.id
        ) {
          this.logger.log(
            `Skip broadcast: already broadcasted`,
            JSON.stringify({
              payoutId: lockedPayout.id,
              userId: lockedPayout.userId,
              idempotencyKey: lockedPayout.idempotencyKey,
              tonTransferId: lockedPayout.tonTransferId,
              externalTxHash: lockedPayout.externalTxHash,
            }),
          );
          return;
        }

        const hotBalanceNano = await this.tonHotWalletService.getBalance();
        const reservedNano = await this.ledgerService.getReservedPayoutsTotal(
          lockedPayout.currency,
        );
        const canSpendNano = hotBalanceNano - BigInt(reservedNano);

        const amountToUserNano = BigInt(
          lockedPayout.amountToUserNano || lockedPayout.amountNano,
        );
        if (canSpendNano < amountToUserNano) {
          await this.handleBlockedLiquidity({
            payout: lockedPayout,
            amountNano: amountToUserNano.toString(),
            hotBalanceNano: hotBalanceNano.toString(),
            reservedNano,
          });
          return;
        }

        if (this.config.payoutDryRun) {
          await this.transferRepository.update(transfer.id, {
            status: TonTransferStatus.SIMULATED,
            observedAt: new Date(),
            errorMessage: null,
          });
          ensureTransitionAllowed(
            lockedPayout.status,
            TransactionStatus.COMPLETED,
          );
          await this.transactionRepository.update(lockedPayout.id, {
            status: TransactionStatus.COMPLETED,
            confirmedAt: new Date(),
            completedAt: new Date(),
          });
          await this.ledgerService.updateFeeTransactionsStatus(
            lockedPayout.id,
            TransactionStatus.COMPLETED,
          );
          this.logger.log(
            `Payout simulated`,
            JSON.stringify({
              payoutId: lockedPayout.id,
              userId: lockedPayout.userId,
              idempotencyKey: lockedPayout.idempotencyKey,
              tonTransferId: transfer.id,
              amountNano: lockedPayout.amountNano,
              destination: lockedPayout.destinationAddress,
            }),
          );
          return;
        }

        try {
          const { txHash } = await this.tonHotWalletService.sendTon({
            toAddress: lockedPayout.destinationAddress ?? '',
            amountNano: amountToUserNano,
          });
          if (!txHash) {
            throw new Error('Missing tx hash after broadcast');
          }
          await this.transferRepository.update(transfer.id, {
            status: TonTransferStatus.BROADCASTED,
            txHash,
            errorMessage: null,
          });
          await this.transactionRepository.update(lockedPayout.id, {
            externalTxHash: txHash,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.transferRepository.update(transfer.id, {
            status: TonTransferStatus.FAILED,
            errorMessage: message,
          });
          ensureTransitionAllowed(
            lockedPayout.status,
            TransactionStatus.FAILED,
          );
          await this.transactionRepository.update(lockedPayout.id, {
            status: TransactionStatus.FAILED,
            errorCode: 'PAYOUT_FAILED',
            errorMessage: message,
          });
          await this.ledgerService.updateFeeTransactionsStatus(
            lockedPayout.id,
            TransactionStatus.CANCELED,
          );
          this.logger.warn(
            `Payout broadcast failed`,
            JSON.stringify({
              payoutId: lockedPayout.id,
              userId: lockedPayout.userId,
              idempotencyKey: lockedPayout.idempotencyKey,
              tonTransferId: transfer.id,
              error: message,
            }),
          );
          return;
        }

        ensureTransitionAllowed(
          lockedPayout.status,
          TransactionStatus.AWAITING_CONFIRMATION,
        );
        await this.transactionRepository.update(lockedPayout.id, {
          status: TransactionStatus.AWAITING_CONFIRMATION,
          errorCode: null,
          errorMessage: null,
        });
        this.logger.log(
          `Payout broadcasted`,
          JSON.stringify({
            payoutId: lockedPayout.id,
            userId: lockedPayout.userId,
            idempotencyKey: lockedPayout.idempotencyKey,
            tonTransferId: transfer.id,
            amountNano:
              lockedPayout.amountToUserNano ?? lockedPayout.amountNano,
            destination: lockedPayout.destinationAddress,
          }),
        );
      },
    );
  }

  private async handleBlockedLiquidity(options: {
    payout: TransactionEntity;
    amountNano: string;
    hotBalanceNano: string;
    reservedNano: string;
  }): Promise<void> {
    const { payout } = options;
    const now = new Date();
    const result = await this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(TransactionEntity);
      const transferRepo = manager.getRepository(TonTransferEntity);
      const locked = await txRepo.findOne({
        where: { id: payout.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!locked) {
        return null;
      }

      const alreadyBlocked =
        locked.errorCode === 'BLOCKED_LIQUIDITY' &&
        [TransactionStatus.CANCELED, TransactionStatus.FAILED].includes(
          locked.status,
        );

      if (!alreadyBlocked) {
        if (
          ![
            TransactionStatus.PENDING,
            TransactionStatus.BLOCKED_LIQUIDITY,
          ].includes(locked.status)
        ) {
          return { payout: locked, shouldNotify: false };
        }

        ensureTransitionAllowed(locked.status, TransactionStatus.CANCELED);
        await txRepo.update(locked.id, {
          status: TransactionStatus.CANCELED,
          errorCode: 'BLOCKED_LIQUIDITY',
          errorMessage: 'Insufficient hot wallet liquidity',
          completedAt: now,
        });
        await this.ledgerService.updateFeeTransactionsStatus(
          locked.id,
          TransactionStatus.CANCELED,
          manager,
        );

        if (locked.tonTransferId) {
          await transferRepo.update(
            {
              id: locked.tonTransferId,
              status: In([
                TonTransferStatus.CREATED,
                TonTransferStatus.FAILED,
                TonTransferStatus.SIMULATED,
              ]),
            },
            {
              status: TonTransferStatus.FAILED,
              errorMessage: 'Insufficient hot wallet liquidity',
            },
          );
        }

        locked.status = TransactionStatus.CANCELED;
        locked.errorCode = 'BLOCKED_LIQUIDITY';
        locked.errorMessage = 'Insufficient hot wallet liquidity';
      }

      return { payout: locked, shouldNotify: true };
    });

    this.logger.warn(
      `Payout blocked by liquidity`,
      JSON.stringify({
        event: 'payout_blocked_liquidity',
        payoutId: payout.id,
        userId: payout.userId,
        amountNano: options.amountNano,
        currency: payout.currency,
        hotBalanceNano: options.hotBalanceNano,
        reservedNano: options.reservedNano,
      }),
    );

    if (!result?.shouldNotify) {
      return;
    }

    const user = await this.userRepository.findOne({
      where: { id: payout.userId },
    });

    await this.sendAdminBlockedLiquidityAlert(result.payout, user, options);
    await this.sendUserBlockedLiquidityMessage(result.payout, user);
  }

  private async sendAdminBlockedLiquidityAlert(
    payout: TransactionEntity,
    user: User | null,
    options: { amountNano: string },
  ): Promise<void> {
    const chatId = this.configService.get<string>('ADMIN_ALERTS_CHAT_ID');
    if (!chatId) {
      this.logger.warn(`Admin alerts chat ID missing for blocked liquidity`);
      return;
    }

    const idempotencyKey = `adminAlert:payoutBlockedLiquidity:${payout.id}`;
    const reserved = await this.reserveNotification(idempotencyKey);
    if (!reserved) {
      return;
    }

    const userReference = user?.telegramId
      ? `tg://user?id=${user.telegramId}`
      : payout.userId;

    const timestamp = new Date().toISOString();
    const amountTon = formatTon(options.amountNano);
    const profileUrl = this.buildUserProfileUrl(payout.userId);

    const lines = [
      'Event: Payout blocked: insufficient liquidity',
      `User: ${userReference}`,
      `Payout request id: ${payout.id}`,
      `Amount requested (TON): ${amountTon}`,
      `Amount nano: ${options.amountNano}`,
      `Currency: ${payout.currency}`,
      `Timestamp: ${timestamp}`,
    ];

    if (profileUrl) {
      lines.push(`User profile: ${profileUrl}`);
    }

    const threadId = this.getAdminAlertsThreadId();
    await this.telegramSenderService.sendMessage(chatId, lines.join('\n'), {
      threadId,
    });
  }

  private async sendUserBlockedLiquidityMessage(
    payout: TransactionEntity,
    user: User | null,
  ): Promise<void> {
    if (!user?.telegramId) {
      return;
    }

    const idempotencyKey = `userMsg:payoutBlockedLiquidity:${payout.id}`;
    const reserved = await this.reserveNotification(idempotencyKey);
    if (!reserved) {
      return;
    }

    const supportUrl = this.getSupportUrl();
    if (!supportUrl) {
      this.logger.warn(
        `Support URL missing for payout blocked liquidity`,
        JSON.stringify({
          event: 'payout_blocked_liquidity',
          payoutId: payout.id,
          userId: payout.userId,
        }),
      );
    }

    await this.telegramMessengerService.sendText(
      user.telegramId,
      'telegram.payout.blocked_liquidity.user_message',
    );

    if (supportUrl) {
      await this.telegramMessengerService.sendText(
        user.telegramId,
        'telegram.payout.blocked_liquidity.support_cta',
        { supportUrl },
      );
    }
  }

  private async reserveNotification(idempotencyKey: string): Promise<boolean> {
    try {
      await this.notificationLogRepository.insert({ idempotencyKey });
      return true;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        typeof (error as { code?: string }).code === 'string'
      ) {
        return false;
      }
      throw error;
    }
  }

  private getSupportUrl(): string | null {
    return (
      this.configService.get<string>('SUPPORT_URL') ??
      this.configService.get<string>('SUPPORT_TELEGRAM_URL') ??
      null
    );
  }

  private getAdminAlertsThreadId(): number | null {
    const raw = this.configService.get<string>('ADMIN_ALERTS_THREAD_ID');
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  private buildUserProfileUrl(userId: string): string | null {
    const baseUrl = this.configService.get<string>('APP_PUBLIC_URL');
    if (!baseUrl) {
      return null;
    }
    try {
      const url = new URL(baseUrl);
      const basePath = url.pathname.endsWith('/')
        ? url.pathname.slice(0, -1)
        : url.pathname;
      url.pathname = `${basePath}/users/${userId}`;
      return url.toString();
    } catch (error) {
      return null;
    }
  }

  private async failPayout(
    txRepo: Repository<TransactionEntity>,
    payout: TransactionEntity,
    reason: string,
  ): Promise<void> {
    ensureTransitionAllowed(payout.status, TransactionStatus.FAILED);
    await txRepo.update(payout.id, {
      status: TransactionStatus.FAILED,
      errorCode: 'PAYOUT_INVALID',
      errorMessage: reason,
    });
    await this.ledgerService.updateFeeTransactionsStatus(
      payout.id,
      TransactionStatus.CANCELED,
    );
    this.logger.warn(
      `Payout failed`,
      JSON.stringify({
        payoutId: payout.id,
        userId: payout.userId,
        idempotencyKey: payout.idempotencyKey,
        reason,
      }),
    );
  }
}

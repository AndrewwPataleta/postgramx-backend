import type { QueryDeepPartialEntity } from '../../core/typeorm.types';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { DealEntity } from '../deals/entities/deal.entity';
import { DealEscrowEntity } from '../deals/entities/deal-escrow.entity';
import { EscrowWalletEntity } from './entities/escrow-wallet.entity';
import { EscrowWalletKeyEntity } from './entities/escrow-wallet-key.entity';
import { EscrowStatus } from '../../common/constants/deals/deal-escrow-status.constants';
import { DealStage } from '../../common/constants/deals/deal-stage.constants';
import { mapStageToDealStatus } from '../deals/state/deal-status.mapper';
import { DealsNotificationsService } from '../deals/deals-notifications.service';
import { TonTransferEntity } from './entities/ton-transfer.entity';
import { TransactionEntity } from './entities/transaction.entity';
import { TransactionStatus } from '../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../common/constants/payments/transaction-type.constants';
import { TransactionDirection } from '../../common/constants/payments/transaction-direction.constants';
import { TonCenterClient } from './ton/toncenter.client';
import { addNano, gteNano, subNano } from './utils/bigint';
import { CurrencyCode } from '../../common/constants/currency/currency.constants';
import { KeyEncryptionService } from './wallets/crypto/key-encryption.service';
import { TonWalletDeploymentService } from './ton/ton-wallet-deployment.service';
import { TonTransferStatus } from '../../common/constants/payments/ton-transfer-status.constants';
import { TonTransferType } from '../../common/constants/payments/ton-transfer-type.constants';
import { TonHotWalletService } from './ton/ton-hot-wallet.service';
import { LedgerService } from './ledger/ledger.service';
import { ensureTransitionAllowed } from './payouts/payout-state';
import { FeesConfigService } from './fees/fees-config.service';
import { Address } from '@ton/ton';
import { TelegramMessengerService } from '../telegram/telegram-messenger.service';
import { User } from '../auth/entities/user.entity';
import { createHash } from 'crypto';
import {
  ADVISORY_LOCKS,
  CRON,
  ENV,
  IDEMPOTENCY_PREFIX,
  PAYMENT_DESCRIPTIONS,
  PAYMENT_ERROR_MESSAGES,
  PAYMENT_ERRORS,
  PAYMENT_LOG_EVENTS,
  TELEGRAM_I18N_KEYS,
  TON_DEFAULTS,
  TON_FINALIZE_OUTGOING_STATUSES,
  TON_MONITORED_OUTGOING_STATUSES,
  TON_PENDING_TRANSFER_TYPES,
  TRACKED_ESCROW_STATUSES,
} from '../../common/constants';
import { getEnvBigInt, getEnvNumber } from '../../common/utils/env';
import { buildIdempotencyKey } from '../../common/utils/idempotency.util';

@Injectable()
export class TonPaymentWatcher {
  private readonly logger = new Logger(`${CurrencyCode.TON}-WATCHER`);

  constructor(
    private readonly ton: TonCenterClient,
    private readonly dataSource: DataSource,
    private readonly dealsNotificationsService: DealsNotificationsService,
    @InjectRepository(TransactionEntity)
    private readonly txRepo: Repository<TransactionEntity>,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepo: Repository<DealEscrowEntity>,
    @InjectRepository(DealEntity)
    private readonly dealRepo: Repository<DealEntity>,
    @InjectRepository(EscrowWalletEntity)
    private readonly escrowWalletRepo: Repository<EscrowWalletEntity>,
    @InjectRepository(EscrowWalletKeyEntity)
    private readonly escrowWalletKeyRepo: Repository<EscrowWalletKeyEntity>,
    private readonly keyEncryptionService: KeyEncryptionService,
    private readonly tonWalletDeploymentService: TonWalletDeploymentService,
    private readonly tonHotWalletService: TonHotWalletService,
    private readonly ledgerService: LedgerService,
    private readonly feesConfigService: FeesConfigService,
    private readonly telegramMessengerService: TelegramMessengerService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  @Cron(CRON.TON_INCOMING_WATCHER)
  async monitorIncomingPayments() {
    const lockAcquired = await this.acquireAdvisoryLock(
      ADVISORY_LOCKS.TON_INCOMING_PAYMENTS,
    );
    if (!lockAcquired) {
      return;
    }
    try {
      const escrows = await this.escrowRepo.find({
        where: {
          status: In([...TRACKED_ESCROW_STATUSES]),
        },
        take: TON_DEFAULTS.OUTGOING_TX_LIMIT_MIN,
      });

      if (!escrows.length) {
        return;
      }

      for (const escrow of escrows) {
        if (!escrow.depositAddress) {
          continue;
        }

        const storedCursor =
          escrow.lastSeenLt && escrow.lastSeenTxHash
            ? { lt: escrow.lastSeenLt, hash: escrow.lastSeenTxHash }
            : null;
        const { transactions, newestCursor } =
          await this.fetchIncomingTransactions(
            escrow.depositAddress,
            storedCursor,
          );

        if (!transactions.length) {
          continue;
        }

        const normalizedDepositAddress = this.normalizeAddress(
          escrow.depositAddress,
        );
        for (const entry of transactions) {
          const inMsg = (entry as any).in_msg;
          if (!inMsg?.value) {
            continue;
          }
          if (!inMsg?.destination) {
            continue;
          }
          const isAborted = Boolean((entry as any)?.aborted);
          const isBounced = Boolean(
            inMsg?.bounced ?? inMsg?.bounce ?? (entry as any)?.bounced,
          );
          if (isAborted || isBounced) {
            continue;
          }

          const normalizedDestination = this.normalizeAddress(
            String(inMsg.destination),
          );
          if (normalizedDestination !== normalizedDepositAddress) {
            continue;
          }

          const amountNano = String(inMsg.value);
          const txHashRaw =
            (entry as any).transaction_id?.hash ?? (entry as any).hash;
          if (!txHashRaw) {
            continue;
          }
          const txHash = String(txHashRaw).toLowerCase();
          const observedAt = new Date(Number((entry as any).utime) * 1000);
          await this.processTransfer(escrow, {
            txHash,
            amountNano,
            fromAddress: inMsg.source ?? 'unknown',
            toAddress: escrow.depositAddress,
            observedAt,
            raw: this.buildMinimalRaw(entry, {
              txHash,
              direction: 'in',
            }),
          });
        }

        if (newestCursor) {
          await this.escrowRepo.update(escrow.id, {
            lastSeenLt: newestCursor.lt,
            lastSeenTxHash: newestCursor.hash,
          });
        }
      }
    } catch (err) {
      this.logger.error(
        'Watcher error',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      await this.releaseAdvisoryLock(ADVISORY_LOCKS.TON_INCOMING_PAYMENTS);
    }
  }

  @Cron(CRON.TON_OUTGOING_WATCHER)
  async monitorOutgoingTransfers() {
    const lockAcquired = await this.acquireAdvisoryLock(
      ADVISORY_LOCKS.TON_OUTGOING_TRANSFERS,
    );
    if (!lockAcquired) {
      return;
    }
    try {
      const hotWalletAddress = await this.tonHotWalletService.getAddress();
      const pendingTransfersCount = await this.dataSource
        .getRepository(TonTransferEntity)
        .createQueryBuilder('transfer')
        .where('transfer.type IN (:...types)', {
          types: [...TON_PENDING_TRANSFER_TYPES],
        })
        .andWhere('transfer.status = :status', {
          status: TonTransferStatus.BROADCASTED,
        })
        .getCount();
      const limit = Math.min(
        TON_DEFAULTS.OUTGOING_TX_LIMIT_MAX,
        Math.max(
          TON_DEFAULTS.OUTGOING_TX_LIMIT_MIN,
          pendingTransfersCount * TON_DEFAULTS.OUTGOING_TX_LIMIT_MULTIPLIER,
        ),
      );
      const transactions = await this.ton.getTransactions(
        hotWalletAddress,
        limit,
      );

      for (const entry of transactions) {
        const outMsgs = (entry as any).out_msgs ?? [];
        if (!Array.isArray(outMsgs) || outMsgs.length === 0) {
          continue;
        }

        const txHashRaw =
          (entry as any).transaction_id?.hash ?? (entry as any).hash;
        if (!txHashRaw) {
          continue;
        }
        const txHash = String(txHashRaw).toLowerCase();
        const observedAt = new Date(Number((entry as any).utime) * 1000);

        for (const msg of outMsgs) {
          if (!msg?.destination || !msg?.value) {
            continue;
          }
          await this.processOutgoingTransfer({
            txHash,
            amountNano: String(msg.value),
            toAddress: String(msg.destination),
            fromAddress: hotWalletAddress,
            observedAt,
            raw: this.buildMinimalRaw(entry, {
              txHash,
              direction: 'out',
              outMsg: msg,
            }),
          });
        }
      }

      await this.finalizeOutgoingTransfers();
    } catch (err) {
      this.logger.error(
        'Outgoing watcher error',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      await this.releaseAdvisoryLock(ADVISORY_LOCKS.TON_OUTGOING_TRANSFERS);
    }
  }

  private async fetchIncomingTransactions(
    address: string,
    stopCursor: { lt: string; hash: string } | null,
  ): Promise<{
    transactions: any[];
    newestCursor: { lt: string; hash: string } | null;
  }> {
    const limit = TON_DEFAULTS.INCOMING_TX_LIMIT;
    const transactions: any[] = [];
    let cursor: { lt: string; hash: string } | null = null;
    let newestCursor: { lt: string; hash: string } | null = null;
    let reachedCursor = false;

    do {
      const batch = await this.ton.getTransactions(
        address,
        limit,
        cursor ?? undefined,
      );
      if (!batch.length) {
        break;
      }

      for (const entry of batch) {
        const entryCursor = this.getTransactionCursor(entry);
        if (!newestCursor && entryCursor) {
          newestCursor = entryCursor;
        }
        if (
          stopCursor &&
          entryCursor &&
          entryCursor.lt === stopCursor.lt &&
          entryCursor.hash === stopCursor.hash
        ) {
          reachedCursor = true;
          break;
        }
        transactions.push(entry);
      }

      if (!stopCursor || reachedCursor || batch.length < limit) {
        break;
      }

      const lastEntry = batch[batch.length - 1];
      const lastCursor = this.getTransactionCursor(lastEntry);
      if (!lastCursor) {
        break;
      }
      cursor = lastCursor;
    } while (true);

    return { transactions, newestCursor };
  }

  private getTransactionCursor(
    entry: Record<string, any>,
  ): { lt: string; hash: string } | null {
    const txHash = entry?.transaction_id?.hash ?? entry?.hash ?? entry?.txHash;
    const lt =
      entry?.transaction_id?.lt ?? entry?.lt ?? entry?.transaction_id?.lt;
    if (!txHash || !lt) {
      return null;
    }
    return { lt: String(lt), hash: String(txHash).toLowerCase() };
  }

  private buildMinimalRaw(
    entry: Record<string, any>,
    options: {
      txHash: string;
      direction: 'in' | 'out';
      outMsg?: Record<string, any>;
    },
  ): Record<string, unknown> {
    const inMsg = entry?.in_msg;
    const outMsgs = Array.isArray(entry?.out_msgs) ? entry.out_msgs : [];
    const normalizedOutMsgs = options.outMsg
      ? [options.outMsg]
      : outMsgs.slice(0, 5);
    return {
      txHash: options.txHash,
      utime: entry?.utime ?? null,
      lt: entry?.transaction_id?.lt ?? entry?.lt ?? null,
      aborted: entry?.aborted ?? null,
      direction: options.direction,
      in_msg: inMsg
        ? {
            source: inMsg.source ?? null,
            destination: inMsg.destination ?? null,
            value: inMsg.value ?? null,
            bounced: inMsg.bounced ?? inMsg.bounce ?? null,
          }
        : null,
      out_msgs: normalizedOutMsgs.map((msg: any) => ({
        source: msg?.source ?? null,
        destination: msg?.destination ?? null,
        value: msg?.value ?? null,
        bounced: msg?.bounced ?? msg?.bounce ?? null,
      })),
    };
  }

  private async acquireAdvisoryLock(key: string): Promise<boolean> {
    const [key1, key2] = this.buildAdvisoryLockKey(key);
    const result = await this.dataSource.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [key1, key2],
    );
    return Boolean(result?.[0]?.locked);
  }

  private async releaseAdvisoryLock(key: string): Promise<void> {
    const [key1, key2] = this.buildAdvisoryLockKey(key);
    await this.dataSource.query('SELECT pg_advisory_unlock($1, $2)', [
      key1,
      key2,
    ]);
  }

  private buildAdvisoryLockKey(key: string): [number, number] {
    const hash = createHash('sha256').update(key).digest();
    const part1 = hash.readInt32BE(0);
    const part2 = hash.readInt32BE(4);
    return [part1, part2];
  }

  private async processTransfer(
    escrow: DealEscrowEntity,
    transfer: {
      txHash: string;
      amountNano: string;
      fromAddress: string;
      toAddress: string;
      observedAt: Date;
      raw: Record<string, unknown>;
    },
  ): Promise<void> {
    const shouldDeployWallet = await this.dataSource.transaction(
      async (manager) => {
        const transferRepo = manager.getRepository(TonTransferEntity);
        const escrowRepo = manager.getRepository(DealEscrowEntity);
        const dealRepo = manager.getRepository(DealEntity);
        const txRepo = manager.getRepository(TransactionEntity);

        const lockedEscrow = await escrowRepo.findOne({
          where: { id: escrow.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!lockedEscrow) {
          return false;
        }

        const deal = await dealRepo.findOne({
          where: { id: lockedEscrow.dealId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!deal) {
          return false;
        }

        const deadline = lockedEscrow.paymentDeadlineAt;
        const isLate = Boolean(deadline && transfer.observedAt > deadline);
        if (isLate) {
          await this.dealsNotificationsService.notifyAdvertiser(
            deal,
            TELEGRAM_I18N_KEYS.PAYMENT_EXPIRED,
          );
        }

        const existingTx = await txRepo.findOne({
          where: {
            externalTxHash: transfer.txHash,
            currency: lockedEscrow.currency,
          },
        });
        if (existingTx) {
          return false;
        }

        const currentPaid = lockedEscrow.paidNano ?? '0';
        const nextPaid = addNano(currentPaid, transfer.amountNano);
        const expected = lockedEscrow.amountNano;

        const isConfirmed = gteNano(nextPaid, expected);
        const remaining = isConfirmed ? '0' : subNano(expected, nextPaid);

        const transaction = await txRepo.save(
          txRepo.create({
            userId: deal.advertiserUserId,
            type: TransactionType.DEPOSIT,
            direction: TransactionDirection.IN,
            status: TransactionStatus.COMPLETED,
            amountNano: transfer.amountNano,
            currency: lockedEscrow.currency,
            dealId: deal.id,
            escrowId: lockedEscrow.id,
            channelId: deal.channelId,
            depositAddress: lockedEscrow.depositAddress,
            externalTxHash: transfer.txHash,
            idempotencyKey: buildIdempotencyKey(
              IDEMPOTENCY_PREFIX.DEPOSIT,
              transfer.txHash,
            ),
            description: PAYMENT_DESCRIPTIONS.DEPOSIT_RECEIVED,
            confirmedAt: new Date(),
            completedAt: new Date(),
          }),
        );

        await transferRepo
          .createQueryBuilder()
          .insert()
          .values({
            transactionId: transaction.id,
            dealId: deal.id,
            network: CurrencyCode.TON,
            type: TonTransferType.DEPOSIT,
            status: TonTransferStatus.COMPLETED,
            toAddress: transfer.toAddress,
            fromAddress: transfer.fromAddress,
            amountNano: transfer.amountNano,
            txHash: transfer.txHash,
            observedAt: transfer.observedAt,
            raw: isLate ? { ...transfer.raw, late: true } : transfer.raw,
            idempotencyKey: buildIdempotencyKey(
              IDEMPOTENCY_PREFIX.DEPOSIT,
              transfer.txHash,
            ),
            errorMessage: null,
          } as QueryDeepPartialEntity<TonTransferEntity>)
          .onConflict(
            '( "txHash", "network" ) WHERE "txHash" IS NOT NULL DO NOTHING',
          )
          .execute();

        await escrowRepo.update(lockedEscrow.id, {
          paidNano: nextPaid,
          status: isConfirmed
            ? EscrowStatus.PAID_HELD
            : EscrowStatus.PAID_PARTIAL,
          paidAt: lockedEscrow.paidAt ?? new Date(),
          heldAt: isConfirmed ? new Date() : lockedEscrow.heldAt,
        });

        this.logger.log(
          `[TON-WATCHER] ${JSON.stringify({
            event: PAYMENT_LOG_EVENTS.INCOMING_PAYMENT,
            dealId: deal.id,
            escrowId: lockedEscrow.id,
            amountNano: transfer.amountNano,
            paidNano: nextPaid,
            status: isConfirmed
              ? EscrowStatus.PAID_HELD
              : EscrowStatus.PAID_PARTIAL,
          })}`,
        );

        await dealRepo.update(deal.id, {
          stage: isConfirmed
            ? DealStage.POST_SCHEDULED
            : DealStage.PAYMENT_PARTIALLY_PAID,
          status: mapStageToDealStatus(
            isConfirmed
              ? DealStage.POST_SCHEDULED
              : DealStage.PAYMENT_PARTIALLY_PAID,
          ),
        });

        if (isConfirmed) {
          const updatedDeal = await dealRepo.findOne({
            where: { id: deal.id },
          });
          if (updatedDeal) {
            await this.dealsNotificationsService.notifyPaymentConfirmed(
              updatedDeal,
            );
          }
          return true;
        }

        const updatedDeal = await dealRepo.findOne({
          where: { id: deal.id },
        });
        if (updatedDeal) {
          await this.dealsNotificationsService.notifyAdvertiserPartialPayment(
            updatedDeal,
            nextPaid,
            remaining,
          );
        }
        return false;
      },
    );

    if (!shouldDeployWallet || !escrow.depositWalletId) {
      return;
    }

    const deploymentOptions = await this.getDeploymentOptions(
      escrow.depositWalletId,
    );
    if (!deploymentOptions) {
      return;
    }

    try {
      const deployed =
        await this.tonWalletDeploymentService.ensureDeployed(deploymentOptions);
      if (deployed) {
        await this.reconcileDeploymentBalance(
          escrow.id,
          deploymentOptions.address,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to deploy escrow wallet ${deploymentOptions.address}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async processOutgoingTransfer(transfer: {
    txHash: string;
    amountNano: string;
    toAddress: string;
    fromAddress: string;
    observedAt: Date;
    raw: Record<string, unknown>;
  }): Promise<void> {
    let payoutUserId: string | null = null;
    await this.dataSource.transaction(async (manager) => {
      const transferRepo = manager.getRepository(TonTransferEntity);
      const txRepo = manager.getRepository(TransactionEntity);

      let tonTransfer: TonTransferEntity | null = null;
      if (transfer.txHash) {
        tonTransfer = await transferRepo.findOne({
          where: {
            txHash: transfer.txHash,
            network: CurrencyCode.TON,
          },
        });
      }

      if (!tonTransfer) {
        const observedAt = transfer.observedAt.getTime();
        const windowStart = new Date(
          observedAt - TON_DEFAULTS.OUTGOING_MATCH_WINDOW_MS,
        );
        const windowEnd = new Date(
          observedAt + TON_DEFAULTS.OUTGOING_MATCH_WINDOW_MS,
        );
        const candidateTransfers = await transferRepo
          .createQueryBuilder('transfer')
          .where('transfer.type IN (:...types)', {
            types: [...TON_PENDING_TRANSFER_TYPES],
          })
          .andWhere('transfer.status IN (:...statuses)', {
            statuses: [...TON_MONITORED_OUTGOING_STATUSES],
          })
          .andWhere('transfer.network = :network', {
            network: CurrencyCode.TON,
          })
          .andWhere('transfer.createdAt BETWEEN :start AND :end', {
            start: windowStart,
            end: windowEnd,
          })
          .getMany();

        const normalizedToAddress = this.normalizeAddress(transfer.toAddress);
        const chainAmount = BigInt(transfer.amountNano);
        const toleranceNano = getEnvBigInt(
          ENV.TON_OUTGOING_MATCH_TOLERANCE_NANO,
          TON_DEFAULTS.OUTGOING_MATCH_TOLERANCE_NANO,
        );
        const matches = candidateTransfers.filter((candidate) => {
          if (!candidate.toAddress) {
            return false;
          }
          const candidateTo = this.normalizeAddress(candidate.toAddress);
          if (candidateTo !== normalizedToAddress) {
            return false;
          }
          const candidateAmount = BigInt(candidate.amountNano ?? '0');
          const diff =
            candidateAmount > chainAmount
              ? candidateAmount - chainAmount
              : chainAmount - candidateAmount;
          return diff <= toleranceNano;
        });

        if (matches.length > 1) {
          this.logger.warn(
            `[TON-WATCHER] ${JSON.stringify({
              event: PAYMENT_LOG_EVENTS.AMBIGUOUS_OUTGOING_MATCH,
              txHash: transfer.txHash,
              toAddress: transfer.toAddress,
              amountNano: transfer.amountNano,
              matches: matches.map((match) => match.id),
            })}`,
          );
          return;
        }

        if (matches.length === 0) {
          return;
        }

        tonTransfer = matches[0];
      }

      if (
        ![TonTransferStatus.BROADCASTED, TonTransferStatus.CREATED].includes(
          tonTransfer.status,
        )
      ) {
        return;
      }

      await transferRepo.update(tonTransfer.id, {
        status: TonTransferStatus.CONFIRMED,
        txHash: tonTransfer.txHash ?? transfer.txHash,
        observedAt: transfer.observedAt,
        raw: transfer.raw,
        errorMessage: null,
      } as QueryDeepPartialEntity<TonTransferEntity>);

      if (tonTransfer.transactionId) {
        const transaction = await txRepo.findOne({
          where: { id: tonTransfer.transactionId },
        });
        if (transaction) {
          try {
            ensureTransitionAllowed(
              transaction.status,
              TransactionStatus.CONFIRMED,
            );
          } catch (error) {
            this.logger.warn(
              `Skip invalid payout transition`,
              JSON.stringify({
                transactionId: transaction.id,
                from: transaction.status,
                to: TransactionStatus.CONFIRMED,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            return;
          }
          await txRepo.update(tonTransfer.transactionId, {
            status: TransactionStatus.CONFIRMED,
            confirmedAt: new Date(),
            externalTxHash: tonTransfer.txHash ?? transfer.txHash,
          });
          if (
            transaction.type === TransactionType.PAYOUT &&
            transaction.direction === TransactionDirection.OUT
          ) {
            payoutUserId = transaction.userId;
          }
        }
      }

      this.logger.log(
        `[TON-WATCHER] ${JSON.stringify({
          event: PAYMENT_LOG_EVENTS.OUTGOING_CONFIRMED,
          tonTransferId: tonTransfer.id,
          transactionId: tonTransfer.transactionId,
          txHash: tonTransfer.txHash ?? transfer.txHash,
          idempotencyKey: tonTransfer.idempotencyKey,
        })}`,
      );
    });
    if (payoutUserId) {
      await this.notifyPayoutConfirmed(payoutUserId);
    }
  }

  private normalizeAddress(address: string): string {
    try {
      return Address.parse(address).toRawString();
    } catch (error) {
      return address.trim().toLowerCase();
    }
  }

  private async notifyPayoutConfirmed(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!user?.telegramId) {
      return;
    }
    await this.telegramMessengerService.sendText(
      user.telegramId,
      TELEGRAM_I18N_KEYS.PAYMENT_PAYOUT_CONFIRMED,
    );
  }

  private async finalizeOutgoingTransfers(): Promise<void> {
    const confirmationSeconds = getEnvNumber(
      ENV.TON_FINALITY_SECONDS,
      TON_DEFAULTS.FINALITY_SECONDS,
    );
    const timeoutSeconds = getEnvNumber(
      ENV.TON_TRANSFER_TIMEOUT_SECONDS,
      TON_DEFAULTS.TRANSFER_TIMEOUT_SECONDS,
    );
    const now = Date.now();

    const pendingTransfers = await this.dataSource
      .getRepository(TonTransferEntity)
      .createQueryBuilder('transfer')
      .where('transfer.type IN (:...types)', {
        types: [...TON_PENDING_TRANSFER_TYPES],
      })
      .andWhere('transfer.status IN (:...statuses)', {
        statuses: [...TON_FINALIZE_OUTGOING_STATUSES],
      })
      .getMany();

    for (const transfer of pendingTransfers) {
      if (transfer.status === TonTransferStatus.CONFIRMED) {
        const observedAt = transfer.observedAt?.getTime();
        if (observedAt && now - observedAt >= confirmationSeconds * 1000) {
          let feeTransferContext: {
            payoutId: string;
            currency: CurrencyCode;
            amountNano: bigint;
          } | null = null;
          await this.dataSource.transaction(async (manager) => {
            const transferRepo = manager.getRepository(TonTransferEntity);
            const txRepo = manager.getRepository(TransactionEntity);

            await transferRepo.update(transfer.id, {
              status: TonTransferStatus.COMPLETED,
              errorMessage: null,
            });

            if (transfer.transactionId) {
              const transaction = await txRepo.findOne({
                where: { id: transfer.transactionId },
              });
              if (transaction) {
                try {
                  ensureTransitionAllowed(
                    transaction.status,
                    TransactionStatus.COMPLETED,
                  );
                } catch (error) {
                  this.logger.warn(
                    `Skip invalid payout transition`,
                    JSON.stringify({
                      transactionId: transaction.id,
                      from: transaction.status,
                      to: TransactionStatus.COMPLETED,
                      error:
                        error instanceof Error ? error.message : String(error),
                    }),
                  );
                  return;
                }
                await txRepo.update(transfer.transactionId, {
                  status: TransactionStatus.COMPLETED,
                  completedAt: new Date(),
                });
                if (
                  transaction.type === TransactionType.PAYOUT &&
                  transaction.direction === TransactionDirection.OUT
                ) {
                  await this.ledgerService.updateFeeTransactionsStatus(
                    transfer.transactionId,
                    TransactionStatus.COMPLETED,
                    manager,
                  );
                  const serviceFee = BigInt(transaction.serviceFeeNano ?? '0');
                  const networkFee = BigInt(transaction.networkFeeNano ?? '0');
                  const totalFee = serviceFee + networkFee;
                  if (totalFee > 0n) {
                    feeTransferContext = {
                      payoutId: transaction.id,
                      currency: transaction.currency,
                      amountNano: totalFee,
                    };
                  }
                }
              }
            }
          });

          this.logger.log(
            `[TON-WATCHER] ${JSON.stringify({
              event: PAYMENT_LOG_EVENTS.OUTGOING_COMPLETED,
              tonTransferId: transfer.id,
              transactionId: transfer.transactionId,
              txHash: transfer.txHash,
              idempotencyKey: transfer.idempotencyKey,
            })}`,
          );
          if (feeTransferContext) {
            await this.sendFeeRevenueTransfer(feeTransferContext);
          }
        }
        continue;
      }

      const createdAt = transfer.createdAt.getTime();
      if (now - createdAt >= timeoutSeconds * 1000) {
        await this.dataSource.transaction(async (manager) => {
          const transferRepo = manager.getRepository(TonTransferEntity);
          const txRepo = manager.getRepository(TransactionEntity);

          await transferRepo.update(transfer.id, {
            status: TonTransferStatus.FAILED,
            errorMessage: PAYMENT_ERROR_MESSAGES.TRANSFER_TIMEOUT,
          });

          if (transfer.transactionId) {
            const transaction = await txRepo.findOne({
              where: { id: transfer.transactionId },
            });
            if (transaction) {
              try {
                ensureTransitionAllowed(
                  transaction.status,
                  TransactionStatus.FAILED,
                );
              } catch (error) {
                this.logger.warn(
                  `Skip invalid payout transition`,
                  JSON.stringify({
                    transactionId: transaction.id,
                    from: transaction.status,
                    to: TransactionStatus.FAILED,
                    error:
                      error instanceof Error ? error.message : String(error),
                  }),
                );
                return;
              }
              await txRepo.update(transfer.transactionId, {
                status: TransactionStatus.FAILED,
                errorCode: PAYMENT_ERRORS.TRANSFER_TIMEOUT,
                errorMessage: PAYMENT_ERROR_MESSAGES.TRANSFER_TIMEOUT,
              });
              if (
                transaction.type === TransactionType.PAYOUT &&
                transaction.direction === TransactionDirection.OUT
              ) {
                await this.ledgerService.updateFeeTransactionsStatus(
                  transfer.transactionId,
                  TransactionStatus.CANCELED,
                  manager,
                );
              }
            }
          }
        });

        this.logger.warn(
          `[TON-WATCHER] ${JSON.stringify({
            event: PAYMENT_LOG_EVENTS.OUTGOING_FAILED,
            tonTransferId: transfer.id,
            transactionId: transfer.transactionId,
            reason: 'timeout',
            txHash: transfer.txHash,
            idempotencyKey: transfer.idempotencyKey,
          })}`,
        );
      }
    }
  }

  private async sendFeeRevenueTransfer(options: {
    payoutId: string;
    currency: CurrencyCode;
    amountNano: bigint;
  }): Promise<void> {
    const config = await this.feesConfigService.getConfig();
    if (!config.feesEnabled) {
      return;
    }
    if (config.feeRevenueStrategy !== 'LEDGER_AND_TRANSFER') {
      return;
    }
    if (!config.feeRevenueAddress) {
      this.logger.warn(
        `[TON-WATCHER] Fee transfer skipped: FEE_REVENUE_ADDRESS missing`,
      );
      return;
    }
    if (options.amountNano <= 0n) {
      return;
    }

    const transferRepo = this.dataSource.getRepository(TonTransferEntity);
    const idempotencyKey = buildIdempotencyKey(
      IDEMPOTENCY_PREFIX.FEE,
      options.payoutId,
    );
    let transfer = await transferRepo.findOne({
      where: { idempotencyKey },
    });

    if (
      transfer &&
      ![TonTransferStatus.FAILED, TonTransferStatus.CREATED].includes(
        transfer.status,
      )
    ) {
      return;
    }

    const fromAddress = await this.tonHotWalletService.getAddress();
    if (!transfer) {
      transfer = await transferRepo.save(
        transferRepo.create({
          transactionId: null,
          dealId: null,
          escrowWalletId: null,
          idempotencyKey,
          type: TonTransferType.FEE,
          status: TonTransferStatus.CREATED,
          network: options.currency,
          fromAddress,
          toAddress: config.feeRevenueAddress,
          amountNano: options.amountNano.toString(),
          txHash: null,
          observedAt: null,
          raw: { reason: 'fee_revenue', payoutId: options.payoutId },
          errorMessage: null,
        }),
      );
    } else {
      await transferRepo.update(transfer.id, {
        status: TonTransferStatus.CREATED,
        errorMessage: null,
      });
    }

    try {
      const { txHash } = await this.tonHotWalletService.sendTon({
        toAddress: config.feeRevenueAddress,
        amountNano: options.amountNano,
      });
      if (!txHash) {
        this.logger.warn(
          `[TON-WATCHER] ${JSON.stringify({
            event: PAYMENT_LOG_EVENTS.FEE_REVENUE_MISSING_TX_HASH,
            payoutId: options.payoutId,
            tonTransferId: transfer.id,
            amountNano: options.amountNano.toString(),
            toAddress: config.feeRevenueAddress,
            idempotencyKey: transfer.idempotencyKey,
          })}`,
        );
      }
      await transferRepo.update(transfer.id, {
        status: TonTransferStatus.BROADCASTED,
        txHash: txHash ?? null,
        observedAt: transfer.observedAt,
        errorMessage: null,
      });
      this.logger.log(
        `[TON-WATCHER] ${JSON.stringify({
          event: PAYMENT_LOG_EVENTS.FEE_REVENUE_BROADCASTED,
          payoutId: options.payoutId,
          tonTransferId: transfer.id,
          amountNano: options.amountNano.toString(),
          toAddress: config.feeRevenueAddress,
          txHash: txHash ?? null,
          idempotencyKey: transfer.idempotencyKey,
        })}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await transferRepo.update(transfer.id, {
        status: TonTransferStatus.FAILED,
        errorMessage: message,
      });
      this.logger.warn(
        `[TON-WATCHER] ${JSON.stringify({
          event: PAYMENT_LOG_EVENTS.FEE_REVENUE_FAILED,
          payoutId: options.payoutId,
          tonTransferId: transfer.id,
          error: message,
        })}`,
      );
    }
  }

  private async reconcileDeploymentBalance(
    escrowId: string,
    address: string,
  ): Promise<void> {
    let balanceNano: bigint;
    try {
      balanceNano = await this.tonWalletDeploymentService.getBalance(address);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch escrow wallet balance ${address}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const escrowRepo = manager.getRepository(DealEscrowEntity);
      const dealRepo = manager.getRepository(DealEntity);

      const lockedEscrow = await escrowRepo.findOne({
        where: { id: escrowId },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        !lockedEscrow ||
        ![
          EscrowStatus.AWAITING_PAYMENT,
          EscrowStatus.PAID_PARTIAL,
          EscrowStatus.PAID_HELD,
        ].includes(lockedEscrow.status)
      ) {
        return;
      }

      const currentPaid = lockedEscrow.paidNano ?? '0';
      if (balanceNano >= BigInt(currentPaid)) {
        return;
      }

      const balanceStr = balanceNano.toString();
      const expected = lockedEscrow.amountNano;
      const isConfirmed = gteNano(balanceStr, expected);

      await escrowRepo.update(lockedEscrow.id, {
        paidNano: balanceStr,
        status: isConfirmed
          ? EscrowStatus.PAID_HELD
          : EscrowStatus.PAID_PARTIAL,
        paidAt: lockedEscrow.paidAt ?? new Date(),
        heldAt: isConfirmed ? (lockedEscrow.heldAt ?? new Date()) : null,
      });

      if (!isConfirmed) {
        await dealRepo.update(lockedEscrow.dealId, {
          stage: DealStage.PAYMENT_PARTIALLY_PAID,
          status: mapStageToDealStatus(DealStage.PAYMENT_PARTIALLY_PAID),
        });
      }
    });
  }

  private async getDeploymentOptions(walletId: string): Promise<{
    publicKeyHex: string;
    secretKeyHex: string;
    address: string;
  } | null> {
    const wallet = await this.escrowWalletRepo.findOne({
      where: { id: walletId },
    });
    if (!wallet) {
      return null;
    }

    const walletKey = await this.escrowWalletKeyRepo.findOne({
      where: { walletId },
    });
    if (!walletKey) {
      return null;
    }

    const decrypted = this.keyEncryptionService.decryptSecret(
      walletKey.encryptedSecret,
    );
    const secret = JSON.parse(decrypted) as {
      publicKeyHex?: string;
      secretKeyHex?: string;
      address?: string;
    };

    if (!secret.publicKeyHex || !secret.secretKeyHex || !secret.address) {
      return null;
    }

    if (secret.address !== wallet.address) {
      return null;
    }

    return {
      publicKeyHex: secret.publicKeyHex,
      secretKeyHex: secret.secretKeyHex,
      address: wallet.address,
    };
  }
}

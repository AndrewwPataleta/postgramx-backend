import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { EntityManager, Repository } from 'typeorm';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { TransactionDirection } from '../../../common/constants/payments/transaction-direction.constants';
import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../../common/constants/payments/transaction-type.constants';
import { TransactionEntity } from '../entities/transaction.entity';
import { UserWalletService } from '../wallets/user-wallet.service';
import { LedgerService } from '../ledger/ledger.service';
import { FeesService } from '../fees/fees.service';
import { PayoutRequestMode } from './dto/payout-request.dto';
import {
  PayoutServiceError,
  PayoutErrorCode,
} from './errors/payout-service.error';
import { TonTransferEntity } from '../entities/ton-transfer.entity';
import { TonTransferStatus } from '../../../common/constants/payments/ton-transfer-status.constants';
import { TonTransferType } from '../../../common/constants/payments/ton-transfer-type.constants';
import { IDEMPOTENCY_PREFIX } from '../../../common/constants';
import { buildIdempotencyKey } from '../../../common/utils/idempotency.util';
import { TonHotWalletService } from '../ton/ton-hot-wallet.service';
import { User } from '../../auth/entities/user.entity';
import { TelegramMessengerService } from '../../telegram/telegram-messenger.service';
import { TelegramSenderService } from '../../telegram/telegram-sender.service';
import { TelegramI18nService } from '../../telegram/i18n/telegram-i18n.service';

type PayoutRequestPayload = {
  userId: string;
  amountNano?: string;
  currency?: CurrencyCode;
  mode?: PayoutRequestMode;
  idempotencyKey?: string;
};

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);
  private static readonly DAILY_LIMIT = 2;

  constructor(
    private readonly ledgerService: LedgerService,
    private readonly userWalletService: UserWalletService,
    private readonly feesService: FeesService,
    private readonly tonHotWalletService: TonHotWalletService,
    private readonly configService: ConfigService,
    private readonly telegramMessengerService: TelegramMessengerService,
    private readonly telegramSenderService: TelegramSenderService,
    private readonly telegramI18nService: TelegramI18nService,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectRepository(TonTransferEntity)
    private readonly transferRepository: Repository<TonTransferEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async requestWithdrawal(payload: PayoutRequestPayload) {
    const currency = payload.currency ?? CurrencyCode.TON;
    const mode =
      payload.mode ??
      (payload.amountNano ? PayoutRequestMode.AMOUNT : PayoutRequestMode.ALL);

    const wallet = await this.userWalletService.getWallet(payload.userId);
    if (!wallet?.tonAddress) {
      throw new PayoutServiceError(PayoutErrorCode.WALLET_NOT_CONNECTED);
    }

    const destinationAddress = wallet.tonAddress;
    this.tonHotWalletService.validateDestinationAddress(destinationAddress);
    let created = false;
    this.logger.log(
      `[PAYOUT-REQUEST] start ${JSON.stringify({
        userId: payload.userId,
        amountNano: payload.amountNano,
        currency,
        mode,
        destinationAddress,
        idempotencyKey: payload.idempotencyKey,
      })}`,
    );

    const transaction = await this.ledgerService.withUserLock(
      payload.userId,
      async (manager) => {
        const txRepo = manager.getRepository(TransactionEntity);
        const transferRepo = manager.getRepository(TonTransferEntity);

        if (payload.idempotencyKey) {
          const existing = await txRepo.findOne({
            where: { idempotencyKey: payload.idempotencyKey },
          });
          if (existing) {
            return existing;
          }
        }

        await this.assertDailyLimitNotReached(payload.userId, txRepo);

        const balance = await this.ledgerService.getWithdrawableBalance(
          payload.userId,
          currency,
          manager,
        );

        const withdrawableNano = balance.withdrawableNano;
        let amountNano = payload.amountNano ?? withdrawableNano;
        let feeResult: Awaited<ReturnType<FeesService['computePayoutFees']>>;
        const payoutReceivesFullAmount =
          await this.feesService.payoutReceivesFullAmount();

        if (mode === PayoutRequestMode.AMOUNT) {
          if (!this.isValidAmount(amountNano)) {
            throw new PayoutServiceError(PayoutErrorCode.INVALID_AMOUNT);
          }
          feeResult = await this.feesService.validatePayout({
            amountNano,
            withdrawableNano,
            currency,
            destinationAddress,
          });
        } else {
          if (payoutReceivesFullAmount) {
            amountNano = withdrawableNano;
            feeResult = await this.feesService.validatePayout({
              amountNano,
              withdrawableNano,
              currency,
              destinationAddress,
            });
          } else {
            const resolved = await this.resolvePayoutAmountForAll({
              withdrawableNano,
              currency,
              destinationAddress,
            });
            amountNano = resolved.amountNano;
            feeResult = resolved.fees;
            if (BigInt(amountNano) > 0n) {
              feeResult = await this.feesService.validatePayout({
                amountNano,
                withdrawableNano,
                currency,
                destinationAddress,
              });
            }
          }
        }

        if (BigInt(amountNano) <= 0n) {
          throw new PayoutServiceError(PayoutErrorCode.INSUFFICIENT_BALANCE, {
            availableNano: withdrawableNano,
            requiredNano: feeResult.totalDebitNano,
          });
        }

        if (BigInt(feeResult.totalDebitNano) > BigInt(withdrawableNano)) {
          throw new PayoutServiceError(PayoutErrorCode.INSUFFICIENT_BALANCE, {
            availableNano: withdrawableNano,
            requiredNano: feeResult.totalDebitNano,
          });
        }

        await this.ensureHotWalletLiquidity(amountNano, currency, manager);

        const idempotencyKey =
          payload.idempotencyKey ??
          this.buildIdempotencyKey({
            userId: payload.userId,
            destinationAddress,
            amountNano,
          });

        if (!payload.idempotencyKey) {
          const existing = await txRepo.findOne({
            where: { idempotencyKey },
          });
          if (existing) {
            return existing;
          }
        }

        const createdTx = txRepo.create({
          userId: payload.userId,
          type: TransactionType.PAYOUT,
          direction: TransactionDirection.OUT,
          status: TransactionStatus.PENDING,
          amountNano,
          amountToUserNano: amountNano,
          serviceFeeNano: feeResult.serviceFeeNano,
          networkFeeNano: feeResult.networkFeeNano,
          totalDebitNano: feeResult.totalDebitNano,
          feePolicyVersion: feeResult.policyVersion,
          currency,
          description: 'Payout request',
          destinationAddress,
          idempotencyKey,
          metadata: {
            fee: feeResult.breakdown,
          },
        });

        const saved = await txRepo.save(createdTx);
        const transferIdempotencyKey = buildIdempotencyKey(
          IDEMPOTENCY_PREFIX.WITHDRAW,
          saved.id,
        );
        let transfer = await transferRepo.findOne({
          where: { transactionId: saved.id },
        });
        if (!transfer) {
          const fromAddress = await this.tonHotWalletService.getAddress();
          transfer = await transferRepo.save(
            transferRepo.create({
              transactionId: saved.id,
              dealId: saved.dealId ?? null,
              escrowWalletId: null,
              idempotencyKey: transferIdempotencyKey,
              type: TonTransferType.PAYOUT,
              status: TonTransferStatus.CREATED,
              network: saved.currency,
              fromAddress,
              toAddress: saved.destinationAddress ?? '',
              amountNano: saved.amountToUserNano ?? saved.amountNano,
              txHash: null,
              observedAt: null,
              raw: { reason: 'withdrawal_request' },
              errorMessage: null,
            }),
          );
        }
        await txRepo.update(saved.id, { tonTransferId: transfer.id });
        await this.createFeeTransactions({
          manager,
          payout: saved,
          serviceFeeNano: feeResult.serviceFeeNano,
          networkFeeNano: feeResult.networkFeeNano,
        });
        created = true;

        this.logger.log(
          `[PAYOUT-REQUEST] created ${JSON.stringify({
            payoutId: saved.id,
            tonTransferId: transfer.id,
            userId: payload.userId,
            amountNano,
            withdrawableNano,
            totalDebitNano: feeResult.totalDebitNano,
            serviceFeeNano: feeResult.serviceFeeNano,
            networkFeeNano: feeResult.networkFeeNano,
            feePolicyVersion: feeResult.policyVersion,
            idempotencyKey,
          })}`,
        );

        return saved;
      },
    );

    if (!created) {
      return this.toResponse(transaction);
    }

    const updated = await this.transactionRepository.findOne({
      where: { id: transaction.id },
    });

    return this.toResponse(updated ?? transaction);
  }

  async requestPayout(payload: PayoutRequestPayload) {
    return this.requestWithdrawal(payload);
  }

  private isValidAmount(value: string): boolean {
    if (!value || !/^\d+$/.test(value)) {
      return false;
    }
    return BigInt(value) > 0n;
  }

  private buildIdempotencyKey(options: {
    userId: string;
    destinationAddress: string;
    amountNano: string;
  }): string {
    const raw = `${options.userId}:${options.destinationAddress}:${options.amountNano}:payout`;
    return createHash('sha256').update(raw).digest('hex');
  }

  private async assertDailyLimitNotReached(
    userId: string,
    txRepo: Repository<TransactionEntity>,
  ): Promise<void> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const todayAttempts = await txRepo
      .createQueryBuilder('tx')
      .where('tx.userId = :userId', { userId })
      .andWhere('tx.type = :type', { type: TransactionType.PAYOUT })
      .andWhere('tx.createdAt >= :start AND tx.createdAt < :end', {
        start,
        end,
      })
      .andWhere('tx.status IN (:...statuses)', {
        statuses: [
          TransactionStatus.PENDING,
          TransactionStatus.AWAITING_CONFIRMATION,
          TransactionStatus.CONFIRMED,
          TransactionStatus.COMPLETED,
        ],
      })
      .getCount();

    if (todayAttempts < PayoutsService.DAILY_LIMIT) {
      return;
    }

    await this.notifyDailyLimitReached(userId);
    throw new PayoutServiceError(PayoutErrorCode.DAILY_WITHDRAW_LIMIT);
  }

  private async notifyDailyLimitReached(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    const username = user?.username ? `@${user.username}` : '-';

    if (user?.telegramId) {
      await this.telegramMessengerService.sendText(
        user.telegramId,
        'telegram.payout.daily_limit_reached',
        {
          limit: String(PayoutsService.DAILY_LIMIT),
        },
        {
          lang: this.telegramI18nService.resolveLanguageForUser(user),
        },
      );
    }

    const adminChatId = this.configService.get<string>('ADMIN_ALERTS_CHAT_ID');
    if (!adminChatId) {
      return;
    }

    const lang = this.telegramI18nService.resolveLanguageForUser(user, 'en');
    const text = this.telegramI18nService.t(
      lang,
      'telegram.admin.daily_withdraw_limit',
      {
        userId,
        username,
        limit: String(PayoutsService.DAILY_LIMIT),
        eventType: 'DAILY_WITHDRAW_LIMIT',
      },
    );
    await this.telegramSenderService.sendMessage(adminChatId, text, {
      parseMode: 'HTML',
    });
  }

  private toResponse(transaction: TransactionEntity) {
    return {
      payoutId: transaction.id,
      status: transaction.status,
      amountNano: transaction.amountNano,
      amountToUserNano: transaction.amountToUserNano ?? transaction.amountNano,
      serviceFeeNano: transaction.serviceFeeNano,
      networkFeeNano: transaction.networkFeeNano,
      totalDebitNano: transaction.totalDebitNano,
      currency: transaction.currency,
      destinationAddress: transaction.destinationAddress,
      createdAt: transaction.createdAt.toISOString(),
    };
  }

  private async resolvePayoutAmountForAll(options: {
    withdrawableNano: string;
    currency: CurrencyCode;
    destinationAddress: string;
  }): Promise<{
    amountNano: string;
    fees: Awaited<ReturnType<FeesService['computePayoutFees']>>;
  }> {
    const withdrawable = BigInt(options.withdrawableNano);
    if (withdrawable <= 0n) {
      return {
        amountNano: '0',
        fees: await this.feesService.computePayoutFees({
          amountNano: '0',
          currency: options.currency,
          destinationAddress: options.destinationAddress,
        }),
      };
    }

    let low = 0n;
    let high = withdrawable;
    let bestAmount = 0n;
    let bestFees = await this.feesService.computePayoutFees({
      amountNano: '0',
      currency: options.currency,
      destinationAddress: options.destinationAddress,
    });

    while (low < high) {
      const mid = (low + high + 1n) / 2n;
      const fees = await this.feesService.computePayoutFees({
        amountNano: mid.toString(),
        currency: options.currency,
        destinationAddress: options.destinationAddress,
      });
      if (BigInt(fees.totalDebitNano) <= withdrawable) {
        low = mid;
        bestAmount = mid;
        bestFees = fees;
      } else {
        high = mid - 1n;
      }
    }

    if (bestAmount !== low) {
      bestFees = await this.feesService.computePayoutFees({
        amountNano: low.toString(),
        currency: options.currency,
        destinationAddress: options.destinationAddress,
      });
    }

    return { amountNano: low.toString(), fees: bestFees };
  }

  private async ensureHotWalletLiquidity(
    amountNano: string,
    currency: CurrencyCode,
    manager: EntityManager,
  ): Promise<void> {
    const hotBalanceNano = await this.tonHotWalletService.getBalance();
    const reservedNano = await this.ledgerService.getReservedPayoutsTotal(
      currency,
      manager,
    );
    const canSpendNano = hotBalanceNano - BigInt(reservedNano);
    if (canSpendNano < BigInt(amountNano)) {
      throw new PayoutServiceError(PayoutErrorCode.BLOCKED_LIQUIDITY);
    }
  }

  private async createFeeTransactions(options: {
    manager: EntityManager;
    payout: TransactionEntity;
    serviceFeeNano: string;
    networkFeeNano: string;
  }): Promise<void> {
    const txRepo = options.manager.getRepository(TransactionEntity);

    const feeTransactions: TransactionEntity[] = [];
    if (BigInt(options.serviceFeeNano) > 0n) {
      feeTransactions.push(
        txRepo.create({
          userId: options.payout.userId,
          type: TransactionType.FEE,
          direction: TransactionDirection.INTERNAL,
          status: TransactionStatus.PENDING,
          amountNano: options.serviceFeeNano,
          currency: options.payout.currency,
          description: 'Service fee charged',
          idempotencyKey: `${IDEMPOTENCY_PREFIX.FEE}${options.payout.id}:service`,
          metadata: {
            payoutId: options.payout.id,
            feeType: 'SERVICE',
            feePolicyVersion: options.payout.feePolicyVersion,
          },
        }),
      );
    }

    if (BigInt(options.networkFeeNano) > 0n) {
      feeTransactions.push(
        txRepo.create({
          userId: options.payout.userId,
          type: TransactionType.NETWORK_FEE,
          direction: TransactionDirection.INTERNAL,
          status: TransactionStatus.PENDING,
          amountNano: options.networkFeeNano,
          currency: options.payout.currency,
          description: 'Network fee charged',
          idempotencyKey: `${IDEMPOTENCY_PREFIX.FEE}${options.payout.id}:network`,
          metadata: {
            payoutId: options.payout.id,
            feeType: 'NETWORK',
            feePolicyVersion: options.payout.feePolicyVersion,
          },
        }),
      );
    }

    if (feeTransactions.length > 0) {
      await txRepo.save(feeTransactions);
    }
  }
}

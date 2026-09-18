import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateTransactionPayload } from './dto/create-transaction.dto';
import { ListTransactionsFilters } from './dto/list-transactions.dto';
import { TransactionEntity } from './entities/transaction.entity';
import { TransactionStatus } from '../../common/constants/payments/transaction-status.constants';
import { definedOnly } from '../../common/utils/defined-only';
import { TransactionType } from '../../common/constants/payments/transaction-type.constants';
import { TransactionDirection } from '../../common/constants/payments/transaction-direction.constants';
import { DealEntity } from '../deals/entities/deal.entity';
import { CurrencyCode } from '../../common/constants/currency/currency.constants';
import { WalletsService } from './wallets/wallets.service';
import { DealEscrowEntity } from '../deals/entities/deal-escrow.entity';
import { EscrowStatus } from '../../common/constants/deals/deal-escrow-status.constants';
import { I18nContext } from 'nestjs-i18n';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const TRANSACTION_TYPE_KEYS: Record<TransactionType, string> = {
  [TransactionType.DEPOSIT]: 'payments.transactions.types.deposit',
  [TransactionType.PAYOUT]: 'payments.transactions.types.payout',
  [TransactionType.REFUND]: 'payments.transactions.types.refund',
  [TransactionType.SWEEP]: 'payments.transactions.types.sweep',
  [TransactionType.FEE]: 'payments.transactions.types.fee',
  [TransactionType.NETWORK_FEE]: 'payments.transactions.types.network_fee',
};
const TRANSACTION_STATUS_KEYS: Record<TransactionStatus, string> = {
  [TransactionStatus.PENDING]: 'payments.transactions.statuses.pending',
  [TransactionStatus.PARTIAL]: 'payments.transactions.statuses.partial',
  [TransactionStatus.AWAITING_CONFIRMATION]:
    'payments.transactions.statuses.awaiting_confirmation',
  [TransactionStatus.CONFIRMED]: 'payments.transactions.statuses.confirmed',
  [TransactionStatus.COMPLETED]: 'payments.transactions.statuses.completed',
  [TransactionStatus.BLOCKED_LIQUIDITY]:
    'payments.transactions.statuses.blocked_liquidity',
  [TransactionStatus.REFUNDED]: 'payments.transactions.statuses.refunded',
  [TransactionStatus.FAILED]: 'payments.transactions.statuses.failed',
  [TransactionStatus.CANCELED]: 'payments.transactions.statuses.canceled',
};
const TRANSACTION_DESCRIPTION_KEYS: Record<string, string> = {
  BOT_NOT_ADMIN: 'payments.transactions.reasons.bot_not_admin',
  POST_FAILED: 'payments.transactions.reasons.post_failed',
  DELIVERY_CONFIRMED: 'payments.transactions.reasons.delivery_confirmed',
  ADMIN_REJECTED: 'payments.transactions.reasons.admin_rejected',
  CANCELED: 'payments.transactions.reasons.canceled',
  ADMIN_RIGHTS_LOST: 'payments.transactions.reasons.admin_rights_lost',
  'Deposit received': 'payments.transactions.descriptions.deposit_received',
  'Payout sent': 'payments.transactions.descriptions.payout_sent',
  'Refund sent': 'payments.transactions.descriptions.refund_sent',
  'Service fee charged': 'payments.transactions.descriptions.service_fee',
  'Network fee charged': 'payments.transactions.descriptions.network_fee',
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepository: Repository<DealEscrowEntity>,
    private readonly walletsService: WalletsService,
  ) {}

  async listTransactionsForUser(
    userId: string,
    filters: ListTransactionsFilters,
    i18n?: I18nContext,
  ) {
    const page = filters.page ?? DEFAULT_PAGE;
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    const queryBuilder = this.transactionRepository
      .createQueryBuilder('transaction')
      .where('transaction.userId = :userId', { userId });

    if (filters.type) {
      queryBuilder.andWhere('transaction.type = :type', {
        type: filters.type,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('transaction.status = :status', {
        status: filters.status,
      });
    }

    if (filters.direction) {
      queryBuilder.andWhere('transaction.direction = :direction', {
        direction: filters.direction,
      });
    }

    if (filters.dealId) {
      queryBuilder.andWhere('transaction.dealId = :dealId', {
        dealId: filters.dealId,
      });
    }

    if (filters.q) {
      queryBuilder.andWhere(
        '(transaction.description ILIKE :query OR transaction.externalTxHash ILIKE :query)',
        { query: `%${filters.q}%` },
      );
    }

    if (filters.from) {
      queryBuilder.andWhere('transaction.createdAt >= :from', {
        from: new Date(filters.from),
      });
    }

    if (filters.to) {
      queryBuilder.andWhere('transaction.createdAt <= :to', {
        to: new Date(filters.to),
      });
    }

    const sort = filters.sort ?? 'recent';
    const order = (filters.order ?? 'desc').toUpperCase() as 'ASC' | 'DESC';

    if (sort === 'amount') {
      queryBuilder
        .orderBy('transaction.amountNano', order)
        .addOrderBy('transaction.createdAt', 'DESC')
        .addOrderBy('transaction.id', 'DESC');
    } else {
      queryBuilder
        .orderBy('transaction.createdAt', order)
        .addOrderBy('transaction.id', 'DESC');
    }

    queryBuilder.skip(offset).take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    const localizedItems = await Promise.all(
      items.map(async (item) => ({
        id: item.id,
        type: item.type,
        typeLabel: await this.localizeTransactionType(item.type, i18n),
        direction: item.direction,
        status: item.status,
        statusLabel: await this.localizeTransactionStatus(item.status, i18n),
        amountNano: item.amountNano,
        serviceFeeNano: item.serviceFeeNano,
        networkFeeNano: item.networkFeeNano,
        totalDebitNano: item.totalDebitNano,
        currency: item.currency,
        description: item.description,
        descriptionLabel: await this.localizeTransactionDescription(
          item.description,
          i18n,
        ),
        dealId: item.dealId,
        escrowId: item.escrowId,
        channelId: item.channelId,
        externalTxHash: item.externalTxHash,
        createdAt: item.createdAt,
        confirmedAt: item.confirmedAt,
        completedAt: item.completedAt,
      })),
    );

    return {
      items: localizedItems,
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  async getTransactionForUser(userId: string, id: string) {
    const transaction = await this.transactionRepository.findOne({
      where: { id },
    });

    if (!transaction) {
      throw new NotFoundException();
    }

    if (transaction.userId !== userId) {
      throw new ForbiddenException();
    }

    return transaction;
  }

  async createTransaction(data: CreateTransactionPayload) {
    const transaction = this.transactionRepository.create({
      userId: data.userId,
      type: data.type,
      direction: data.direction,
      amountNano: data.amountNano,
      currency: data.currency ?? CurrencyCode.TON,
      status: data.status ?? TransactionStatus.PENDING,
      description: data.description ?? null,
      dealId: data.dealId ?? null,
      escrowId: data.escrowId ?? null,
      channelId: data.channelId ?? null,
      counterpartyUserId: data.counterpartyUserId ?? null,
      depositAddress: data.depositAddress ?? null,
      externalTxHash: data.externalTxHash ?? null,
      externalExplorerUrl: data.externalExplorerUrl ?? null,
      errorCode: data.errorCode ?? null,
      errorMessage: data.errorMessage ?? null,
      metadata: data.metadata ?? null,
    });

    const saved = await this.transactionRepository.save(transaction);

    return {
      id: saved.id,
      status: saved.status,
      currency: saved.currency,
      amountNano: saved.amountNano,
      payToAddress: saved.depositAddress,
    };
  }

  async ensureDepositAddressForDeal(
    dealId: string,
    manager?: EntityManager,
  ): Promise<{
    payToAddress: string;
    amountNano: string;
    currency: CurrencyCode;
  }> {
    const entityManager = manager ?? this.dataSource.manager;
    const dealRepository = entityManager.getRepository(DealEntity);
    const escrowRepository = entityManager.getRepository(DealEscrowEntity);

    const deal = await dealRepository.findOne({ where: { id: dealId } });
    if (!deal) {
      throw new NotFoundException();
    }

    const escrow = await escrowRepository.findOne({
      where: { dealId: deal.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!escrow) {
      throw new NotFoundException();
    }

    if (
      ![
        EscrowStatus.CREATED,
        EscrowStatus.AWAITING_PAYMENT,
        EscrowStatus.PAID_PARTIAL,
      ].includes(escrow.status)
    ) {
      throw new ForbiddenException();
    }

    if (!escrow.depositAddress) {
      const wallet = await this.walletsService.createEscrowWallet(
        deal.id,
        entityManager,
      );
      await escrowRepository.update(escrow.id, {
        depositWalletId: wallet?.id ?? null,
        depositAddress: wallet?.address ?? null,
        status: EscrowStatus.AWAITING_PAYMENT,
      });
      escrow.depositAddress = wallet?.address ?? null;
      escrow.depositWalletId = wallet?.id ?? null;
      escrow.status = EscrowStatus.AWAITING_PAYMENT;
    }

    if (!escrow.depositAddress) {
      throw new NotFoundException();
    }

    return {
      payToAddress: escrow.depositAddress,
      amountNano: escrow.amountNano,
      currency: escrow.currency ?? CurrencyCode.TON,
    };
  }

  async updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    timestamps?: {
      confirmedAt?: Date | null;
      completedAt?: Date | null;
    },
  ) {
    const updatePayload = definedOnly({
      status,
      confirmedAt: timestamps?.confirmedAt,
      completedAt: timestamps?.completedAt,
    });

    await this.transactionRepository.update(id, updatePayload);
  }

  async refundEscrow(dealId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const dealRepository = manager.getRepository(DealEntity);
      const escrowRepository = manager.getRepository(DealEscrowEntity);
      const txRepository = manager.getRepository(TransactionEntity);

      const deal = await dealRepository.findOne({
        where: { id: dealId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!deal) {
        return;
      }

      const escrow = await escrowRepository.findOne({
        where: { dealId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!escrow) {
        return;
      }

      const refundableAmountNano = BigInt(escrow.paidNano ?? '0');
      if (refundableAmountNano <= 0n) {
        await escrowRepository.update(escrow.id, {
          status: EscrowStatus.REFUNDED,
        });
        await dealRepository.update(dealId, {
          lastActivityAt: now,
        });
        return;
      }

      const idempotencyKey = `refund_to_available:${dealId}`;
      await txRepository
        .createQueryBuilder('transaction')
        .setLock('pessimistic_write')
        .where('transaction.userId = :userId', {
          userId: deal.advertiserUserId,
        })
        .andWhere('transaction.currency = :currency', {
          currency: escrow.currency,
        })
        .orderBy('transaction.createdAt', 'DESC')
        .limit(1)
        .getOne();

      const existing = await txRepository.findOne({
        where: { idempotencyKey },
        lock: { mode: 'pessimistic_write' },
      });
      if (!existing) {
        await txRepository.save(
          txRepository.create({
            userId: deal.advertiserUserId,
            type: TransactionType.REFUND,
            direction: TransactionDirection.IN,
            status: TransactionStatus.COMPLETED,
            amountNano: refundableAmountNano.toString(),
            amountToUserNano: refundableAmountNano.toString(),
            currency: escrow.currency,
            description: 'Deal canceled - funds returned to available balance',
            dealId: deal.id,
            escrowId: escrow.id,
            idempotencyKey,
            metadata: {
              eventType: 'DEAL_REFUND_TO_AVAILABLE',
              reason,
              refundableAmountNano: refundableAmountNano.toString(),
            },
            completedAt: now,
          }),
        );
      }

      await escrowRepository.update(escrow.id, {
        status: EscrowStatus.REFUNDED,
        refundedAt: now,
      });

      await dealRepository.update(dealId, {
        lastActivityAt: now,
      });
    });

    this.logger.log(
      `Deal canceled - crediting advertiser available balance (no on-chain refund). dealId=${dealId}, reason=${reason}`,
    );
  }

  async markEscrowPayoutPending(dealId: string): Promise<void> {
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const escrowRepository = manager.getRepository(DealEscrowEntity);
      const dealRepository = manager.getRepository(DealEntity);

      const escrow = await escrowRepository.findOne({
        where: { dealId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!escrow) {
        return;
      }

      if (escrow.status !== EscrowStatus.PAID_HELD) {
        return;
      }

      await escrowRepository.update(escrow.id, {
        status: EscrowStatus.PAYOUT_PENDING,
      });

      await dealRepository.update(dealId, {
        lastActivityAt: now,
      });
    });
  }

  private async localizeTransactionType(
    type: TransactionType,
    i18n?: I18nContext,
  ): Promise<string> {
    if (!i18n) {
      return type;
    }

    const key = TRANSACTION_TYPE_KEYS[type];
    if (!key) {
      return type;
    }

    return i18n.t(key, { defaultValue: type });
  }

  private async localizeTransactionDescription(
    description: string | null,
    i18n?: I18nContext,
  ): Promise<string | null> {
    if (!description) {
      return description;
    }

    if (!i18n) {
      return description;
    }

    const key = TRANSACTION_DESCRIPTION_KEYS[description];
    if (!key) {
      return description;
    }

    return i18n.t(key, { defaultValue: description });
  }

  private async localizeTransactionStatus(
    status: TransactionStatus,
    i18n?: I18nContext,
  ): Promise<string> {
    if (!i18n) {
      return status;
    }

    const key = TRANSACTION_STATUS_KEYS[status];
    if (!key) {
      return status;
    }

    return i18n.t(key, { defaultValue: status });
  }
}

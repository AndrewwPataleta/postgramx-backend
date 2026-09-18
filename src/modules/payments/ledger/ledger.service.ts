import type { QueryDeepPartialEntity } from '../../../core/typeorm.types';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CurrencyCode } from '../../../common/constants/currency/currency.constants';
import { TransactionDirection } from '../../../common/constants/payments/transaction-direction.constants';
import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';
import { TransactionType } from '../../../common/constants/payments/transaction-type.constants';
import { TransactionEntity } from '../entities/transaction.entity';
import { DealEscrowEntity } from '../../deals/entities/deal-escrow.entity';
import { DealEntity } from '../../deals/entities/deal.entity';
import { PublicationStatus } from '../../../common/constants/deals/publication-status.constants';
import { EscrowStatus } from '../../../common/constants/deals/deal-escrow-status.constants';

export type WithdrawableBalance = {
  withdrawableNano: string;
  creditsNano: string;
  debitsNano: string;
  reservedNano: string;
};

@Injectable()
export class LedgerService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepository: Repository<DealEscrowEntity>,
  ) {}

  async getWithdrawableBalance(
    userId: string,
    currency: CurrencyCode,
    manager?: EntityManager,
  ): Promise<WithdrawableBalance> {
    const repo = manager
      ? manager.getRepository(TransactionEntity)
      : this.transactionRepository;
    const escrowRepo = manager
      ? manager.getRepository(DealEscrowEntity)
      : this.escrowRepository;

    const earnedRow = await escrowRepo
      .createQueryBuilder('escrow')
      .innerJoin(DealEntity, 'deal', 'deal.id = escrow.dealId')
      .innerJoin('deal.publication', 'publication')
      .select('COALESCE(SUM(escrow.amountNano), 0)::bigint', 'earnedNano')
      .where('deal.publisherUserId = :userId', { userId })
      .andWhere('escrow.currency = :currency', { currency })
      .andWhere('publication.status = :publicationStatus', {
        publicationStatus: PublicationStatus.VERIFIED,
      })
      .andWhere('escrow.status IN (:...statuses)', {
        statuses: [EscrowStatus.PAYOUT_PENDING, EscrowStatus.PAID_OUT],
      })
      .getRawOne<{ earnedNano: string | null }>();

    const refundCreditsRow = await repo
      .createQueryBuilder('transaction')
      .select(
        'COALESCE(SUM(transaction.amountNano), 0)::bigint',
        'refundCreditsNano',
      )
      .where('transaction.userId = :userId', { userId })
      .andWhere('transaction.currency = :currency', { currency })
      .andWhere('transaction.direction = :dirIn', {
        dirIn: TransactionDirection.IN,
      })
      .andWhere('transaction.status = :completed', {
        completed: TransactionStatus.COMPLETED,
      })
      .andWhere('transaction.type = :refundType', {
        refundType: TransactionType.REFUND,
      })
      .getRawOne<{ refundCreditsNano: string | null }>();

    const paidOutRow = await repo
      .createQueryBuilder('transaction')
      .select(
        'COALESCE(SUM(COALESCE(transaction.totalDebitNano, transaction.amountNano)), 0)::bigint',
        'debitsNano',
      )
      .where('transaction.userId = :userId', { userId })
      .andWhere('transaction.currency = :currency', { currency })
      .andWhere('transaction.direction = :dirOut', {
        dirOut: TransactionDirection.OUT,
      })
      .andWhere('transaction.status = :completed', {
        completed: TransactionStatus.COMPLETED,
      })
      .andWhere('transaction.type = :payoutType', {
        payoutType: TransactionType.PAYOUT,
      })
      .getRawOne<{ debitsNano: string | null }>();

    const pendingTxRow = await repo
      .createQueryBuilder('transaction')
      .select(
        'COALESCE(SUM(COALESCE(transaction.totalDebitNano, transaction.amountNano)), 0)::bigint',
        'reservedNano',
      )
      .where('transaction.userId = :userId', { userId })
      .andWhere('transaction.currency = :currency', { currency })
      .andWhere('transaction.direction = :dirOut', {
        dirOut: TransactionDirection.OUT,
      })
      .andWhere('transaction.type = :payoutType', {
        payoutType: TransactionType.PAYOUT,
      })
      .andWhere('transaction.status IN (:...reservedStatuses)', {
        reservedStatuses: [
          TransactionStatus.PENDING,
          TransactionStatus.AWAITING_CONFIRMATION,
          TransactionStatus.CONFIRMED,
          TransactionStatus.BLOCKED_LIQUIDITY,
        ],
      })
      .getRawOne<{ reservedNano: string | null }>();

    const pendingEscrowRow = await escrowRepo
      .createQueryBuilder('escrow')
      .innerJoin(DealEntity, 'deal', 'deal.id = escrow.dealId')
      .innerJoin('deal.publication', 'publication')
      .innerJoin(
        TransactionEntity,
        'payoutTx',
        [
          'payoutTx.sourceRequestId = escrow.payoutId',
          'payoutTx.type = :payoutType',
          'payoutTx.direction = :dirOut',
          'payoutTx.status IN (:...reservedStatuses)',
        ].join(' AND '),
        {
          payoutType: TransactionType.PAYOUT,
          dirOut: TransactionDirection.OUT,
          reservedStatuses: [
            TransactionStatus.PENDING,
            TransactionStatus.AWAITING_CONFIRMATION,
            TransactionStatus.CONFIRMED,
            TransactionStatus.BLOCKED_LIQUIDITY,
          ],
        },
      )
      .select('COALESCE(SUM(escrow.amountNano), 0)::bigint', 'pendingNano')
      .where('deal.publisherUserId = :userId', { userId })
      .andWhere('escrow.currency = :currency', { currency })
      .andWhere('publication.status = :publicationStatus', {
        publicationStatus: PublicationStatus.VERIFIED,
      })
      .andWhere('escrow.status = :status', {
        status: EscrowStatus.PAYOUT_PENDING,
      })
      .getRawOne<{ pendingNano: string | null }>();

    const creditsNano = (
      BigInt(earnedRow?.earnedNano ?? '0') +
      BigInt(refundCreditsRow?.refundCreditsNano ?? '0')
    ).toString();
    const debitsNano = paidOutRow?.debitsNano ?? '0';
    const reservedNano = (
      BigInt(pendingTxRow?.reservedNano ?? '0') +
      BigInt(pendingEscrowRow?.pendingNano ?? '0')
    ).toString();
    const withdrawable =
      BigInt(creditsNano) - BigInt(debitsNano) - BigInt(reservedNano);
    return {
      withdrawableNano: (withdrawable > 0n ? withdrawable : 0n).toString(),
      creditsNano,
      debitsNano,
      reservedNano,
    };
  }

  async getReservedPayoutsTotal(
    currency: CurrencyCode,
    manager?: EntityManager,
  ): Promise<string> {
    const repo = manager
      ? manager.getRepository(TransactionEntity)
      : this.transactionRepository;

    const row = await repo
      .createQueryBuilder('transaction')
      .select(
        `COALESCE(SUM(transaction.amountNano), 0)::numeric`,
        'reservedNano',
      )
      .where('transaction.currency = :currency', { currency })
      .andWhere('transaction.direction = :direction', {
        direction: TransactionDirection.OUT,
      })
      .andWhere('transaction.type = :type', {
        type: TransactionType.PAYOUT,
      })
      .andWhere('transaction.status IN (:...statuses)', {
        statuses: [
          TransactionStatus.PENDING,
          TransactionStatus.AWAITING_CONFIRMATION,
          TransactionStatus.CONFIRMED,
          TransactionStatus.BLOCKED_LIQUIDITY,
        ],
      })
      .getRawOne<{ reservedNano: string | null }>();

    return row?.reservedNano ?? '0';
  }

  async updateFeeTransactionsStatus(
    payoutId: string,
    status: TransactionStatus,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(TransactionEntity)
      : this.transactionRepository;
    const update: Partial<TransactionEntity> = { status };
    const now = new Date();
    if (status === TransactionStatus.COMPLETED) {
      update.completedAt = now;
    }
    if (status === TransactionStatus.CANCELED) {
      update.completedAt = now;
    }

    await repo
      .createQueryBuilder()
      .update(TransactionEntity)
      .set(update as QueryDeepPartialEntity<TransactionEntity>)
      .where('type IN (:...types)', {
        types: [TransactionType.FEE, TransactionType.NETWORK_FEE],
      })
      .andWhere("metadata ->> 'payoutId' = :payoutId", {
        payoutId,
      })
      .execute();
  }

  async withUserLock<T>(
    userId: string,
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        userId,
      ]);
      return action(manager);
    });
  }
}

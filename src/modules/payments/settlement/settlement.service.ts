import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { DealEscrowEntity } from '../../deals/entities/deal-escrow.entity';
import { DealPublicationEntity } from '../../deals/entities/deal-publication.entity';
import { DealEntity } from '../../deals/entities/deal.entity';
import { EscrowStatus } from '../../../common/constants/deals/deal-escrow-status.constants';
import { PublicationStatus } from '../../../common/constants/deals/publication-status.constants';
import { DealStatus } from '../../../common/constants/deals/deal-status.constants';
import { PayoutRequestEntity } from '../entities/payout-request.entity';
import { RequestStatus } from '../../../common/constants/payments/request-status.constants';
import { SETTLEMENT_CRON } from '../../../config/payments.config';
import {
  ADVISORY_LOCKS,
  IDEMPOTENCY_PREFIX,
  PAYMENT_DESCRIPTIONS,
} from '../../../common/constants';
import { buildIdempotencyKey } from '../../../common/utils/idempotency.util';
import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';
import { TransactionDirection } from '../../../common/constants/payments/transaction-direction.constants';
import { TransactionType } from '../../../common/constants/payments/transaction-type.constants';
import { TransactionEntity } from '../entities/transaction.entity';

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepository: Repository<DealEscrowEntity>,

    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(PayoutRequestEntity)
    private readonly payoutRepository: Repository<PayoutRequestEntity>,
  ) {}

  @Cron(SETTLEMENT_CRON)
  async handleSettlement(): Promise<void> {
    await this.queueEligiblePayouts();
    await this.queueEligibleRefunds();
  }

  private async queueEligiblePayouts(): Promise<void> {
    const escrows = await this.escrowRepository
      .createQueryBuilder('escrow')
      .innerJoin(
        DealPublicationEntity,
        'publication',
        'publication.dealId = escrow.dealId',
      )
      .where('escrow.status = :status', { status: EscrowStatus.PAID_HELD })
      .andWhere('escrow.payoutId IS NULL')
      .andWhere('publication.status = :pubStatus', {
        pubStatus: PublicationStatus.VERIFIED,
      })
      .orderBy('escrow.updatedAt', 'ASC')
      .take(20)
      .getMany();

    for (const escrow of escrows) {
      await this.dataSource.transaction(async (manager) => {
        const escrowRepo = manager.getRepository(DealEscrowEntity);
        const payoutRepo = manager.getRepository(PayoutRequestEntity);
        const dealRepo = manager.getRepository(DealEntity);
        const publicationRepo = manager.getRepository(DealPublicationEntity);
        const transactionRepo = manager.getRepository(TransactionEntity);

        const lockedEscrow = await escrowRepo.findOne({
          where: { id: escrow.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !lockedEscrow ||
          lockedEscrow.status !== EscrowStatus.PAID_HELD ||
          lockedEscrow.payoutId
        ) {
          return;
        }

        const publication = await publicationRepo.findOne({
          where: { dealId: lockedEscrow.dealId },
        });
        if (!publication || publication.status !== PublicationStatus.VERIFIED) {
          return;
        }

        const deal = await dealRepo.findOne({
          where: { id: lockedEscrow.dealId },
        });
        if (!deal?.publisherUserId) {
          return;
        }

        const idempotencyKey = `${IDEMPOTENCY_PREFIX.PAYOUT}${deal.id}:${lockedEscrow.amountNano}:${lockedEscrow.currency}`;
        let payout = await payoutRepo.findOne({
          where: { idempotencyKey },
        });

        if (!payout) {
          payout = payoutRepo.create({
            userId: deal.publisherUserId,
            dealId: deal.id,
            amountNano: lockedEscrow.amountNano,
            currency: lockedEscrow.currency,
            status: RequestStatus.CREATED,
            idempotencyKey,
          });
          payout = await payoutRepo.save(payout);
        }

        const releaseKey = buildIdempotencyKey(
          ADVISORY_LOCKS.ESCROW_RELEASE,
          lockedEscrow.id,
        );
        const existingRelease = await transactionRepo.findOne({
          where: { idempotencyKey: releaseKey },
        });
        if (!existingRelease) {
          await transactionRepo.save(
            transactionRepo.create({
              userId: deal.publisherUserId,
              type: TransactionType.PAYOUT,
              direction: TransactionDirection.IN,
              status: TransactionStatus.COMPLETED,
              amountNano: lockedEscrow.amountNano,
              currency: lockedEscrow.currency,
              dealId: deal.id,
              escrowId: lockedEscrow.id,
              channelId: deal.channelId,
              description: PAYMENT_DESCRIPTIONS.ESCROW_RELEASE,
              idempotencyKey: releaseKey,
              confirmedAt: new Date(),
              completedAt: new Date(),
            }),
          );
        }

        await escrowRepo.update(lockedEscrow.id, {
          status: EscrowStatus.PAYOUT_PENDING,
          payoutId: payout.id,
        });
      });

      this.logger.log(`Payout queued for escrow ${escrow.id}`);
    }
  }

  private async queueEligibleRefunds(): Promise<void> {
    const escrows = await this.escrowRepository
      .createQueryBuilder('escrow')
      .innerJoin(DealEntity, 'deal', 'deal.id = escrow.dealId')
      .where('escrow.status IN (:...statuses)', {
        statuses: [
          EscrowStatus.PAID_PARTIAL,
          EscrowStatus.PAID_HELD,
          EscrowStatus.REFUND_PENDING,
        ],
      })
      .andWhere('escrow.refundId IS NULL')
      .andWhere('deal.status = :status', { status: DealStatus.CANCELED })
      .orderBy('escrow.updatedAt', 'ASC')
      .take(20)
      .getMany();

    for (const escrow of escrows) {
      await this.dataSource.transaction(async (manager) => {
        const escrowRepo = manager.getRepository(DealEscrowEntity);
        const dealRepo = manager.getRepository(DealEntity);

        const lockedEscrow = await escrowRepo.findOne({
          where: { id: escrow.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !lockedEscrow ||
          ![
            EscrowStatus.PAID_PARTIAL,
            EscrowStatus.PAID_HELD,
            EscrowStatus.REFUND_PENDING,
          ].includes(lockedEscrow.status) ||
          lockedEscrow.refundId
        ) {
          return;
        }

        const deal = await dealRepo.findOne({
          where: { id: lockedEscrow.dealId },
        });
        if (!deal) {
          return;
        }

        const hasPayout = await manager
          .getRepository(TransactionEntity)
          .createQueryBuilder('transaction')
          .where('transaction.dealId = :dealId', {
            dealId: deal.id,
          })
          .andWhere('transaction.type = :type', {
            type: TransactionType.PAYOUT,
          })
          .andWhere('transaction.direction = :direction', {
            direction: TransactionDirection.OUT,
          })
          .andWhere('transaction.status = :status', {
            status: TransactionStatus.COMPLETED,
          })
          .getExists();
        if (hasPayout) {
          return;
        }

        const paidNano = BigInt(lockedEscrow.paidNano ?? '0');
        const refundableAmountNano =
          paidNano > 0n ? paidNano : BigInt(lockedEscrow.amountNano);

        if (refundableAmountNano > 0n) {
          await this.creditRefundToAvailable(
            manager,
            deal,
            lockedEscrow,
            refundableAmountNano,
          );
        }

        await escrowRepo.update(lockedEscrow.id, {
          status: EscrowStatus.REFUNDED,
          refundId: null,
          refundedAt: new Date(),
        });
      });

      this.logger.log(
        'Deal canceled - crediting advertiser available balance (no on-chain refund).',
        JSON.stringify({
          dealId: escrow.dealId,
          escrowId: escrow.id,
        }),
      );
    }
  }

  private async creditRefundToAvailable(
    manager: EntityManager,
    deal: DealEntity,
    escrow: DealEscrowEntity,
    amountNano: bigint,
  ): Promise<void> {
    const txRepository = manager.getRepository(TransactionEntity);
    const idempotencyKey = `refund_to_available:${deal.id}`;

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
    if (existing) {
      return;
    }

    await txRepository.save(
      txRepository.create({
        userId: deal.advertiserUserId,
        type: TransactionType.REFUND,
        direction: TransactionDirection.IN,
        status: TransactionStatus.COMPLETED,
        amountNano: amountNano.toString(),
        amountToUserNano: amountNano.toString(),
        totalDebitNano: '0',
        currency: escrow.currency,
        description: 'Deal canceled - funds returned to available balance',
        dealId: deal.id,
        escrowId: escrow.id,
        idempotencyKey,
        metadata: {
          eventType: 'DEAL_REFUND_TO_AVAILABLE',
          refundableAmountNano: amountNano.toString(),
        },
        completedAt: new Date(),
      }),
    );
  }
}

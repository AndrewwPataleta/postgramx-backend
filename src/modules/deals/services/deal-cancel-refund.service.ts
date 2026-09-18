import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DealEntity } from '../entities/deal.entity';
import { DealEscrowEntity } from '../entities/deal-escrow.entity';
import { DealPublicationEntity } from '../entities/deal-publication.entity';
import { RefundRequestEntity } from '../../payments/entities/refund-request.entity';
import { DealStage } from '../../../common/constants/deals/deal-stage.constants';
import { DealStatus } from '../../../common/constants/deals/deal-status.constants';
import { EscrowStatus } from '../../../common/constants/deals/deal-escrow-status.constants';
import { RequestStatus } from '../../../common/constants/payments/request-status.constants';
import { PublicationStatus } from '../../../common/constants/deals/publication-status.constants';

@Injectable()
export class DealCancelAndRefundService {
  private readonly logger = new Logger(DealCancelAndRefundService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepository: Repository<DealEscrowEntity>,
    @InjectRepository(DealPublicationEntity)
    private readonly publicationRepository: Repository<DealPublicationEntity>,
    @InjectRepository(RefundRequestEntity)
    private readonly refundRepository: Repository<RefundRequestEntity>,
  ) {}

  async cancelForPinViolation(
    dealId: string,
    reasonCode: string,
  ): Promise<void> {
    await this.cancelWithRefund(dealId, reasonCode);

    this.logger.warn(
      `Deal ${dealId} canceled for pin violation: ${reasonCode}`,
    );
  }

  async cancelForPublicationViolation(
    dealId: string,
    reasonCode: string,
  ): Promise<void> {
    await this.cancelWithRefund(dealId, reasonCode);

    this.logger.warn(
      `Deal ${dealId} canceled for publication violation: ${reasonCode}`,
    );
  }

  private async cancelWithRefund(
    dealId: string,
    reasonCode: string,
  ): Promise<void> {
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const dealRepo = manager.getRepository(DealEntity);
      const escrowRepo = manager.getRepository(DealEscrowEntity);
      const publicationRepo = manager.getRepository(DealPublicationEntity);
      const refundRepo = manager.getRepository(RefundRequestEntity);

      const deal = await dealRepo.findOne({
        where: { id: dealId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!deal) {
        return;
      }

      const escrow = await escrowRepo.findOne({
        where: { dealId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!escrow) {
        return;
      }

      if (
        [
          EscrowStatus.PAYOUT_PENDING,
          EscrowStatus.PAID_OUT,
          EscrowStatus.REFUNDED,
          EscrowStatus.FAILED,
        ].includes(escrow.status)
      ) {
        return;
      }

      if (
        ![
          EscrowStatus.PAID_HELD,
          EscrowStatus.PAID_PARTIAL,
          EscrowStatus.REFUND_PENDING,
        ].includes(escrow.status)
      ) {
        return;
      }

      const refundKey = `cancel_refund:pin_violation:${dealId}`;
      let refund = await refundRepo.findOne({
        where: { idempotencyKey: refundKey },
      });
      if (!refund && escrow.refundId) {
        refund = await refundRepo.findOne({
          where: { id: escrow.refundId },
        });
      }

      const amountNano =
        BigInt(escrow.paidNano ?? '0') > 0n
          ? escrow.paidNano
          : escrow.amountNano;

      if (!refund) {
        refund = refundRepo.create({
          userId: deal.advertiserUserId,
          dealId,
          amountNano,
          currency: escrow.currency,
          status: RequestStatus.CREATED,
          idempotencyKey: refundKey,
        });
        refund = await refundRepo.save(refund);
      } else if (refund.status === RequestStatus.FAILED) {
        refund.status = RequestStatus.CREATED;
        refund.errorMessage = null;
        refund = await refundRepo.save(refund);
      }

      await dealRepo.update(dealId, {
        status: DealStatus.CANCELED,
        stage: DealStage.FINALIZED,
        cancelReason: reasonCode,
        lastActivityAt: now,
      });

      await escrowRepo.update(escrow.id, {
        status: EscrowStatus.REFUND_PENDING,
        refundId: refund.id,
      });

      await publicationRepo.update(
        { dealId },
        {
          status: PublicationStatus.DELETED_OR_EDITED,
          error: reasonCode,
        },
      );
    });
  }
}

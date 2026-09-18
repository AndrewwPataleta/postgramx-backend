import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { DealEntity } from './entities/deal.entity';
import { DealEscrowEntity } from './entities/deal-escrow.entity';
import { DealStage } from '../../common/constants/deals/deal-stage.constants';
import { DealStatus } from '../../common/constants/deals/deal-status.constants';
import { EscrowStatus } from '../../common/constants/deals/deal-escrow-status.constants';
import { DEAL_TIMEOUTS_CRON } from '../../config/deals.config';
import { DealsNotificationsService } from './deals-notifications.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class DealsTimeoutsService {
  private readonly logger = new Logger(DealsTimeoutsService.name);

  constructor(
    @InjectRepository(DealEntity)
    private readonly dealRepository: Repository<DealEntity>,
    @InjectRepository(DealEscrowEntity)
    private readonly escrowRepository: Repository<DealEscrowEntity>,
    private readonly dealsNotificationsService: DealsNotificationsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Cron(DEAL_TIMEOUTS_CRON)
  async handleTimeouts(): Promise<void> {
    const now = new Date();
    await this.cancelIdleExpired(now);
    await this.cancelPaymentExpired(now);
  }

  private async cancelIdleExpired(now: Date): Promise<void> {
    const expiredDeals = await this.dealRepository.find({
      where: {
        idleExpiresAt: LessThan(now),
        stage: In([
          DealStage.CREATIVE_AWAITING_CONFIRM,
          DealStage.CREATIVE_AWAITING_SUBMIT,
          DealStage.CREATIVE_AWAITING_FOR_CHANGES,
          DealStage.SCHEDULING_AWAITING_CONFIRM,
          DealStage.SCHEDULING_AWAITING_SUBMIT,
          DealStage.SCHEDULE_AWAITING_FOR_CHANGES,
        ]),
      },
    });

    if (expiredDeals.length === 0) {
      return;
    }

    this.logger.log(`Canceling ${expiredDeals.length} idle deals`);

    for (const deal of expiredDeals) {
      await this.cancelDeal(deal, 'TIMEOUT_IDLE');
    }
  }

  private async cancelPaymentExpired(now: Date): Promise<void> {
    const expiredEscrows = await this.escrowRepository.find({
      where: {
        status: In([EscrowStatus.AWAITING_PAYMENT, EscrowStatus.PAID_PARTIAL]),
        paymentDeadlineAt: LessThan(now),
      },
    });

    if (expiredEscrows.length === 0) {
      return;
    }

    this.logger.log(`Canceling ${expiredEscrows.length} payment-expired deals`);

    for (const escrow of expiredEscrows) {
      const deal = await this.dealRepository.findOne({
        where: { id: escrow.dealId },
      });
      if (!deal) {
        continue;
      }

      await this.escrowRepository.update(escrow.id, {
        status: EscrowStatus.FAILED,
      });
      await this.cancelDeal(deal, 'PAYMENT_TIMEOUT');

      const paidNano = BigInt(escrow.paidNano ?? '0');
      if (paidNano > 0n) {
        await this.paymentsService.refundEscrow(deal.id, 'PAYMENT_TIMEOUT');
      }
    }
  }

  private async cancelDeal(deal: DealEntity, reason: string): Promise<void> {
    await this.dealRepository.update(deal.id, {
      status: DealStatus.CANCELED,
      stage: DealStage.FINALIZED,
      cancelReason: reason,
      lastActivityAt: new Date(),
    });

    const reasonKey =
      reason === 'PAYMENT_TIMEOUT'
        ? 'telegram.deal.canceled.payment_timeout'
        : 'telegram.deal.canceled.idle_timeout';
    await this.dealsNotificationsService.notifyAdvertiser(deal, reasonKey);
    await this.dealsNotificationsService.notifyDealActionRequired(
      deal,
      'approval',
    );
  }
}

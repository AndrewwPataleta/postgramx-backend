import { DealStatus } from '../../../common/constants/deals/deal-status.constants';
import { DealStage } from '../../../common/constants/deals/deal-stage.constants';
import { EscrowStatus } from '../../../common/constants/deals/deal-escrow-status.constants';

export function mapStageToDealStatus(stage: DealStage): DealStatus {
  switch (stage) {
    case DealStage.CREATIVE_AWAITING_SUBMIT:
    case DealStage.CREATIVE_AWAITING_CONFIRM:
    case DealStage.CREATIVE_AWAITING_FOR_CHANGES:
    case DealStage.SCHEDULING_AWAITING_SUBMIT:
    case DealStage.SCHEDULING_AWAITING_CONFIRM:
    case DealStage.SCHEDULE_AWAITING_FOR_CHANGES:
    case DealStage.PAYMENT_AWAITING:
    case DealStage.PAYMENT_PARTIALLY_PAID:
      return DealStatus.PENDING;
    case DealStage.POST_SCHEDULED:
    case DealStage.POST_PUBLISHING:
    case DealStage.POSTED_VERIFYING:
    case DealStage.DELIVERY_CONFIRMED:
      return DealStatus.ACTIVE;
    case DealStage.REFUNDING:
      return DealStatus.CANCELED;
    case DealStage.FINALIZED:
      return DealStatus.COMPLETED;
    default:
      return DealStatus.PENDING;
  }
}

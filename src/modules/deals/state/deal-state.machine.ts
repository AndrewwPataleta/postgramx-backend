import { DealStage } from '../../../common/constants/deals/deal-stage.constants';
import { DEAL_STAGE_TRANSITIONS } from '../../../common/constants/deals/deal-transitions.constants';

const FINAL_STAGES = new Set<DealStage>([DealStage.FINALIZED]);

export class DealStateError extends Error {
  constructor(
    public readonly from: DealStage,
    public readonly to: DealStage,
  ) {
    super(`Invalid stage transition from ${from} to ${to}`);
    this.name = 'DealStateError';
  }
}

export function isTransitionAllowed(from: DealStage, to: DealStage): boolean {
  if (from === to) {
    return true;
  }

  if (to === DealStage.FINALIZED) {
    return !FINAL_STAGES.has(from);
  }

  return DEAL_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransitionAllowed(from: DealStage, to: DealStage): void {
  if (!isTransitionAllowed(from, to)) {
    throw new DealStateError(from, to);
  }
}

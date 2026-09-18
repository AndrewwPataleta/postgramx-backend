import { TransactionStatus } from '../../../common/constants/payments/transaction-status.constants';

const payoutTransitions: Record<TransactionStatus, TransactionStatus[]> = {
  [TransactionStatus.PENDING]: [
    TransactionStatus.AWAITING_CONFIRMATION,
    TransactionStatus.BLOCKED_LIQUIDITY,
    TransactionStatus.FAILED,
    TransactionStatus.CANCELED,
  ],
  [TransactionStatus.BLOCKED_LIQUIDITY]: [
    TransactionStatus.PENDING,
    TransactionStatus.AWAITING_CONFIRMATION,
    TransactionStatus.FAILED,
    TransactionStatus.CANCELED,
  ],

  [TransactionStatus.AWAITING_CONFIRMATION]: [
    TransactionStatus.CONFIRMED,
    TransactionStatus.COMPLETED,
    TransactionStatus.FAILED,
  ],
  [TransactionStatus.CONFIRMED]: [
    TransactionStatus.COMPLETED,
    TransactionStatus.FAILED,
  ],
  [TransactionStatus.PARTIAL]: [],
  [TransactionStatus.REFUNDED]: [],
  [TransactionStatus.COMPLETED]: [],
  [TransactionStatus.FAILED]: [],
  [TransactionStatus.CANCELED]: [],
};

export const ensureTransitionAllowed = (
  current: TransactionStatus,
  next: TransactionStatus,
): void => {
  const allowed = payoutTransitions[current] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(
      `Invalid payout status transition from ${current} to ${next}`,
    );
  }
};

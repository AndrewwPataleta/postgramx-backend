export const IDEMPOTENCY_PREFIX = {
  DEPOSIT: 'deposit:',
  PAYOUT: 'payout:',
  WITHDRAW: 'withdraw:',
  FEE: 'fee:',
  ESCROW_RELEASE: 'escrow_release:',
} as const;

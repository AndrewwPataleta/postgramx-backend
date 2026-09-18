export const PAYMENT_LOG_EVENTS = {
  INCOMING_PAYMENT: 'incoming_payment',
  AMBIGUOUS_OUTGOING_MATCH: 'ambiguous_outgoing_match',
  OUTGOING_CONFIRMED: 'outgoing_confirmed',
  OUTGOING_COMPLETED: 'outgoing_completed',
  OUTGOING_FAILED: 'outgoing_failed',
  FEE_REVENUE_MISSING_TX_HASH: 'fee_revenue_missing_tx_hash',
  FEE_REVENUE_BROADCASTED: 'fee_revenue_broadcasted',
  FEE_REVENUE_FAILED: 'fee_revenue_failed',
} as const;

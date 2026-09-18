export enum DealErrorCode {
  DEAL_NOT_FOUND = 'deal.not_found',
  LISTING_NOT_FOUND = 'deal.listing_not_found',
  LISTING_DISABLED = 'deal.listing_disabled',
  UNAUTHORIZED = 'deal.unauthorized',
  INVALID_SCHEDULE_TIME = 'deal.invalid_schedule_time',
  SCHEDULE_CONFIRM_TOO_LATE = 'SCHEDULE_CONFIRM_TOO_LATE',
  INVALID_STATUS = 'deal.invalid_status',
  SELF_DEAL_NOT_ALLOWED = 'deal.self_deal_not_allowed',
  ACTIVE_PENDING_LIMIT_REACHED = 'deal.active_pending_limit_reached',
  DEADLINE_PASSED = 'deal.deadline_passed',
  CREATIVE_NOT_SUBMITTED = 'deal.creative_not_submitted',
  PAYMENT_TIMEOUT = 'deal.payment_timeout',
  CREATIVE_TIMEOUT = 'deal.creative_timeout',
}

export enum BalanceErrorCode {
  CURRENCY_UNSUPPORTED = 'balance.currency_unsupported',
}

export enum PayoutErrorCode {
  WALLET_NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INSUFFICIENT_LIQUIDITY = 'INSUFFICIENT_LIQUIDITY',
  BLOCKED_LIQUIDITY = 'BLOCKED_LIQUIDITY',
  PAYOUT_ALREADY_IN_PROGRESS = 'PAYOUT_ALREADY_IN_PROGRESS',
  DAILY_WITHDRAW_LIMIT = 'DAILY_WITHDRAW_LIMIT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

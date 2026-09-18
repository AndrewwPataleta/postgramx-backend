export const CRON = {
  TON_INCOMING_WATCHER: '* * * * *',
  TON_OUTGOING_WATCHER: '* * * * *',
  TELEGRAM_ADMIN_SYNC: '*/10 * * * *',
} as const;

export const CRON_JOB_NAMES = {
  PAYOUT_EXECUTION: 'payout-execution',
} as const;

import { Logger } from '@nestjs/common';

const logger = new Logger('PaymentsConfig');

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const PAYMENTS_CONFIG = {
  SETTLEMENT_CRON_INTERVAL_MINUTES: parseNumber(
    process.env.SETTLEMENT_CRON_INTERVAL_MINUTES,
    5,
  ),
  VERIFY_WINDOW_HOURS: parseNumber(process.env.VERIFY_WINDOW_HOURS, 24),
  PAYMENT_WINDOW_MINUTES: parseNumber(process.env.PAYMENT_WINDOW_MINUTES, 60),
  HOT_WALLET_MNEMONIC: process.env.HOT_WALLET_MNEMONIC ?? null,
  HOT_WALLET_ADDRESS: process.env.HOT_WALLET_ADDRESS ?? null,
  DEPOSIT_WALLET_MASTER_KEY: process.env.DEPOSIT_WALLET_MASTER_KEY ?? null,
};

logger.log(
  [
    'Payments config loaded',
    `settlementIntervalMinutes=${PAYMENTS_CONFIG.SETTLEMENT_CRON_INTERVAL_MINUTES}`,
    `verifyWindowHours=${PAYMENTS_CONFIG.VERIFY_WINDOW_HOURS}`,
    `paymentWindowMinutes=${PAYMENTS_CONFIG.PAYMENT_WINDOW_MINUTES}`,
    `hotWalletConfigured=${Boolean(PAYMENTS_CONFIG.HOT_WALLET_MNEMONIC)}`,
    `depositWalletMasterKeyConfigured=${Boolean(
      PAYMENTS_CONFIG.DEPOSIT_WALLET_MASTER_KEY,
    )}`,
  ].join(' | '),
);

export const SETTLEMENT_CRON = `*/${PAYMENTS_CONFIG.SETTLEMENT_CRON_INTERVAL_MINUTES} * * * *`;

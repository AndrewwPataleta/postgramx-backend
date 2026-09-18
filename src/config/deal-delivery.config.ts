import { Logger } from '@nestjs/common';

const logger = new Logger('DealDeliveryConfig');

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

export const DEAL_DELIVERY_CONFIG = {
  POSTING_CRON_EVERY_SECONDS: parseNumber(
    process.env.DEALS_POSTING_CRON_EVERY_SECONDS,
    15,
  ),
  POSTING_LOOKAHEAD_SECONDS: parseNumber(
    process.env.DEALS_POSTING_LOOKAHEAD_SECONDS,
    60,
  ),
  POSTING_LOCK_TTL_SECONDS: parseNumber(
    process.env.DEALS_POSTING_LOCK_TTL_SECONDS,
    120,
  ),
};

const normalizedPostingCronSeconds = Math.max(
  60,
  Math.floor(DEAL_DELIVERY_CONFIG.POSTING_CRON_EVERY_SECONDS),
);

const postingCronEveryMinutes = Math.max(
  1,
  Math.floor(normalizedPostingCronSeconds / 60),
);

logger.log(
  `Deal delivery cron every ${postingCronEveryMinutes}m (requested ${DEAL_DELIVERY_CONFIG.POSTING_CRON_EVERY_SECONDS}s), lookahead ${DEAL_DELIVERY_CONFIG.POSTING_LOOKAHEAD_SECONDS}s`,
);

export const DEAL_DELIVERY_POSTING_CRON =
  postingCronEveryMinutes === 1
    ? '* * * * *'
    : `*/${postingCronEveryMinutes} * * * *`;

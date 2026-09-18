import { Logger } from '@nestjs/common';
import { DEAL_TIMEOUTS } from '../common/constants/deals/deal-timeouts.constants';

const logger = new Logger('DealsConfig');

const isStageOrProduction = ['stage', 'production'].includes(
  process.env.NODE_ENV ?? 'local',
);
const defaultChecksIntervalMinutes = isStageOrProduction ? 1 : 1;

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

const parseNonNegativeNumber = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const parseBoolean = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value === 'true';
};

export const DEALS_CONFIG = {
  MAX_ACTIVE_PENDING_DEALS_PER_LISTING_PER_USER: parseNumber(
    process.env.MAX_ACTIVE_PENDING_DEALS_PER_LISTING_PER_USER,
    3,
  ),
  DEAL_IDLE_EXPIRE_MINUTES: parseNumber(
    process.env.DEAL_IDLE_EXPIRE_MINUTES,
    DEAL_TIMEOUTS.PRE_DEAL_EXPIRE_MINUTES,
  ),
  SCHEDULE_SUBMIT_DEADLINE_MINUTES: parseNumber(
    process.env.CREATIVE_SUBMIT_DEADLINE_MINUTES,
    DEAL_TIMEOUTS.CREATIVE_SUBMIT_MINUTES,
  ),
  CREATIVE_SUBMIT_DEADLINE_MINUTES: parseNumber(
    process.env.CREATIVE_SUBMIT_DEADLINE_MINUTES,
    DEAL_TIMEOUTS.CREATIVE_SUBMIT_MINUTES,
  ),
  ADMIN_RESPONSE_DEADLINE_HOURS: parseNumber(
    process.env.ADMIN_RESPONSE_DEADLINE_HOURS,
    DEAL_TIMEOUTS.ADMIN_REVIEW_HOURS,
  ),
  PAYMENT_DEADLINE_MINUTES: parseNumber(
    process.env.DEAL_PAYMENT_TIMEOUT_MINUTES,
    DEAL_TIMEOUTS.PAYMENT_WINDOW_MINUTES,
  ),
  REMINDER_BEFORE_EXPIRE_MINUTES: parseNumber(
    process.env.REMINDER_BEFORE_EXPIRE_MINUTES,
    60,
  ),
  REMINDER_BEFORE_ADMIN_DEADLINE_MINUTES: parseNumber(
    process.env.REMINDER_BEFORE_ADMIN_DEADLINE_MINUTES,
    60,
  ),
  REMINDER_BEFORE_PAYMENT_DEADLINE_MINUTES: parseNumber(
    process.env.REMINDER_BEFORE_PAYMENT_DEADLINE_MINUTES,
    60,
  ),
  CRON_INTERVAL_MINUTES: parseNumber(
    process.env.DEAL_TIMEOUTS_CRON_INTERVAL_MINUTES,
    defaultChecksIntervalMinutes,
  ),
  AUTO_ADMIN_APPROVE: parseBoolean(process.env.AUTO_ADMIN_APPROVE, false),
  AUTO_DEAL_COMPLETE: parseBoolean(process.env.VITE_AUTO_DEAL_COMPLETE, false),
  MOCK_CREATIVE_APPROVE: process.env.DEALS_MOCK_CREATIVE_APPROVE === 'true',
  SCHEDULE_CONFIRM_GRACE_SECONDS: parseNonNegativeNumber(
    process.env.SCHEDULE_CONFIRM_GRACE_SECONDS,
    0,
  ),
  SCHEDULE_LATE_NOTIFY_DEDUPE_SECONDS: parseNonNegativeNumber(
    process.env.SCHEDULE_LATE_NOTIFY_DEDUPE_SECONDS,
    600,
  ),
};

if (
  process.env.NODE_ENV === 'production' &&
  DEALS_CONFIG.MOCK_CREATIVE_APPROVE
) {
  logger.error(
    'MOCK_CREATIVE_APPROVE cannot be enabled in production. Forcing OFF.',
  );
  DEALS_CONFIG.MOCK_CREATIVE_APPROVE = false;
}

logger.log(
  `Deals mock creative approve: ${
    DEALS_CONFIG.MOCK_CREATIVE_APPROVE ? 'enabled' : 'disabled'
  }`,
);

export const DEAL_TIMEOUTS_CRON = `*/${DEALS_CONFIG.CRON_INTERVAL_MINUTES} * * * *`;

export const PIN_VISIBILITY_CONFIG = {
  CRON:
    process.env.PIN_CHECK_CRON ?? `*/${defaultChecksIntervalMinutes} * * * *`,
  MISSING_GRACE_CHECKS: parseNumber(process.env.PIN_MISSING_GRACE_CHECKS, 1),
  BATCH_LIMIT: parseNumber(process.env.PIN_CHECK_BATCH_LIMIT, 50),
  MIN_POST_AGE_MINUTES: parseNumber(
    process.env.PIN_CHECK_MIN_POST_AGE_MINUTES,
    10,
  ),
  ALERTS_TO_ALL_REVIEWERS: parseBoolean(
    process.env.PIN_ALERTS_TO_ALL_REVIEWERS,
    true,
  ),
};

export const POST_EDIT_MONITOR_CONFIG = {
  CRON:
    process.env.POST_EDIT_CHECK_CRON ??
    `*/${defaultChecksIntervalMinutes} * * * *`,
};

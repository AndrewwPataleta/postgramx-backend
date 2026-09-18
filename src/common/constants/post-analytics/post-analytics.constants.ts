export enum DealPostAnalyticsTrackingStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum DealPostAnalyticsLinkType {
  TG_CHANNEL = 'TG_CHANNEL',
  TG_INVITE = 'TG_INVITE',
  TG_BOT = 'TG_BOT',
  EXTERNAL = 'EXTERNAL',
}

export enum DealPostAnalyticsLinkTrackingStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  UNAVAILABLE = 'UNAVAILABLE',
}

export const POST_ANALYTICS_CONFIG_DEFAULTS = {
  ENABLED: true,
  SAMPLE_CRON: '0 */5 * * * *',
  FINALIZE_CRON: '30 */10 * * * *',
  DEFAULT_WINDOW_HOURS: 24,
} as const;

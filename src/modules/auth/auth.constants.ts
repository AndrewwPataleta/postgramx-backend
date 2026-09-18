export const SUPPORTED_AUTH_TYPES = ['telegram'] as const;
export type SupportedAuthType = (typeof SUPPORTED_AUTH_TYPES)[number];

export const SUPPORTED_PLATFORM_TYPES = ['telegram'] as const;
export type SupportedPlatformType = (typeof SUPPORTED_PLATFORM_TYPES)[number];

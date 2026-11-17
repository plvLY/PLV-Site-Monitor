export const SYSTEM_SETTINGS_ID = 1;

export const SYSTEM_SETTINGS_DEFAULTS = {
  eventRetentionDays: 90,
  ipRetentionDays: 30,
  userAgentRetentionDays: 30,
  storeRawIp: true,
} as const;

export const SYSTEM_SETTINGS_LIMITS = {
  eventRetentionDays: { min: 1, max: 90 },
  ipRetentionDays: { min: 1, max: 30 },
  userAgentRetentionDays: { min: 1, max: 30 },
} as const;

export interface SystemSettingsDto {
  retention: {
    event_retention_days: number;
    ip_retention_days: number;
    user_agent_retention_days: number;
  };
  privacy: {
    store_raw_ip: boolean;
  };
  rate_limit: {
    site_rate_limit_max_requests: number;
  };
}

export interface SystemSettingsPatch {
  eventRetentionDays?: number;
  ipRetentionDays?: number;
  userAgentRetentionDays?: number;
  storeRawIp?: boolean;
  siteRateLimitMaxRequests?: number;
}
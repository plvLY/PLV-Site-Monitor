
/**
 * 系统数据保留策略。
 * 字段命名与后端 SystemSettingsDto 保持一致。
 */
export interface RetentionSettings {
  event_retention_days: number;
  ip_retention_days: number;
  user_agent_retention_days: number;
}

/**
 * 系统隐私设置。
 */
export interface PrivacySettings {
  store_raw_ip: boolean;
}

/**
 * 站点采集限流设置。
 * 时间窗口固定为 60 秒，不开放配置。
 */
export interface RateLimitSettings {
  site_rate_limit_max_requests: number;
}

/**
 * GET /api/settings 返回的数据结构。
 */
export interface SystemSettings {
  retention: RetentionSettings;
  privacy: PrivacySettings;
  rate_limit: RateLimitSettings;
}

/**
 * PATCH /api/settings 请求结构。
 * 支持部分更新，未提交的字段不会被覆盖。
 */
export interface SystemSettingsPatch {
  retention?: Partial<RetentionSettings>;
  privacy?: Partial<PrivacySettings>;
  rate_limit?: Partial<RateLimitSettings>;
}

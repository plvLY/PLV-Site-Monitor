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
 * GET /api/settings 返回的数据结构。
 */
export interface SystemSettings {
  retention: RetentionSettings;
  privacy: PrivacySettings;
}

/**
 * PATCH /api/settings 请求结构。
 * 支持部分更新，字段命名与后端 Validator 保持一致。
 */
export interface SystemSettingsPatch {
  retention?: Partial<RetentionSettings>;
  privacy?: Partial<PrivacySettings>;
}
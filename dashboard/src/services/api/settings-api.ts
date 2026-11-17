import { apiClient } from './client';
import type {
  SystemSettings,
  SystemSettingsPatch,
} from '../../types/settings';

/**
 * 获取系统设置。
 */
export function getSystemSettings() {
  return apiClient.get<
    SystemSettings,
    Record<string, unknown>
  >('/api/settings');
}

/**
 * 更新系统设置。
 * 支持部分更新，未提交的字段不会被覆盖。
 */
export function updateSystemSettings(
  patch: SystemSettingsPatch,
) {
  return apiClient.patch<
    SystemSettings,
    Record<string, unknown>,
    SystemSettingsPatch
  >('/api/settings', patch);
}
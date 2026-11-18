
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import PageContainer from '../components/common/PageContainer.vue'
import {
  getSystemSettings,
  updateSystemSettings,
} from '../services/api/settings-api'
import type {
  SystemSettings,
  SystemSettingsPatch,
} from '../types/settings'

const DEFAULT_SETTINGS: SystemSettings = {
  retention: {
    event_retention_days: 90,
    ip_retention_days: 30,
    user_agent_retention_days: 30,
  },
  privacy: {
    store_raw_ip: true,
  },
  rate_limit: {
    site_rate_limit_max_requests: 600,
  },
}

const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const validationMessage = ref('')

const settings = ref<SystemSettings>(structuredClone(DEFAULT_SETTINGS))
const originalSettings = ref<SystemSettings | null>(null)

const hasChanges = computed(() => {
  if (!originalSettings.value) return false

  return JSON.stringify(settings.value) !==
    JSON.stringify(originalSettings.value)
})

const retentionFields = [
  {
    key: 'event_retention_days',
    label: '原始事件',
    description: '页面访问事件及相关原始记录',
    min: 1,
    max: 90,
  },
  {
    key: 'ip_retention_days',
    label: '原始 IP',
    description: '访问者 IP 地址原始数据',
    min: 1,
    max: 30,
  },
  {
    key: 'user_agent_retention_days',
    label: 'User-Agent',
    description: '浏览器及设备识别原始信息',
    min: 1,
    max: 30,
  },
] as const

function cloneSettings(value: SystemSettings): SystemSettings {
  return {
    retention: { ...value.retention },
    privacy: { ...value.privacy },
    rate_limit: { ...value.rate_limit },
  }
}

function validateSettings(): boolean {
  validationMessage.value = ''

  for (const field of retentionFields) {
    const value = settings.value.retention[field.key]

    if (
      !Number.isInteger(value) ||
      value < field.min ||
      value > field.max
    ) {
      validationMessage.value =
        `${field.label}保留期限必须是 ${field.min} 至 ${field.max} 之间的整数。`
      return false
    }
  }

  if (typeof settings.value.privacy.store_raw_ip !== 'boolean') {
    validationMessage.value = '原始 IP 存储设置无效。'
    return false
  }

    const maxRequests =
    settings.value.rate_limit.site_rate_limit_max_requests

  if (
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 10000
  ) {
    validationMessage.value =
      '每站点每 60 秒最大请求数必须是 1 至 10000 之间的整数。'
    return false
  }

  return true
}

function buildPatch(): SystemSettingsPatch {
  if (!originalSettings.value) return {}

  const previous = originalSettings.value
  const current = settings.value

  const retention: SystemSettingsPatch['retention'] = {}
  const privacy: SystemSettingsPatch['privacy'] = {}

  const rateLimit: SystemSettingsPatch['rate_limit'] = {}

  if (
    current.rate_limit.site_rate_limit_max_requests !==
    previous.rate_limit.site_rate_limit_max_requests
  ) {
    rateLimit.site_rate_limit_max_requests =
      current.rate_limit.site_rate_limit_max_requests
  }


  if (
    current.retention.event_retention_days !==
    previous.retention.event_retention_days
  ) {
    retention.event_retention_days =
      current.retention.event_retention_days
  }

  if (
    current.retention.ip_retention_days !==
    previous.retention.ip_retention_days
  ) {
    retention.ip_retention_days =
      current.retention.ip_retention_days
  }

  if (
    current.retention.user_agent_retention_days !==
    previous.retention.user_agent_retention_days
  ) {
    retention.user_agent_retention_days =
      current.retention.user_agent_retention_days
  }

  if (
    current.privacy.store_raw_ip !==
    previous.privacy.store_raw_ip
  ) {
    privacy.store_raw_ip = current.privacy.store_raw_ip
  }

  const patch: SystemSettingsPatch = {}

  if (Object.keys(retention).length > 0) {
    patch.retention = retention
  }

  if (Object.keys(privacy).length > 0) {
    patch.privacy = privacy
  }

  if (Object.keys(rateLimit).length > 0) {
    patch.rate_limit = rateLimit
  }

  return patch
}

async function loadSettings() {
  loading.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    const response = await getSystemSettings()
    settings.value = cloneSettings(response.data)
    originalSettings.value = cloneSettings(response.data)
  } catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : '获取系统设置失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (saving.value || !hasChanges.value) return
  if (!validateSettings()) return

  const patch = buildPatch()

  if (Object.keys(patch).length === 0) return

  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  validationMessage.value = ''

  try {
    const response = await updateSystemSettings(patch)

    settings.value = cloneSettings(response.data)
    originalSettings.value = cloneSettings(response.data)

    successMessage.value = '系统设置已成功保存。'
  } catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : '保存系统设置失败，请稍后重试。'
  } finally {
    saving.value = false
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasChanges.value || saving.value) return

  event.preventDefault()
  event.returnValue = ''
}

const showLeaveConfirm = ref(false)

let leaveConfirmResolver: ((confirmed: boolean) => void) | null = null

function confirmLeavePage(): Promise<boolean> {
  showLeaveConfirm.value = true

  return new Promise((resolve) => {
    leaveConfirmResolver = resolve
  })
}

function resolveLeave(confirmed: boolean) {
  showLeaveConfirm.value = false
  leaveConfirmResolver?.(confirmed)
  leaveConfirmResolver = null
}

onBeforeRouteLeave(async () => {
  if (saving.value) return false
  if (!hasChanges.value) return true

  return await confirmLeavePage()
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  void loadSettings()
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <PageContainer
    title="系统设置"
    description="管理数据保留策略与隐私配置。"
  >
    <div class="settings-page">
      <div v-if="loading" class="settings-state-card">
        <div class="settings-spinner" />
        <p>正在加载系统设置...</p>
      </div>

      <div v-else-if="errorMessage && !originalSettings" class="settings-state-card">
        <div class="settings-state-icon">!</div>
        <h2>无法加载系统设置</h2>
        <p>{{ errorMessage }}</p>
        <button class="settings-button settings-button-primary" @click="loadSettings">
          重新加载
        </button>
      </div>

      <template v-else-if="originalSettings">
        <div class="settings-section">
          <div class="settings-section-heading">
            <div>
              <h2>数据保留策略</h2>
              <p>配置原始数据的自动清理周期。</p>
            </div>
            <span class="settings-section-tag">DATA RETENTION</span>
          </div>

          <div class="settings-card">
            <div
              v-for="(field, index) in retentionFields"
              :key="field.key"
              class="retention-row"
              :class="{ 'retention-row-last': index === retentionFields.length - 1 }"
            >
              <div class="retention-info">
                <label :for="field.key">{{ field.label }}</label>
                <p>{{ field.description }}</p>
              </div>

              <div class="retention-control">
                <input
                  :id="field.key"
                  v-model.number="settings.retention[field.key]"
                  type="number"
                  :min="field.min"
                  :max="field.max"
                  :disabled="saving"
                />
                <span>天</span>
                <small>最多 {{ field.max }} 天</small>
              </div>
            </div>

            <div class="settings-card-note">
              <span class="note-icon">i</span>
              <p>
                原始事件最长保留 90 天，原始 IP 和 User-Agent
                最长保留 30 天。历史统计汇总数据不受原始数据清理影响。
              </p>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-heading">
            <div>
              <h2>隐私与数据处理</h2>
              <p>控制访问者原始 IP 地址的存储行为。</p>
            </div>
            <span class="settings-section-tag">PRIVACY</span>
          </div>

          <div class="settings-card">
            <div class="privacy-row">
              <div class="privacy-info">
                <h3>保存原始 IP 地址</h3>
                <p>
                  开启后保存访问者原始 IP，用于数据分析和管理。
                </p>
              </div>

              <label class="settings-switch">
                <input
                  v-model="settings.privacy.store_raw_ip"
                  type="checkbox"
                  :disabled="saving"
                />
                <span class="settings-switch-slider" />
              </label>
            </div>

            <div
              class="privacy-status"
              :class="settings.privacy.store_raw_ip
                ? 'privacy-status-enabled'
                : 'privacy-status-disabled'"
            >
              <span class="privacy-status-dot" />
              <span>
                {{ settings.privacy.store_raw_ip
                  ? '当前允许保存原始 IP 地址'
                  : '隐私模式已开启：停止保存原始 IP 地址' }}
              </span>
            </div>

            <div class="settings-card-note">
              <span class="note-icon">i</span>
              <p>
                关闭原始 IP 存储后，系统仍保留 Geo 国家、地区和城市分析信息。
                此设置不会删除此前已经保存的 IP 数据。
              </p>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-heading">
            <div>
              <h2>采集请求限流</h2>
              <p>控制单个站点在固定时间窗口内允许接收的采集请求数量。</p>
            </div>
            <span class="settings-section-tag">RATE LIMIT</span>
          </div>

          <div class="settings-card">
            <div class="retention-row">
              <div class="retention-info">
                <label for="site-rate-limit-max-requests">
                  每站点最大请求数
                </label>
                <p>
                  每个站点独立计算，超过限制的采集请求将被拒绝。
                </p>
              </div>

              <div class="retention-control">
                <input
                  id="site-rate-limit-max-requests"
                  v-model.number="settings.rate_limit.site_rate_limit_max_requests"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  :disabled="saving"
                />
                <span>次</span>
                <small>1–10000</small>
              </div>
            </div>

            <div class="settings-card-note">
              <span class="note-icon">i</span>
              <p>
                限流窗口固定为 60 秒，不支持修改。
                默认每个站点每 60 秒最多接收 600 次采集请求。
                不同站点分别计算限流额度。
              </p>
            </div>
          </div>
        </div>

        <div v-if="validationMessage" class="settings-message settings-message-warning">
          {{ validationMessage }}
        </div>

        <div v-if="errorMessage" class="settings-message settings-message-error">
          {{ errorMessage }}
        </div>

        <div v-if="successMessage" class="settings-message settings-message-success">
          {{ successMessage }}
        </div>

        <div class="settings-actions">
          <span class="settings-dirty-hint">
            {{ hasChanges ? '有尚未保存的修改' : '所有设置均已保存' }}
          </span>

          <button
            class="settings-button settings-button-primary"
            :disabled="!hasChanges || saving"
            @click="saveSettings"
          >
            {{ saving ? '正在保存...' : '保存设置' }}
          </button>
        </div>
      </template>
    </div>

    <Teleport to="body">
      <Transition name="settings-dialog">
        <div
          v-if="showLeaveConfirm"
          class="settings-dialog-overlay"
          @click.self="resolveLeave(false)"
          @keydown.esc.prevent="resolveLeave(false)"
          tabindex="-1"
        >
          <section
            class="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-dialog-title"
          >
            <div class="settings-dialog-icon">
              <span>!</span>
            </div>

            <h2 id="leave-dialog-title">放弃未保存的更改？</h2>

            <p>
              当前页面有尚未保存的设置修改。
              如果现在离开，修改内容将不会被保存。
            </p>

            <div class="settings-dialog-actions">
              <button
                type="button"
                class="settings-button settings-button-secondary"
                @click="resolveLeave(false)"
              >
                继续编辑
              </button>

              <button
                type="button"
                class="settings-button settings-button-danger"
                @click="resolveLeave(true)"
              >
                放弃更改
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </PageContainer>
</template>

<style scoped>
.settings-page {
  width: 100%;
  max-width: 1000px;
}

.settings-section {
  margin-bottom: 26px;
}

.settings-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 15px;
}

.settings-section-heading h2 {
  margin: 0;
  color: #334155;
  font-size: 15px;
  font-weight: 650;
}

.settings-section-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.settings-section-tag {
  flex-shrink: 0;
  padding: 6px 9px;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.7px;
}

.settings-card {
  overflow: hidden;
  padding: 0 22px;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 12px;
}

.retention-row,
.privacy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 88px;
  border-bottom: 1px solid #edf1f4;
}

.retention-row-last {
  border-bottom: 0;
}

.retention-info label,
.privacy-info h3 {
  display: block;
  margin: 0;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.retention-info p,
.privacy-info p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.6;
}

.retention-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.retention-control input {
  width: 82px;
  height: 36px;
  padding: 0 10px;
  color: #334155;
  background: #fff;
  border: 1px solid #dce5eb;
  border-radius: 7px;
  font: inherit;
  font-size: 13px;
  outline: none;
}

.retention-control input:focus {
  border-color: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
}

.retention-control input:disabled {
  background: #f8fafc;
}

.retention-control > span {
  color: #64748b;
  font-size: 12px;
}

.retention-control small {
  min-width: 65px;
  color: #94a3b8;
  font-size: 10px;
}

.settings-card-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 -22px;
  padding: 15px 22px;
  background: #f8fafc;
  border-top: 1px solid #edf1f4;
}

.note-icon {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 17px;
  height: 17px;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
}

.settings-card-note p {
  margin: 0;
  color: #8491a3;
  font-size: 11px;
  line-height: 1.7;
}

.privacy-row {
  min-height: 96px;
  border-bottom: 0;
}

.settings-switch {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  width: 43px;
  height: 24px;
  cursor: pointer;
}

.settings-switch input {
  width: 0;
  height: 0;
  opacity: 0;
}

.settings-switch-slider {
  position: absolute;
  inset: 0;
  background: #cbd5e1;
  border-radius: 20px;
  transition: background 0.2s;
}

.settings-switch-slider::before {
  position: absolute;
  bottom: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 50%;
  content: '';
  transition: transform 0.2s;
}

.settings-switch input:checked + .settings-switch-slider {
  background: #14b8a6;
}

.settings-switch input:checked + .settings-switch-slider::before {
  transform: translateX(19px);
}

.settings-switch input:focus-visible + .settings-switch-slider {
  outline: 3px solid rgba(20, 184, 166, 0.2);
  outline-offset: 2px;
}

.settings-switch input:disabled + .settings-switch-slider {
  opacity: 0.55;
  cursor: not-allowed;
}

.privacy-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 15px;
  color: #64748b;
  font-size: 11px;
}

.privacy-status-dot {
  width: 7px;
  height: 7px;
  background: currentColor;
  border-radius: 50%;
}

.privacy-status-enabled {
  color: #0f9488;
}

.privacy-status-disabled {
  color: #b45309;
}

.settings-message {
  margin-top: 15px;
  padding: 12px 15px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
}

.settings-message-warning {
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
}

.settings-message-error {
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
}

.settings-message-success {
  color: #0f766e;
  background: #effaf8;
  border: 1px solid #c9e9e4;
}

.settings-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid #e9eef2;
}

.settings-dirty-hint {
  color: #94a3b8;
  font-size: 11px;
}

.settings-button {
  min-height: 37px;
  padding: 0 17px;
  border: 0;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.18s, opacity 0.18s;
}

.settings-button-primary {
  color: #fff;
  background: #0f9488;
}

.settings-button-primary:hover:not(:disabled) {
  background: #0f766e;
}

.settings-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.settings-state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  padding: 32px;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  text-align: center;
}

.settings-state-card h2 {
  margin: 12px 0 0;
  color: #334155;
  font-size: 15px;
}

.settings-state-card p {
  margin: 10px 0 18px;
  color: #94a3b8;
  font-size: 12px;
}

.settings-state-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  color: #b45309;
  background: #fffbeb;
  border-radius: 50%;
  font-size: 20px;
  font-weight: 700;
}

.settings-spinner {
  width: 27px;
  height: 27px;
  border: 3px solid #e2f3f0;
  border-top-color: #0f9488;
  border-radius: 50%;
  animation: settings-spin 0.8s linear infinite;
}

@keyframes settings-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 560px) {
  .settings-section-heading {
    align-items: flex-start;
  }

  .settings-section-tag {
    font-size: 8px;
  }

  .settings-card {
    padding: 0 15px;
  }

  .retention-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
    padding: 17px 0;
  }

  .retention-control {
    width: 100%;
    flex-wrap: wrap;
  }

  .retention-control small {
    margin-left: auto;
  }

  .settings-card-note {
    margin: 0 -15px;
    padding: 13px 15px;
  }

  .privacy-row {
    gap: 12px;
  }

  .settings-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .settings-button-primary {
    width: 100%;
  }
}

.settings-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(15 23 42 / 42%);
  backdrop-filter: blur(3px);
}

.settings-dialog {
  width: 100%;
  max-width: 420px;
  padding: 28px;
  border: 1px solid #e9eef2;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 20px 60px rgb(15 23 42 / 18%);
}

.settings-dialog-icon {
  display: flex;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
  border-radius: 12px;
  background: #fff7ed;
  color: #d97706;
  font-size: 22px;
  font-weight: 700;
}

.settings-dialog h2 {
  margin: 0;
  color: #1f2937;
  font-size: 19px;
  font-weight: 650;
}

.settings-dialog p {
  margin: 12px 0 24px;
  color: #64748b;
  font-size: 14px;
  line-height: 1.7;
}

.settings-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.settings-button-secondary {
  border: 1px solid #dce3e9;
  background: #fff;
  color: #475569;
}

.settings-button-danger {
  border: 1px solid #b45309;
  background: #b45309;
  color: #fff;
}

.settings-button-danger:hover {
  background: #92400e;
}

.settings-dialog-enter-active,
.settings-dialog-leave-active {
  transition: opacity 0.18s ease;
}

.settings-dialog-enter-active .settings-dialog,
.settings-dialog-leave-active .settings-dialog {
  transition: transform 0.18s ease;
}

.settings-dialog-enter-from,
.settings-dialog-leave-to {
  opacity: 0;
}

.settings-dialog-enter-from .settings-dialog,
.settings-dialog-leave-to .settings-dialog {
  transform: translateY(8px) scale(0.98);
}

@media (max-width: 480px) {
  .settings-dialog {
    padding: 22px;
  }

  .settings-dialog-actions {
    flex-direction: column-reverse;
  }

  .settings-dialog-actions button {
    width: 100%;
  }
}
</style>

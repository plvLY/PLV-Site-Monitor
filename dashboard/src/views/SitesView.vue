
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { apiBaseUrl } from '../services/api/client'
import { buildTrackerSnippet } from '../utils/tracker-snippet'
import {
  RefreshCw,
  Globe,
  Plus,
  Pencil,
  Pause,
  Play,
  AlertTriangle,
  CheckCircle2,
  X,
  Trash2,
  Archive,
  RotateCcw,
  Copy,
} from 'lucide-vue-next'

import { useSitesData } from '../composables/useSitesData'
import type {
  SiteListItem,
  SiteStatus,
} from '../types/sites'

import type {
  CreateSiteRequest,
  UpdateSiteRequest,
} from '../services/api/sites-api'

import PageContainer from '../components/common/PageContainer.vue'

const store = useAppStore()

const {
  items,
  loading,
  error,
  page,
  total,
  totalPages,
  hasData,
  canPrevious,
  canNext,
  goToPage,
  retry,
  createSite,
  updateSite,
  updateSiteStatus,
  mutationLoading,
  mutationError,
  clearMutationError,
} = useSitesData()

const pageMutationError = ref('')

// 最近一次成功创建的站点及其 Tracker 接入代码
const generatedTracker = ref<{
  site: SiteListItem
  snippet: string
} | null>(null)

const trackerDialogVisible = ref(false)
const trackerCopyStatus = ref('')

const statusDialog = ref<{
  site: SiteListItem
  nextStatus: SiteStatus
} | null>(null)

const pageDescription = '管理需要接入 PLV Site Monitor 的网站及其域名。'

const paginationText = computed(() => {
  if (total.value === 0) {
    return '暂无站点'
  }

  return `第 ${page.value} 页，共 ${totalPages.value} 页`
})

function getValidDomains(site: SiteListItem) {
  if (!Array.isArray(site.domains)) {
    return []
  }

  return site.domains.filter(
    (item) =>
      item &&
      typeof item.domain === 'string' &&
      typeof item.is_primary === 'boolean',
  )
}

function primaryDomain(site: SiteListItem): string {
  const domains = getValidDomains(site)

  const primary = domains.find(
    (item) => item.is_primary,
  )

  return (
    primary?.domain ??
    domains[0]?.domain ??
    '尚未配置域名'
  )
}

function additionalDomainCount(site: SiteListItem): number {
  return Math.max(getValidDomains(site).length - 1, 0)
}

function statusLabel(status: SiteStatus): string {
  const labels: Record<SiteStatus, string> = {
    active: '运行中',
    disabled: '已禁用',
    archived: '已归档',
  }

  return labels[status]
}

const dialogVisible = ref(false)
const editingSite = ref<SiteListItem | null>(null)

const form = ref({
  name: '',
  timezone: 'UTC',
  domains: [{ domain: '', is_primary: true }],
})

const formError = ref('')

const dialogTitle = computed(() =>
  editingSite.value ? '编辑站点' : '新增站点',
)

function resetForm() {
  form.value = {
    name: '',
    timezone: 'UTC',
    domains: [{ domain: '', is_primary: true }],
  }
  formError.value = ''
  clearMutationError()
}

function openCreateDialog() {
  editingSite.value = null
  resetForm()
  dialogVisible.value = true
}

function openEditDialog(site: SiteListItem) {
  editingSite.value = site
  form.value = {
    name: site.name,
    timezone: site.timezone,
    domains: site.domains.length
      ? site.domains.map((item) => ({
          domain: item.domain,
          is_primary: item.is_primary,
        }))
      : [{ domain: '', is_primary: true }],
  }

  formError.value = ''
  clearMutationError()
  dialogVisible.value = true
}

function closeDialog() {
  if (mutationLoading.value) return

  dialogVisible.value = false
  editingSite.value = null
  resetForm()
}

function addDomain() {
  if (form.value.domains.length >= 50) {
    formError.value = '最多只能配置 50 个域名。'
    return
  }

  formError.value = ''

  form.value.domains.push({
    domain: '',
    is_primary: false,
  })
}

function removeDomain(index: number) {
  if (form.value.domains.length <= 1) {
    form.value.domains = [{
      domain: '',
      is_primary: true,
    }]
    return
  }

  const removedPrimary = form.value.domains[index]?.is_primary

  form.value.domains.splice(index, 1)

  if (removedPrimary && form.value.domains[0]) {
    form.value.domains[0].is_primary = true
  }
}

function setPrimaryDomain(index: number) {
  form.value.domains.forEach((domain, currentIndex) => {
    domain.is_primary = currentIndex === index
  })
}

function normalizeDomains() {
  return form.value.domains
    .map((item) => ({
      domain: item.domain.trim().toLowerCase(),
      is_primary: item.is_primary,
    }))
    .filter((item) => item.domain.length > 0)
}

function validateForm(): boolean {
  if (!form.value.name.trim()) {
    formError.value = '请输入站点名称。'
    return false
  }

  if (form.value.name.trim().length > 100) {
    formError.value = '站点名称不能超过 100 个字符。'
    return false
  }

  if (!form.value.timezone.trim()) {
    formError.value = '请输入时区。'
    return false
  }

  const rawDomains = form.value.domains
  const domains = normalizeDomains()

  // 允许只有一行空白域名，表示暂不配置域名。
  const isEmptyDomainForm =
    rawDomains.length === 1 &&
    rawDomains[0].domain.trim() === ''

  // 多行配置时，不允许存在空白域名。
  if (!isEmptyDomainForm && domains.length !== rawDomains.length) {
    formError.value = '请填写所有域名，或删除空白域名行。'
    return false
  }

  // 后端最多允许 50 个域名。
  if (domains.length > 50) {
    formError.value = '最多只能配置 50 个域名。'
    return false
  }

  if (domains.length > 0) {
    const uniqueDomains = new Set(
      domains.map((item) => item.domain),
    )

    if (uniqueDomains.size !== domains.length) {
      formError.value = '域名不能重复。'
      return false
    }

    if (domains.filter((item) => item.is_primary).length !== 1) {
      formError.value = '必须且只能设置一个主域名。'
      return false
    }

    const domainPattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i

    const invalidDomain = domains.find(
      (item) => !domainPattern.test(item.domain),
    )

    if (invalidDomain) {
      formError.value = `域名格式不正确：${invalidDomain.domain}`
      return false
    }
  }

  return true
}

async function submitForm() {
  formError.value = ''

  if (!validateForm()) return

  const domains = normalizeDomains()

  if (editingSite.value) {
    const payload: UpdateSiteRequest = {
      site_id: editingSite.value.id,
      name: form.value.name.trim(),
      timezone: form.value.timezone.trim(),
      domains,
    }

    const result = await updateSite(payload)

    if (result) {
      closeDialog()
    }

    return
  }

  const payload: CreateSiteRequest = {
    name: form.value.name.trim(),
    timezone: form.value.timezone.trim(),
    domains,
  }

  const result = await createSite(payload)

  if (result) {
    generatedTracker.value = {
      site: result,
      snippet: buildTrackerSnippet({
        siteId: result.id,
        apiBaseUrl,
        origin: window.location.origin,
      }),
    }

    store.refreshSiteOptions()
    closeDialog()
    trackerCopyStatus.value = ''
    trackerDialogVisible.value = true
  }
}


function openTrackerDialog(site: SiteListItem) {
  generatedTracker.value = {
    site,
    snippet: buildTrackerSnippet({
      siteId: site.id,
      apiBaseUrl,
      origin: window.location.origin,
    }),
  }

  trackerCopyStatus.value = ''
  trackerDialogVisible.value = true
}

function closeTrackerDialog() {
  trackerDialogVisible.value = false
  trackerCopyStatus.value = ''
}

async function copyTrackerSnippet() {
  if (!generatedTracker.value) return

  try {
    await navigator.clipboard.writeText(
      generatedTracker.value.snippet,
    )
    trackerCopyStatus.value = '接入代码已复制。'
  } catch {
    trackerCopyStatus.value =
      '复制失败，请检查浏览器剪贴板权限后重试。'
  }
}

function openSiteStatusDialog(
  site: SiteListItem,
  nextStatus: SiteStatus,
) {
  statusDialog.value = {
    site,
    nextStatus,
  }

  pageMutationError.value = ''
}

function toggleSiteStatus(site: SiteListItem) {
  const nextStatus =
    site.status === 'active' ? 'disabled' : 'active'

  openSiteStatusDialog(site, nextStatus)
}

function archiveSite(site: SiteListItem) {
  openSiteStatusDialog(site, 'archived')
}

function restoreSite(site: SiteListItem) {
  openSiteStatusDialog(site, 'active')
}

function closeStatusDialog() {
  if (mutationLoading.value) return
  statusDialog.value = null
}

async function confirmSiteStatusChange() {
  const current = statusDialog.value

  if (!current || mutationLoading.value) return

  pageMutationError.value = ''

  const result = await updateSiteStatus({
    site_id: current.site.id,
    status: current.nextStatus,
  })

  if (result) {
    // 刷新 Header 站点选择器，确保状态同步。
    store.refreshSiteOptions()

    statusDialog.value = null
  } else {
    pageMutationError.value =
      mutationError.value || '站点状态更新失败，请稍后重试。'
  }
}

function formatDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

</script>

<template>
  <PageContainer
    title="我的站点"
    description="管理你的网站及数据采集配置。"
  >
    <div class="sites-page">
      <div class="sites-heading">
        <div>
          <h1>我的站点</h1>
          <p>{{ pageDescription }}</p>
        </div>

        <div class="sites-total">
          <Globe :size="17" />
          <span>{{ paginationText }}</span>
        </div>
      </div>

      <section class="sites-panel">
        <div class="sites-panel-heading">
          <div>
            <h2>站点列表</h2>
            <p>管理已添加的网站及其基本信息</p>
          </div>

          <button
            class="sites-refresh"
            :disabled="loading"
            @click="retry"
          >
            <RefreshCw :size="15" :class="{ spinning: loading }" />
            刷新
          </button>
          <button
            class="primary-button"
            type="button"
            @click="openCreateDialog"
          >
            <Plus :size="16" />
            新增站点
          </button>
        </div>

        <div v-if="loading && !hasData" class="sites-state">
          <div class="sites-loader"></div>
          <p>正在加载站点...</p>
        </div>

        <div v-else-if="error && !hasData" class="sites-state">
          <div class="state-icon error-icon">!</div>
          <h3>站点加载失败</h3>
          <p>{{ error }}</p>
          <button class="primary-button" @click="retry">
            <RefreshCw :size="15" />
            重新加载
          </button>
        </div>

        <div v-else-if="!hasData" class="sites-state">
          <div class="state-icon">
            <Globe :size="25" />
          </div>
          <h3>还没有添加站点</h3>
          <p>添加你的网站后，即可在这里管理站点信息。</p>
        </div>

        <template v-else>
          <div v-if="error" class="sites-inline-error">
            {{ error }}
            <button @click="retry">重试</button>
          </div>

          <div
            v-if="pageMutationError"
            class="sites-inline-error"
          >
            {{ pageMutationError }}
            <button
              type="button"
              @click="pageMutationError = ''"
            >
              关闭
            </button>
          </div>

          <div class="sites-table-wrapper">
            <table class="sites-table">
              <thead>
                <tr>
                  <th>站点名称</th>
                  <th>网站域名</th>
                  <th>Site ID</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>

              <tbody>
                <tr v-for="site in items" :key="site.id">
                  <td>
                    <div class="site-name-cell">
                      <div class="site-icon">
                        <Globe :size="17" />
                      </div>
                      <strong>{{ site.name }}</strong>
                    </div>
                  </td>

                  <td>
                    <div class="domain-cell">
                      <span>{{ primaryDomain(site) }}</span>
                      <small v-if="additionalDomainCount(site) > 0">
                        +{{ additionalDomainCount(site) }} 个域名
                      </small>
                    </div>
                  </td>

                  <td>
                    <code class="site-id">{{ site.id }}</code>
                  </td>

                  <td>
                    <span
                      class="site-status"
                      :class="`status-${site.status}`"
                    >
                      {{ statusLabel(site.status) }}
                    </span>
                  </td>

                  <td class="date-cell">
                    {{ formatDate(site.created_at) }}
                  </td>

                  <td>
                    <div class="site-actions">
                      <button
                        type="button"
                        class="icon-button"
                        :disabled="mutationLoading"
                        title="编辑站点"
                        @click="openEditDialog(site)"
                      >
                        <Pencil :size="16" />
                      </button>

                      <button
                        type="button"
                        class="icon-button"
                        :title="`查看 ${site.name} 的接入代码`"
                        :aria-label="`查看 ${site.name} 的接入代码`"
                        @click="openTrackerDialog(site)"
                      >
                        <Copy :size="16" />
                      </button>

                      <!-- active / disabled：启用或禁用 -->
                      <button
                        v-if="site.status !== 'archived'"
                        type="button"
                        class="icon-button"
                        :disabled="mutationLoading"
                        :title="site.status === 'active' ? '禁用站点' : '启用站点'"
                        @click="toggleSiteStatus(site)"
                      >
                        <Pause
                          v-if="site.status === 'active'"
                          :size="16"
                        />
                        <Play
                          v-else
                          :size="16"
                        />
                      </button>

                      <!-- active / disabled：归档 -->
                      <button
                        v-if="site.status !== 'archived'"
                        type="button"
                        class="icon-button danger-button"
                        :disabled="mutationLoading"
                        title="归档站点"
                        @click="archiveSite(site)"
                      >
                        <Archive :size="16" />
                      </button>

                      <!-- archived：恢复 -->
                      <button
                        v-if="site.status === 'archived'"
                        type="button"
                        class="icon-button"
                        :disabled="mutationLoading"
                        title="恢复站点"
                        @click="restoreSite(site)"
                      >
                        <RotateCcw :size="16" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="sites-pagination">
            <span>
              {{ paginationText }}
              <template v-if="totalPages > 0">
                · 第 {{ page }} / {{ totalPages }} 页
              </template>
            </span>

            <div class="pagination-actions">
              <button
                :disabled="!canPrevious || loading"
                @click="goToPage(page - 1)"
              >
                上一页
              </button>
              <button
                :disabled="!canNext || loading"
                @click="goToPage(page + 1)"
              >
                下一页
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
    
  </PageContainer>
  <Teleport to="body">
      <div
        v-if="dialogVisible"
        class="site-dialog-mask"
        @click.self="closeDialog"
      >
        <section
          class="site-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-dialog-title"
        >
          <header class="site-dialog-header">
            <div>
              <h2 id="site-dialog-title">
                {{ dialogTitle }}
              </h2>
              <p>配置站点基本信息和关联域名</p>
            </div>

            <button
              type="button"
              class="icon-button"
              :disabled="mutationLoading"
              @click="closeDialog"
            >
              <X :size="18" />
            </button>
          </header>

          <form
            class="site-dialog-form"
            @submit.prevent="submitForm"
          >
            <label class="form-field">
              <span>站点名称</span>
              <input
                v-model="form.name"
                maxlength="100"
                placeholder="例如：PLV Studio"
                required
              />
            </label>

            <label class="form-field">
              <span>时区</span>
              <input
                v-model="form.timezone"
                placeholder="例如：Asia/Shanghai"
                required
              />
            </label>

            <div class="domain-section">
              <div class="domain-section-header">
                <div>
                  <strong>关联域名</strong>
                  <p>主域名用于标记站点的主要访问地址</p>
                </div>

                <button
                  type="button"
                  class="secondary-button"
                  @click="addDomain"
                >
                  <Plus :size="15" />
                  添加域名
                </button>
              </div>

              <div
                v-for="(domain, index) in form.domains"
                :key="index"
                class="domain-row"
              >
                <Globe :size="16" />

                <input
                  v-model="domain.domain"
                  placeholder="example.com"
                  maxlength="255"
                />

                <label class="primary-domain">
                  <input
                    type="radio"
                    :checked="domain.is_primary"
                    @change="setPrimaryDomain(index)"
                  />
                  主域名
                </label>

                <button
                  type="button"
                  class="icon-button danger-button"
                  title="删除域名"
                  @click="removeDomain(index)"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
            </div>

            <p
              v-if="formError || mutationError"
              class="form-error"
            >
              {{ formError || mutationError }}
            </p>

            <footer class="site-dialog-footer">
              <button
                type="button"
                class="secondary-button"
                :disabled="mutationLoading"
                @click="closeDialog"
              >
                取消
              </button>

              <button
                type="submit"
                class="primary-button"
                :disabled="mutationLoading"
              >
                {{ mutationLoading ? '保存中...' : '保存' }}
              </button>
            </footer>
          </form>
        </section>
      </div>
      
      <div
        v-if="statusDialog"
        class="site-dialog-mask"
        @click.self="closeStatusDialog"
      >
        <section
          class="site-dialog status-confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="status-dialog-title"
          aria-describedby="status-dialog-description"
        >
          <header class="status-dialog-header">
            <div
              class="status-dialog-icon"
              :class="statusDialog.nextStatus === 'active'
                ? 'status-dialog-icon-success'
                : 'status-dialog-icon-danger'"
            >
              <CheckCircle2
                v-if="statusDialog.nextStatus === 'active'"
                :size="24"
              />
              <Archive v-else-if="statusDialog.nextStatus === 'archived'" :size="24" />
              <AlertTriangle v-else :size="24" />
            </div>

            <button
              type="button"
              class="icon-button"
              :disabled="mutationLoading"
              aria-label="关闭确认弹窗"
              @click="closeStatusDialog"
            >
              <X :size="18" />
            </button>
          </header>

          <div class="status-dialog-content">
            <h2 id="status-dialog-title">
              {{
                statusDialog.nextStatus === 'archived'
                  ? '确认归档站点？'
                  : statusDialog.nextStatus === 'active'
                    ? '确认恢复站点？'
                    : '确认禁用站点？'
              }}
            </h2>

            <p class="status-dialog-site-name">
              {{ statusDialog.site.name }}
            </p>

            <p id="status-dialog-description">
              {{
                statusDialog.nextStatus === 'archived'
                  ? '归档后，该站点将停止接收新的统计数据，但站点信息和历史统计数据都会保留。归档后仍可恢复。'
                  : statusDialog.nextStatus === 'active'
                    ? '恢复后，该站点将重新变为启用状态，可以继续接收和查看网站统计数据。'
                    : '禁用后，该站点将停止正常使用统计功能。已有统计数据不会因此被删除。'
              }}
            </p>
          </div>

          <p
            v-if="pageMutationError"
            class="status-dialog-error"
          >
            {{ pageMutationError }}
          </p>

          <footer class="status-confirm-footer">
            <button
              type="button"
              class="secondary-button"
              :disabled="mutationLoading"
              @click="closeStatusDialog"
            >
              取消
            </button>

            <button
              type="button"
              class="primary-button"
              :class="statusDialog.nextStatus === 'active'
                ? 'success-confirm-button'
                : 'danger-confirm-button'"
              :disabled="mutationLoading"
              @click="confirmSiteStatusChange"
            >
              <span v-if="mutationLoading">处理中...</span>

              <template v-else>
                <Archive
                  v-if="statusDialog.nextStatus === 'archived'"
                  :size="15"
                />
                <RotateCcw
                  v-else-if="statusDialog.nextStatus === 'active'"
                  :size="15"
                />
                <Pause v-else :size="15" />

                {{
                  statusDialog.nextStatus === 'archived'
                    ? '确认归档'
                    : statusDialog.nextStatus === 'active'
                      ? '确认恢复'
                      : '确认禁用'
                }}
              </template>
            </button>
          </footer>
        </section>
      </div>

      <div
        v-if="trackerDialogVisible && generatedTracker"
        class="site-dialog-mask"
        @click.self="closeTrackerDialog"
      >
        <section
          class="site-dialog tracker-snippet-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tracker-dialog-title"
        >
          <header class="site-dialog-header">
            <div>
              <h2 id="tracker-dialog-title">站点接入代码</h2>
              <p>将以下代码添加到你的网站 HTML 页面中</p>
            </div>

            <button
              type="button"
              class="icon-button"
              aria-label="关闭接入代码弹窗"
              @click="closeTrackerDialog"
            >
              <X :size="18" />
            </button>
          </header>

          <div class="tracker-snippet-content">
            <div class="tracker-snippet-meta">
              <div>
                <span>站点名称</span>
                <strong>{{ generatedTracker.site.name }}</strong>
              </div>

              <div>
                <span>站点 ID</span>
                <code>{{ generatedTracker.site.id }}</code>
              </div>
            </div>

            <p
              v-if="generatedTracker.site.status !== 'active'"
              class="tracker-site-status-notice"
              role="status"
            >
              当前站点状态：{{ statusLabel(generatedTracker.site.status) }}。
              接入代码仍可查看和复制，但站点未处于运行状态，数据采集可能不可用。
            </p>

            <label
              class="tracker-snippet-label"
              for="tracker-snippet-code"
            >
              HTML 接入代码
            </label>

            <textarea
              id="tracker-snippet-code"
              class="tracker-snippet-code"
              :value="generatedTracker.snippet"
              readonly
              rows="12"
              spellcheck="false"
            />

            <p
              v-if="trackerCopyStatus"
              class="tracker-copy-status"
              :class="{
                'tracker-copy-success':
                  trackerCopyStatus === '接入代码已复制。',
                'tracker-copy-error':
                  trackerCopyStatus !== '接入代码已复制。',
              }"
              role="status"
              aria-live="polite"
            >
              {{ trackerCopyStatus }}
            </p>

            <footer class="tracker-snippet-footer">
              <button
                type="button"
                class="secondary-button"
                @click="closeTrackerDialog"
              >
                关闭
              </button>

              <button
                type="button"
                class="primary-button"
                @click="copyTrackerSnippet"
              >
                <Copy :size="15" />
                复制接入代码
              </button>
            </footer>
          </div>
        </section>
      </div>

    </Teleport>
</template>

<style scoped>
.sites-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

.sites-heading,
.sites-panel-heading,
.sites-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.sites-heading h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary, #172033);
}

.sites-heading p,
.sites-panel-heading p {
  margin: 7px 0 0;
  color: var(--text-secondary, #718096);
  font-size: 13px;
}

.sites-total {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary, #718096);
  font-size: 13px;
}

.sites-panel {
  overflow: hidden;
  border: 1px solid var(--border-color, #e8edf3);
  border-radius: 12px;
  background: var(--card-bg, #fff);
}

.sites-panel-heading {
  padding: 20px 22px;
  border-bottom: 1px solid var(--border-color, #e8edf3);
}

.sites-panel-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  color: var(--text-primary, #172033);
}

.sites-refresh,
.pagination-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-color, #e8edf3);
  border-radius: 7px;
  background: var(--card-bg, #fff);
  color: var(--text-secondary, #64748b);
  font-size: 12px;
  cursor: pointer;
}

.sites-refresh:disabled,
.pagination-actions button:disabled {
  cursor: not-allowed;
  opacity: .45;
}

.sites-state {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  text-align: center;
}

.sites-state h3 {
  margin: 15px 0 0;
  font-size: 15px;
  color: var(--text-primary, #172033);
}

.sites-state p {
  max-width: 440px;
  margin: 8px 0 0;
  color: var(--text-secondary, #718096);
  font-size: 13px;
  line-height: 1.7;
}

.sites-loader {
  width: 27px;
  height: 27px;
  border: 3px solid #e5eaf0;
  border-top-color: #4f7cff;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}

.state-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: #f0f4ff;
  color: #6685dc;
}

.error-icon {
  background: #fff1f0;
  color: #dc5555;
  font-size: 22px;
  font-weight: 700;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 18px;
  padding: 9px 14px;
  border: 0;
  border-radius: 7px;
  background: #4169e1;
  color: white;
  font-size: 13px;
  cursor: pointer;
}

.sites-state .primary-button {
  margin-top: 18px;
}

.sites-table-wrapper {
  width: 100%;
  overflow-x: auto;
}

.sites-table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
  text-align: left;
}

.sites-table th {
  padding: 13px 16px;
  background: var(--table-header-bg, #f8fafc);
  color: var(--text-secondary, #718096);
  font-size: 11px;
  font-weight: 600;
}

.sites-table td {
  padding: 16px;
  border-top: 1px solid var(--border-color, #edf0f4);
  color: var(--text-primary, #273449);
  font-size: 12px;
}

.site-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.site-name-cell strong {
  font-size: 13px;
}

.site-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #f0f4ff;
  color: #5475cf;
}

.domain-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.domain-cell small {
  color: var(--text-secondary, #8793a5);
  font-size: 10px;
}

.site-id {
  color: var(--text-secondary, #718096);
  font-size: 11px;
}

.site-status {
  display: inline-flex;
  padding: 4px 8px;
  border-radius: 20px;
  font-size: 11px;
}

.status-active {
  background: #eaf8f0;
  color: #238451;
}

.status-disabled {
  background: #fff5e7;
  color: #b7791f;
}

.status-archived {
  background: #f0f1f3;
  color: #737b88;
}

.date-cell {
  color: var(--text-secondary, #718096) !important;
}

.sites-pagination {
  min-height: 58px;
  padding: 0 20px;
  border-top: 1px solid var(--border-color, #edf0f4);
  color: var(--text-secondary, #718096);
  font-size: 11px;
}

.pagination-actions {
  display: flex;
  gap: 8px;
}

.spinning {
  animation: spin .8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .sites-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .sites-panel-heading {
    padding: 16px;
  }

  .sites-pagination {
    align-items: flex-start;
    flex-direction: column;
    padding: 14px 16px;
  }

  .sites-table th,
  .sites-table td {
    padding: 13px 12px;
  }
}

.primary-button,
.secondary-button,
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.primary-button {
  padding: 9px 15px;
  border: 1px solid var(--color-primary, #2563eb);
  background: var(--color-primary, #2563eb);
  color: #fff;
  font-size: 13px;
}

.primary-button:hover {
  filter: brightness(1.08);
}

.secondary-button {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  background: transparent;
  color: inherit;
  font-size: 13px;
}

.secondary-button:hover,
.icon-button:hover {
  background: var(--hover-background, #f3f4f6);
}

.icon-button {
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
}

.site-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.danger-button {
  color: #dc2626;
}

.site-dialog-mask {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(15 23 42 / 45%);
  backdrop-filter: blur(3px);
}

.site-dialog {
  width: min(560px, 100%);
  max-height: min(85vh, 760px);
  overflow-y: auto;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 14px;
  background: var(--card-background, #fff);
  color: var(--text-primary, #111827);
  box-shadow: 0 24px 80px rgb(0 0 0 / 18%);
}

.status-confirm-dialog {
  width: min(440px, 100%);
  overflow: hidden;
}

.status-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 24px 0;
}

.status-dialog-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 14px;
}

.status-dialog-icon-danger {
  background: #fff1f0;
  color: #dc2626;
}

.status-dialog-icon-success {
  background: #eaf8f0;
  color: #238451;
}

.status-dialog-content {
  padding: 18px 24px 24px;
}

.status-dialog-content h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.status-dialog-site-name {
  margin: 12px 0 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  background: var(--table-header-bg, #f8fafc);
  color: var(--text-primary, #111827);
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.status-dialog-content > p:last-child {
  margin: 12px 0 0;
  color: var(--text-secondary, #718096);
  font-size: 13px;
  line-height: 1.7;
}

.status-dialog-error {
  margin: 0 24px 16px;
  color: #dc2626;
  font-size: 13px;
  line-height: 1.6;
}

.status-confirm-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border-color, #e5e7eb);
}

.status-confirm-footer .primary-button,
.status-confirm-footer .secondary-button {
  min-height: 36px;
  margin-top: 0;
  padding: 8px 15px;
}

.status-confirm-footer .danger-confirm-button {
  border-color: #dc2626;
  background: #dc2626;
}

.status-confirm-footer .danger-confirm-button:hover {
  background: #b91c1c;
  filter: none;
}

.status-confirm-footer .success-confirm-button {
  border-color: #238451;
  background: #238451;
}

.status-confirm-footer .success-confirm-button:hover {
  background: #166534;
  filter: none;
}

.site-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22px 24px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.site-dialog-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.site-dialog-header p,
.domain-section-header p {
  margin: 6px 0 0;
  color: var(--text-secondary, #6b7280);
  font-size: 12px;
}

.site-dialog-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.form-field input,
.domain-row > input {
  min-width: 0;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 7px;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
}

.form-field input:focus,
.domain-row > input:focus {
  border-color: var(--color-primary, #2563eb);
}

.domain-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.domain-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.domain-section-header strong {
  font-size: 13px;
}

.domain-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.domain-row > input {
  flex: 1;
}

.primary-domain {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  font-size: 12px;
}

.form-error {
  margin: 0;
  color: #dc2626;
  font-size: 13px;
}

.site-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color, #e5e7eb);
}

.site-dialog-footer .primary-button,
.site-dialog-footer .secondary-button {
  min-height: 36px;
  margin-top: 0;
  padding: 8px 15px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 560px) {
  .site-dialog-mask {
    padding: 10px;
  }

  .site-dialog-form {
    padding: 18px;
  }

  .domain-row {
    flex-wrap: wrap;
  }

  .domain-row > input {
    flex-basis: calc(100% - 40px);
  }
}

.sites-inline-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 14px 20px 0;
  padding: 11px 14px;
  border: 1px solid #fecaca;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12px;
}

.sites-inline-error button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}


.tracker-snippet-dialog {
  width: min(720px, 100%);
}

.tracker-snippet-content {
  padding: 20px 24px 24px;
}

.tracker-snippet-meta {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
}

.tracker-snippet-meta > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tracker-snippet-meta span,
.tracker-snippet-label {
  color: var(--text-secondary, #718096);
  font-size: 13px;
}

.tracker-snippet-meta strong,
.tracker-snippet-meta code {
  overflow-wrap: anywhere;
  color: var(--text-primary, #111827);
  font-size: 13px;
}

.tracker-snippet-label {
  display: block;
  margin-bottom: 8px;
}

.tracker-snippet-code {
  display: block;
  width: 100%;
  min-height: 240px;
  padding: 14px;
  resize: vertical;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  background: var(--input-background, #f8fafc);
  color: var(--text-primary, #111827);
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre;
  overflow-wrap: normal;
}

.tracker-copy-status {
  margin: 10px 0 0;
  font-size: 13px;
}

.tracker-copy-success {
  color: #238451;
}

.tracker-copy-error {
  color: #dc2626;
}

.tracker-site-status-notice {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #f5d08a;
  border-radius: 8px;
  background: #fffbeb;
  color: #92400e;
  font-size: 13px;
  line-height: 1.6;
}

.tracker-snippet-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.tracker-snippet-footer button {
  min-height: 36px;
  margin-top: 0;
}

@media (max-width: 560px) {
  .tracker-snippet-content {
    padding: 18px;
  }

  .tracker-snippet-footer {
    flex-wrap: wrap;
  }
}

</style>


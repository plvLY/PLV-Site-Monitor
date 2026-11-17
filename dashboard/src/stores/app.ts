import { defineStore } from 'pinia'
import { ref } from 'vue'

export type AnalyticsDateRange =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'

interface SiteSelection {
  id: string
  name: string
}

const SITE_SELECTION_STORAGE_KEY = 'plv-site-monitor:selected-site-id'

function readStoredSiteId(): string {
  try {
    if (typeof window === 'undefined') {
      return ''
    }

    return window.localStorage
      .getItem(SITE_SELECTION_STORAGE_KEY)
      ?.trim() ?? ''
  } catch {
    return ''
  }
}

function persistSiteId(id: string) {
  try {
    if (typeof window === 'undefined') {
      return
    }

    if (id) {
      window.localStorage.setItem(
        SITE_SELECTION_STORAGE_KEY,
        id,
      )
    } else {
      window.localStorage.removeItem(
        SITE_SELECTION_STORAGE_KEY,
      )
    }
  } catch {
    // 浏览器存储不可用时，不影响 Dashboard 正常使用。
  }
}

export const useAppStore = defineStore('app', () => {
  // 当前选中的站点名称；等待站点列表加载后再恢复。
  const selectedSite = ref('')

  // 优先读取上次保存的站点 ID。
  const siteId = ref(readStoredSiteId())

  // 全局统计时间范围，默认最近 7 天。
  const dateRange = ref<AnalyticsDateRange>('7d')

  // 站点选项刷新通知版本号。
  const siteOptionsRefreshVersion = ref(0)

  // 通知 Header 重新加载站点选项。
  function refreshSiteOptions() {
    siteOptionsRefreshVersion.value += 1
  }

  // 兼容原有调用方式。
  function setSelectedSite(site: string) {
    selectedSite.value = site
  }

  // 兼容原有调用方式，同时同步持久化站点 ID。
  function setSiteId(id: string) {
    const normalizedId = id.trim()

    siteId.value = normalizedId
    persistSiteId(normalizedId)
  }

  // 统一更新站点 ID、名称和持久化状态。
  function setSiteSelection(selection: SiteSelection) {
    const id = selection.id.trim()
    const name = selection.name.trim()

    if (!id || !name) {
      return
    }

    siteId.value = id
    selectedSite.value = name
    persistSiteId(id)
  }

  // 清除当前站点选择及持久化记录。
  function clearSiteSelection() {
    siteId.value = ''
    selectedSite.value = ''
    persistSiteId('')
  }

  // 更新全局统计时间范围。
  function setDateRange(range: AnalyticsDateRange) {
    dateRange.value = range
  }

  return {
    selectedSite,
    siteId,
    dateRange,
    siteOptionsRefreshVersion,
    refreshSiteOptions,
    setSelectedSite,
    setSiteId,
    setSiteSelection,
    clearSiteSelection,
    setDateRange,
  }
})

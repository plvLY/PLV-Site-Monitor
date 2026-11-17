<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Bell,
  ChevronDown,
  Menu,
  Search,
  Check,
  Globe,
  RefreshCw,
  LogOut,
} from 'lucide-vue-next'

import { useAppStore } from '../../stores/app'
import { useAuthStore } from '../../stores/auth'
import type { AnalyticsDateRange } from '../../stores/app'
import { useSiteOptions } from '../../composables/useSiteOptions'

defineEmits<{ toggleSidebar: [] }>()

const route = useRoute()
const router = useRouter()
const store = useAppStore()
const auth = useAuthStore()

const pageTitle = computed(() => String(route.meta.title ?? 'Overview'))

const {
  items: siteOptions,
  loading: sitesLoading,
  error: sitesError,
  loaded: sitesLoaded,
  retry: retrySites,
} = useSiteOptions()

// 站点创建成功后，重新加载全局站点选项
watch(
  () => store.siteOptionsRefreshVersion,
  () => {
    void retrySites()
  },
)

// 只有站点列表完整加载成功后，才恢复或校验全局站点选择。
// 此 watcher 不监听 store.siteId，避免覆盖用户手动选择的停用/归档站点。
watch(
  [sitesLoaded, sitesLoading, sitesError, siteOptions],
  ([loaded, loading, error, sites]) => {
    if (!loaded || loading || error) {
      return
    }

    const currentSite = sites.find(
      site => site.id === store.siteId,
    )

    // 当前选择仍然有效：保留 ID，并同步最新站点名称。
    if (currentSite?.status === 'active') {
      store.setSiteSelection({
        id: currentSite.id,
        name: currentSite.name,
      })
      return
    }

    // 首次使用、历史站点不存在或历史站点已停用/归档：
    // 自动选择列表中的第一个 active 站点。
    const firstActiveSite = sites.find(
      site => site.status === 'active',
    )

    if (firstActiveSite) {
      store.setSiteSelection({
        id: firstActiveSite.id,
        name: firstActiveSite.name,
      })
      return
    }

    // 没有 active 站点时清空选择，不保留无效 ID。
    store.clearSiteSelection()
  },
)

const siteDropdownOpen = ref(false)
const siteDropdownRef = ref<HTMLElement | null>(null)
const isLoggingOut = ref(false)

const dateRanges: {
  value: AnalyticsDateRange
  label: string
}[] = [
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
]

const selectedSite = computed(() => {
  return siteOptions.value.find(site => site.id === store.siteId)
})

const selectedSiteMissing = computed(() => {
  return (
    sitesLoaded.value &&
    !sitesLoading.value &&
    !sitesError.value &&
    Boolean(store.siteId) &&
    !selectedSite.value
  )
})

function toggleSiteDropdown() {
  siteDropdownOpen.value = !siteDropdownOpen.value
}

function closeSiteDropdown() {
  siteDropdownOpen.value = false
}

function selectSite(site: (typeof siteOptions.value)[number]) {
  store.setSiteSelection({
    id: site.id,
    name: site.name,
  })

  closeSiteDropdown()
}

function handleDateRangeChange(range: AnalyticsDateRange) {
  store.setDateRange(range)
}

async function handleLogout() {
  if (isLoggingOut.value) return

  isLoggingOut.value = true

  try {
    await auth.logout()
  } catch {
    window.alert('退出登录请求失败，请检查网络连接或稍后重试。')
  } finally {
    isLoggingOut.value = false
    await router.replace({ name: 'login' })
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'active':
      return '运行中'
    case 'disabled':
      return '已停用'
    case 'archived':
      return '已归档'
    default:
      return status
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target

  if (
    target instanceof Node &&
    siteDropdownRef.value &&
    !siteDropdownRef.value.contains(target)
  ) {
    closeSiteDropdown()
  }
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeSiteDropdown()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <button
        class="icon-button mobile-menu"
        aria-label="打开导航"
        @click="$emit('toggleSidebar')"
      >
        <Menu :size="20" />
      </button>

      <div class="breadcrumb">
        <span>数据分析</span>
        <span class="breadcrumb-divider">/</span>
        <strong>{{ pageTitle }}</strong>
      </div>
    </div>

    <div class="header-actions">
      <!-- 站点选择 -->
      <div
        ref="siteDropdownRef"
        class="site-filter"
      >
        <div class="site-dropdown">
          <button
            type="button"
            class="site-selector"
            :class="{ 'is-open': siteDropdownOpen }"
            :aria-expanded="siteDropdownOpen"
            aria-haspopup="listbox"
            aria-label="选择统计站点"
            @click="toggleSiteDropdown"
          >
            <span class="site-avatar">
              <Globe :size="15" />
            </span>

            <span class="site-selector-info">
              <span class="site-selector-name">
                {{ store.selectedSite || '选择站点' }}
              </span>
              <span
                v-if="selectedSite"
                class="site-selector-status"
                :class="`status-${selectedSite.status}`"
              >
                {{ getStatusLabel(selectedSite.status) }}
              </span>
            </span>

            <ChevronDown
              :size="15"
              class="site-selector-chevron"
              :class="{ rotated: siteDropdownOpen }"
            />
          </button>

          <Transition name="site-menu">
            <div
              v-if="siteDropdownOpen"
              class="site-dropdown-menu"
              role="listbox"
              aria-label="可用站点"
            >
              <div class="site-menu-heading">
                <div>
                  <strong>切换站点</strong>
                  <span>选择要查看统计数据的网站</span>
                </div>
                <span class="site-count">
                  {{ siteOptions.length }}
                </span>
              </div>

              <div class="site-menu-list">
                <div
                  v-if="sitesLoading && siteOptions.length === 0"
                  class="site-menu-message"
                >
                  <RefreshCw :size="16" class="loading-icon" />
                  正在加载站点...
                </div>

                <div
                  v-else-if="sitesError && siteOptions.length === 0"
                  class="site-menu-message site-menu-error"
                >
                  <span>{{ sitesError }}</span>
                  <button
                    type="button"
                    class="site-menu-retry"
                    @click="retrySites"
                  >
                    重试
                  </button>
                </div>

                <div
                  v-else-if="siteOptions.length === 0"
                  class="site-menu-message"
                >
                  暂无可访问的站点
                </div>

                <div
                  v-if="selectedSiteMissing"
                  class="site-menu-current-warning"
                >
                  当前站点不在可访问列表中
                </div>

                <button
                  v-for="site in siteOptions"
                  :key="site.id"
                  type="button"
                  class="site-option"
                  :class="{ selected: store.siteId === site.id }"
                  role="option"
                  :aria-selected="store.siteId === site.id"
                  @click="selectSite(site)"
                >
                  <span class="site-option-icon">
                    <Globe :size="16" />
                  </span>

                  <span class="site-option-info">
                    <strong>{{ site.name }}</strong>
                    <span
                      class="site-option-status"
                      :class="`status-${site.status}`"
                    >
                      <i></i>
                      {{ getStatusLabel(site.status) }}
                    </span>
                  </span>

                  <Check
                    v-if="store.siteId === site.id"
                    :size="17"
                    class="site-option-check"
                  />
                </button>
              </div>

              <div class="site-menu-footer">
                <span>共 {{ siteOptions.length }} 个站点</span>
                <button
                  type="button"
                  :disabled="sitesLoading"
                  @click="retrySites"
                >
                  <RefreshCw
                    :size="12"
                    :class="{ 'loading-icon': sitesLoading }"
                  />
                  刷新
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </div>

      <!-- 时间范围 -->
      <div
        class="date-range-selector"
        role="group"
        aria-label="统计时间范围"
      >
        <button
          v-for="range in dateRanges"
          :key="range.value"
          type="button"
          class="date-range-button"
          :class="{ active: store.dateRange === range.value }"
          :aria-pressed="store.dateRange === range.value"
          @click="handleDateRangeChange(range.value)"
        >
          {{ range.label }}
        </button>
      </div>

      <button
        class="icon-button search-button"
        aria-label="搜索"
      >
        <Search :size="19" />
      </button>

      <button
        class="icon-button notification-button"
        aria-label="通知"
      >
        <Bell :size="19" />
      </button>

      <button
        type="button"
        class="icon-button logout-button"
        aria-label="退出登录"
        title="退出登录"
        :disabled="isLoggingOut"
        @click="handleLogout"
      >
        <LogOut :size="18" />
      </button>

      <div
        class="user-avatar"
        :title="auth.admin?.username ?? '管理员'"
      >
        {{ auth.admin?.username?.slice(0, 1).toUpperCase() ?? 'P' }}
      </div>
    </div>
  </header>
</template>


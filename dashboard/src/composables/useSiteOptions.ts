import {
  computed,
  onBeforeUnmount,
  ref,
} from 'vue'

import { getSites } from '../services/api/sites-api'

import type {
  SiteDomain,
  SiteListItem,
  SiteStatus,
  SitesMeta,
  SitesResponse,
} from '../types/sites'

const PAGE_SIZE = 100

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function isSiteStatus(
  value: unknown,
): value is SiteStatus {
  return (
    value === 'active' ||
    value === 'disabled' ||
    value === 'archived'
  )
}

function isDomain(
  value: unknown,
): value is SiteDomain {
  return (
    isRecord(value) &&
    typeof value.domain === 'string' &&
    typeof value.is_primary === 'boolean'
  )
}

function isSite(
  value: unknown,
): value is SiteListItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    isSiteStatus(value.status) &&
    typeof value.timezone === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string' &&
    Array.isArray(value.domains) &&
    value.domains.every(isDomain)
  )
}

function isSitesResponse(
  value: unknown,
): value is SitesResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isSite)
  )
}

function isSitesMeta(
  value: unknown,
): value is SitesMeta {
  return (
    isRecord(value) &&
    Number.isInteger(value.page) &&
    Number.isInteger(value.page_size) &&
    Number.isInteger(value.total) &&
    Number.isInteger(value.total_pages) &&
    Number(value.page) >= 1 &&
    Number(value.page_size) >= 1 &&
    Number(value.page_size) <= PAGE_SIZE &&
    Number(value.total) >= 0 &&
    Number(value.total_pages) >= 0
  )
}

function isValidResponse(
  data: unknown,
  meta: unknown,
): data is SitesResponse {
  return (
    isSitesResponse(data) &&
    isSitesMeta(meta)
  )
}

function getErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error
    ? error.message
    : fallback
}

export function useSiteOptions() {
  const items = ref<SiteListItem[]>([])
  const loading = ref(false)
  const error = ref('')
  const loaded = ref(false)

  let controller: AbortController | null = null
  let requestId = 0

  const hasData = computed(
    () => items.value.length > 0,
  )

  async function loadSites() {
    controller?.abort()

    const currentController = new AbortController()
    controller = currentController

    const currentRequestId = ++requestId

    loading.value = true
    loaded.value = false
    error.value = ''

    try {
      const firstResponse = await getSites(
        {
          page: 1,
          page_size: PAGE_SIZE,
        },
        {
          signal: currentController.signal,
        },
      )

      if (currentRequestId !== requestId) {
        return
      }

      if (
        !isValidResponse(
          firstResponse.data,
          firstResponse.meta,
        )
      ) {
        throw new Error('站点列表返回的数据格式不正确。')
      }

      const firstMeta = firstResponse.meta

      if (
        firstMeta.page !== 1 ||
        firstMeta.page_size !== PAGE_SIZE
      ) {
        throw new Error('站点列表分页信息不正确。')
      }

      const allItems = [...firstResponse.data.items]

      // 按第一页返回的 total_pages 顺序获取剩余页面。
      for (
        let page = 2;
        page <= firstMeta.total_pages;
        page++
      ) {
        const response = await getSites(
          {
            page,
            page_size: PAGE_SIZE,
          },
          {
            signal: currentController.signal,
          },
        )

        if (currentRequestId !== requestId) {
          return
        }

        if (
          !isValidResponse(
            response.data,
            response.meta,
          )
        ) {
          throw new Error('站点列表返回的数据格式不正确。')
        }

        const meta = response.meta

        // 防止分页过程中数据总量变化，导致选项列表不完整。
        if (
          meta.page !== page ||
          meta.page_size !== firstMeta.page_size ||
          meta.total !== firstMeta.total ||
          meta.total_pages !== firstMeta.total_pages
        ) {
          throw new Error('站点列表分页数据发生变化，请重试。')
        }

        allItems.push(...response.data.items)
      }

      if (allItems.length !== firstMeta.total) {
        throw new Error('站点列表数据不完整，请重试。')
      }

      if (currentRequestId !== requestId) {
        return
      }

      // 所有页面成功后再统一更新，避免显示部分结果。
      items.value = allItems
      loaded.value = true
    } catch (err) {
      if (
        currentController.signal.aborted ||
        currentRequestId !== requestId
      ) {
        return
      }

      error.value = getErrorMessage(
        err,
        '站点列表加载失败，请稍后重试。',
      )
    } finally {
      if (currentRequestId === requestId) {
        loading.value = false
        controller = null
      }
    }
  }

  function retry() {
    void loadSites()
  }

  // 与现有 useSitesData 保持一致：创建时自动加载。
  void loadSites()

  onBeforeUnmount(() => {
    requestId++
    controller?.abort()
    controller = null
  })

  return {
    items,
    loading,
    error,
    loaded,
    hasData,
    loadSites,
    retry,
  }
}


import {
  computed,
  onBeforeUnmount,
  ref,
} from 'vue'

import { apiClient } from '../services/api/client'

import {
  createSite as createSiteApi,
  updateSite as updateSiteApi,
  updateSiteStatus as updateSiteStatusApi,
} from '../services/api/sites-api'

import type {
  CreateSiteRequest,
  UpdateSiteRequest,
  UpdateSiteStatusRequest,
} from '../services/api/sites-api'

import type {
  SiteDomain,
  SiteListItem,
  SiteStatus,
  SitesMeta,
  SitesResponse,
} from '../types/sites'

const PAGE_SIZE = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
}

function isSiteStatus(value: unknown): value is SiteStatus {
  return value === 'active' ||
    value === 'disabled' ||
    value === 'archived'
}

function isDomain(value: unknown): value is SiteDomain {
  return (
    isRecord(value) &&
    typeof value.domain === 'string' &&
    typeof value.is_primary === 'boolean'
  )
}

function isSite(value: unknown): value is SiteListItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isSiteStatus(value.status) &&
    typeof value.timezone === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string' &&
    Array.isArray(value.domains) &&
    value.domains.every(isDomain)
  )
}

function isSitesResponse(value: unknown): value is SitesResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isSite)
  )
}

function isSitesMeta(value: unknown): value is SitesMeta {
  return (
    isRecord(value) &&
    Number.isInteger(value.page) &&
    Number.isInteger(value.page_size) &&
    Number.isInteger(value.total) &&
    Number.isInteger(value.total_pages) &&
    Number(value.page) >= 1 &&
    Number(value.page_size) >= 1 &&
    Number(value.total) >= 0 &&
    Number(value.total_pages) >= 0
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

export function useSitesData() {
  const items = ref<SiteListItem[]>([])
  const loading = ref(false)
  const error = ref('')

  const mutationLoading = ref(false)
  const mutationError = ref('')

  const page = ref(1)
  const pageSize = ref(PAGE_SIZE)
  const total = ref(0)
  const totalPages = ref(0)

  let controller: AbortController | null = null
  let requestId = 0

  const hasData = computed(() => items.value.length > 0)
  const canPrevious = computed(() => page.value > 1)
  const canNext = computed(() => page.value < totalPages.value)

  async function loadSites(targetPage = page.value) {
    controller?.abort()

    const currentController = new AbortController()
    controller = currentController

    const currentRequestId = ++requestId

    loading.value = true
    error.value = ''

    try {
      const response = await apiClient.get<
        SitesResponse,
        SitesMeta
      >(
        '/api/sites',
        {
          page: targetPage,
          page_size: pageSize.value,
        },
        {
          signal: currentController.signal,
        },
      )

      if (currentRequestId !== requestId) return

      if (
        !isSitesResponse(response.data) ||
        !isSitesMeta(response.meta)
      ) {
        throw new Error('站点列表返回的数据格式不正确。')
      }

      items.value = response.data.items
      page.value = response.meta.page
      pageSize.value = response.meta.page_size
      total.value = response.meta.total
      totalPages.value = response.meta.total_pages
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

  function goToPage(targetPage: number) {
    if (
      !Number.isInteger(targetPage) ||
      targetPage < 1 ||
      targetPage > totalPages.value ||
      targetPage === page.value
    ) {
      return
    }

    void loadSites(targetPage)
  }

  function retry() {
    void loadSites(page.value)
  }

  
  async function runMutation(
    action: () => Promise<SiteListItem>,
    successPage = page.value,
  ): Promise<SiteListItem | null> {
    if (mutationLoading.value) {
      return null
    }

    mutationLoading.value = true
    mutationError.value = ''

    try {
      const result = await action()

      if (!isSite(result)) {
        throw new Error('站点操作返回的数据格式不正确。')
      }

      // 创建站点后回到第一页，确保新站点能够显示。
      await loadSites(successPage)

      return result
    } catch (err) {
      mutationError.value = getErrorMessage(
        err,
        '站点操作失败，请稍后重试。',
      )

      return null
    } finally {
      mutationLoading.value = false
    }
  }

  function createSite(
    payload: CreateSiteRequest,
  ): Promise<SiteListItem | null> {
    return runMutation(
      async () => {
        const response = await createSiteApi(payload)
        return response.data.item
      },
      1,
    )
  }

  function updateSite(
    payload: UpdateSiteRequest,
  ): Promise<SiteListItem | null> {
    return runMutation(async () => {
      const response = await updateSiteApi(payload)
      return response.data.item
    })
  }

  function updateSiteStatus(
    payload: UpdateSiteStatusRequest,
  ): Promise<SiteListItem | null> {
    return runMutation(async () => {
      const response = await updateSiteStatusApi(payload)
      return response.data.item
    })
  }

  function clearMutationError() {
    mutationError.value = ''
  }

  void loadSites(1)

  onBeforeUnmount(() => {
    requestId++
    controller?.abort()
    controller = null
  })

  return {
    items,
    loading,
    error,
    page,
    pageSize,
    total,
    totalPages,
    hasData,
    canPrevious,
    canNext,

    mutationLoading,
    mutationError,

    loadSites,
    goToPage,
    retry,

    createSite,
    updateSite,
    updateSiteStatus,
    clearMutationError,
  }
}

import { computed, reactive, watch } from 'vue'
import { apiClient, ApiClientError } from '../services/api/client'
import { useAppStore } from '../stores/app'
import { useAnalyticsQuery } from './useAnalyticsQuery'
import {
  isAnalyticsMetaValid,
  isPaginationMetaValid,
} from '../utils/analytics-meta'
import type {
  SourceDimension,
  SourceDimensionMeta,
  SourcesMeta,
  SourcesResponse,
} from '../types/analytics'

const dimensions: SourceDimension[] = [
  'referrer_host',
  'utm_source',
  'utm_medium',
  'utm_campaign',
]

const DEFAULT_PAGE_SIZE = 10

interface DimensionPagination {
  page: number
  pageSize: number
}

type DimensionState<T> = Record<SourceDimension, T>

interface SourcesQueryResult {
  data: SourcesResponse
  meta: SourcesMeta
}

function createDimensionState<T>(
  factory: () => T,
): DimensionState<T> {
  return {
    referrer_host: factory(),
    utm_source: factory(),
    utm_medium: factory(),
    utm_campaign: factory(),
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function isValidDimensionResponse(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return false
  }

  return value.items.every((item: unknown) => {
    if (!isRecord(item)) return false

    return (
      (item.source === null ||
        typeof item.source === 'string') &&
      typeof item.pv === 'number' &&
      Number.isFinite(item.pv) &&
      item.pv >= 0 &&
      typeof item.uv === 'number' &&
      Number.isFinite(item.uv) &&
      item.uv >= 0
    )
  })
}

function isValidDimensionMeta(
  value: unknown,
  expectedPage: number,
  expectedPageSize: number,
): value is SourceDimensionMeta {
  if (
    !isPaginationMetaValid(
      value,
      expectedPage,
      expectedPageSize,
    )
  ) {
    return false
  }

  const meta = value as SourceDimensionMeta

  if (
    meta.page_size > 100 ||
    meta.total_pages !==
      Math.ceil(meta.total / meta.page_size)
  ) {
    return false
  }

  // total 为 0 时，后端允许 page=1、total_pages=0。
  return meta.total === 0 || meta.page <= meta.total_pages
}

function isValidSourcesResponse(
  value: unknown,
): value is SourcesResponse {
  if (!isRecord(value)) return false

  return dimensions.every(dimension =>
    isValidDimensionResponse(value[dimension]),
  )
}

function isValidSourcesMeta(
  value: unknown,
  siteId: string,
  range: Parameters<typeof isAnalyticsMetaValid>[2],
  requestedPages: DimensionState<DimensionPagination>,
): value is SourcesMeta {
  if (!isAnalyticsMetaValid(value, siteId, range)) {
    return false
  }

  const meta = value as SourcesMeta

  return dimensions.every(dimension =>
    isValidDimensionMeta(
      meta[dimension],
      requestedPages[dimension].page,
      requestedPages[dimension].pageSize,
    ),
  )
}

function getRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.kind) {
      case 'TIMEOUT':
        return '请求超时，请检查网络后重试。'
      case 'NETWORK_ERROR':
        return '网络连接失败，请检查网络后重试。'
      case 'INVALID_RESPONSE':
        return '服务器返回的数据格式异常，请稍后重试。'
      case 'ABORTED':
        return '请求已取消。'
    }
  }

  if (error instanceof Error) {
    return error.message || '获取来源分析数据失败，请稍后重试。'
  }

  return '获取来源分析数据失败，请稍后重试。'
}

export function useSourcesData() {
  const store = useAppStore()

  const pagination = reactive(
    createDimensionState<DimensionPagination>(() => ({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    })),
  )

  // 必须在 useAnalyticsQuery 之前同步重置分页。
  // 这样全局筛选变化时，统一查询只会请求第一页。
  watch(
    () => [store.siteId, store.dateRange] as const,
    () => {
      dimensions.forEach(dimension => {
        pagination[dimension].page = 1
      })
    },
    { flush: 'sync' },
  )

  const {
    data: queryResult,
    loading: queryLoading,
    errorMessage,
    retry,
  } = useAnalyticsQuery<SourcesQueryResult | null>(
    async ({ siteId, range, signal }) => {
      // 在请求开始时固定本次四组分页参数。
      const requestedPages: DimensionState<DimensionPagination> = {
        referrer_host: { ...pagination.referrer_host },
        utm_source: { ...pagination.utm_source },
        utm_medium: { ...pagination.utm_medium },
        utm_campaign: { ...pagination.utm_campaign },
      }

      const queryParams = {
        site_id: siteId,
        range,

        referrer_host_page: requestedPages.referrer_host.page,
        referrer_host_page_size: requestedPages.referrer_host.pageSize,

        utm_source_page: requestedPages.utm_source.page,
        utm_source_page_size: requestedPages.utm_source.pageSize,

        utm_medium_page: requestedPages.utm_medium.page,
        utm_medium_page_size: requestedPages.utm_medium.pageSize,

        utm_campaign_page: requestedPages.utm_campaign.page,
        utm_campaign_page_size: requestedPages.utm_campaign.pageSize,
      }

      try {
        const response = await apiClient.get<
          SourcesResponse,
          SourcesMeta
        >(
          '/api/analytics/sources',
          queryParams,
          { signal },
        )

        if (!isValidSourcesResponse(response.data)) {
          throw new Error(
            '来源分析接口返回的数据格式异常，请检查 API 响应。',
          )
        }

        if (
          !isValidSourcesMeta(
            response.meta,
            siteId,
            range,
            requestedPages,
          )
        ) {
          throw new Error(
            '来源分析接口返回的站点、时间范围或分页信息与当前请求不一致。',
          )
        }

        for (const dimension of dimensions) {
          if (
            response.data[dimension].items.length >
            response.meta[dimension].page_size
          ) {
            throw new Error(
              `${dimension} 返回的数据条数超过分页限制。`,
            )
          }
        }

        return {
          data: response.data,
          meta: response.meta,
        }
      } catch (error) {
        if (signal.aborted) {
          throw error
        }

        throw new Error(getRequestErrorMessage(error))
      }
    },
    () => null,
  )

  const data = computed(() =>
    queryResult.value?.data ?? null,
  )

  const meta = computed(() =>
    queryResult.value?.meta ?? null,
  )

  // 一个 API 请求返回全部四个维度，因此四张卡片共享
  // 同一请求的 Loading 和错误状态。
  const loading = computed(() =>
    createDimensionState(() => queryLoading.value),
  )

  const errors = computed(() =>
    createDimensionState(() => errorMessage.value),
  )

  function changePage(
    dimension: SourceDimension,
    page: number,
  ) {
    const totalPages = meta.value?.[dimension].total_pages ?? 0

    if (
      queryLoading.value ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > totalPages ||
      page === pagination[dimension].page
    ) {
      return
    }

    pagination[dimension].page = page
    retry()
  }

  function retryDimension(_dimension: SourceDimension) {
    retry()
  }

  function retryAll() {
    retry()
  }

  function loadSources() {
    retry()
  }

  return {
    dimensions,
    pagination,
    data,
    meta,
    loading,
    errors,
    changePage,
    retryDimension,
    retryAll,
    loadSources,
  }
}
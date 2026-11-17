
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PageContainer from '../components/common/PageContainer.vue'
import { apiClient, ApiClientError } from '../services/api/client'
import { useAppStore } from '../stores/app'
import { useAnalyticsQuery } from '../composables/useAnalyticsQuery'
import {
  getAnalyticsRangeLabel,
  isAnalyticsMetaValid,
  isPaginationMetaValid,
} from '../utils/analytics-meta'
import type {
  LocationSortBy,
  LocationsMeta,
  LocationsResponse,
} from '../types/analytics'
import type { AnalyticsRange } from '../types/common'

interface SortOption {
  label: string
  value: LocationSortBy
}

interface LocationsQueryResult {
  data: LocationsResponse
  meta: LocationsMeta
}

const sortOptions: SortOption[] = [
  { label: 'PV', value: 'pv' },
  { label: 'UV', value: 'uv' },
  { label: '国家代码', value: 'country_code' },
  { label: '地区', value: 'region' },
  { label: '城市', value: 'city' },
]

const store = useAppStore()

const currentPage = ref(1)
const pageSize = ref(10)
const sortBy = ref<LocationSortBy>('pv')
const sortOrder = ref<'asc' | 'desc'>('desc')

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

const sortLabel = computed(() => {
  return sortOptions.find(
    option => option.value === sortBy.value,
  )?.label ?? 'PV'
})

/**
 * 全局站点或时间范围变化时，先同步重置页码。
 * 必须在 useAnalyticsQuery 之前注册。
 */
watch(
  () => [store.siteId, store.dateRange] as const,
  () => {
    currentPage.value = 1
  },
  { flush: 'sync' },
)

function isValidLocationsResponse(
  data: unknown,
): data is LocationsResponse {
  if (
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data)
  ) {
    return false
  }

  const result = data as Record<string, unknown>

  if (!Array.isArray(result.items)) {
    return false
  }

  return result.items.every((item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      Array.isArray(item)
    ) {
      return false
    }

    const record = item as Record<string, unknown>

    const validLocationField = (value: unknown) =>
      value === null || typeof value === 'string'

    return (
      validLocationField(record.country_code) &&
      validLocationField(record.region) &&
      validLocationField(record.city) &&
      typeof record.pv === 'number' &&
      Number.isFinite(record.pv) &&
      Number.isInteger(record.pv) &&
      record.pv >= 0 &&
      typeof record.uv === 'number' &&
      Number.isFinite(record.uv) &&
      Number.isInteger(record.uv) &&
      record.uv >= 0
    )
  })
}

function isValidLocationsMeta(
  meta: unknown,
  siteId: string,
  range: AnalyticsRange,
  expectedPage: number,
  expectedPageSize: number,
  expectedSortBy: LocationSortBy,
  expectedSortOrder: 'asc' | 'desc',
): meta is LocationsMeta {
  if (
    !isAnalyticsMetaValid(meta, siteId, range) ||
    !isPaginationMetaValid(
      meta,
      expectedPage,
      expectedPageSize,
    )
  ) {
    return false
  }

  const result = meta as LocationsMeta

  if (
    result.page_size > 100 ||
    result.sort_by !== expectedSortBy ||
    result.sort_order !== expectedSortOrder
  ) {
    return false
  }

  if (
    result.total_pages !==
    Math.ceil(result.total / result.page_size)
  ) {
    return false
  }

  return result.total === 0
    ? result.page === 1
    : result.page <= result.total_pages
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
    return error.message || '获取地域分析数据失败，请稍后重试。'
  }

  return '获取地域分析数据失败，请稍后重试。'
}

const {
  data: queryResult,
  loading,
  errorMessage,
  retry,
} = useAnalyticsQuery<LocationsQueryResult | null>(
  async ({ siteId, range, signal }) => {
    // 固定本次请求参数，确保响应校验对应请求快照。
    const requestedPage = currentPage.value
    const requestedPageSize = pageSize.value
    const requestedSortBy = sortBy.value
    const requestedSortOrder = sortOrder.value

    try {
      const response = await apiClient.get<
        LocationsResponse,
        LocationsMeta
      >(
        '/api/analytics/locations',
        {
          site_id: siteId,
          range,
          page: requestedPage,
          page_size: requestedPageSize,
          sort_by: requestedSortBy,
          sort_order: requestedSortOrder,
        },
        { signal },
      )

      if (!isValidLocationsResponse(response.data)) {
        throw new Error(
          '地域分析接口返回的数据格式异常，请检查 API 响应。',
        )
      }

      if (
        !isValidLocationsMeta(
          response.meta,
          siteId,
          range,
          requestedPage,
          requestedPageSize,
          requestedSortBy,
          requestedSortOrder,
        )
      ) {
        throw new Error(
          '地域分析接口返回的站点、时间范围、分页或排序信息与当前请求不一致。',
        )
      }

      if (
        response.data.items.length >
        response.meta.page_size
      ) {
        throw new Error(
          '地域分析接口返回的数据条数超过分页限制。',
        )
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

const locations = computed(() =>
  queryResult.value?.data ?? null,
)

const locationsMeta = computed(() =>
  queryResult.value?.meta ?? null,
)

const hasLocationData = computed(() =>
  (locations.value?.items.length ?? 0) > 0,
)

/**
 * 切换排序字段。
 * 新字段默认降序；再次点击当前字段则切换排序方向。
 */
function changeSort(field: LocationSortBy) {
  if (sortBy.value === field) {
    sortOrder.value =
      sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortBy.value = field
    sortOrder.value =
      field === 'country_code' ||
      field === 'region' ||
      field === 'city'
        ? 'asc'
        : 'desc'
  }

  currentPage.value = 1
  retry()
}

/**
 * 切换分页。
 */
function changePage(page: number) {
  const totalPages = locationsMeta.value?.total_pages ?? 0

  if (
    loading.value ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > totalPages ||
    page === currentPage.value
  ) {
    return
  }

  currentPage.value = page
  retry()
}

/**
 * 手动重新加载。
 */
function retryLoad() {
  retry()
}

/**
 * 返回当前排序字段对应的图标。
 */
function getSortIndicator(field: LocationSortBy): string {
  if (sortBy.value !== field) return '↕'

  return sortOrder.value === 'asc' ? '↑' : '↓'
}

/**
 * 地理位置字段为空时显示“未知”。
 */
function formatLocation(value: string | null): string {
  const normalized = value?.trim()
  return normalized || '未知'
}

/**
 * 国家代码展示统一大写。
 */
function formatCountryCode(value: string | null): string {
  const normalized = value?.trim()
  return normalized ? normalized.toUpperCase() : '未知'
}
</script>

<template>
  <PageContainer
    title="地域分析"
    description="查看访客的国家、地区和城市分布。"
  >
    <!-- 时间范围 -->

    <!-- 地理位置排行 -->
    <section class="locations-section">
      <div class="locations-section-heading">
        <div>
          <h2>地理位置排行</h2>
          <p>按照访客所在国家、地区和城市进行组合统计</p>
        </div>

        <span class="locations-range-label">
          {{ rangeLabel }}
        </span>
      </div>

      <!-- Loading -->
      <div
        v-if="loading"
        class="locations-state"
        role="status"
        aria-live="polite"
      >
        正在加载地域分析数据...
      </div>

      <!-- Error -->
      <div
        v-else-if="errorMessage"
        class="locations-state locations-error"
        role="alert"
      >
        <p>{{ errorMessage }}</p>

        <button
          type="button"
          @click="retryLoad"
        >
          重新加载
        </button>
      </div>

      <!-- Empty -->
      <div
        v-else-if="!locations || !hasLocationData"
        class="locations-state"
      >
        <p>所选时间范围内暂无地域访问数据</p>
        <span>
          当网站产生访问记录后，这里将展示访客的地理位置分布。
        </span>
      </div>

      <!-- Result -->
      <div
        v-else
        class="locations-result"
        aria-live="polite"
      >
        <!-- 数据摘要 -->
        <div class="locations-data-summary">
          <div>
            <span>位置数量</span>
            <strong>
              {{ (locationsMeta?.total ?? 0).toLocaleString() }}
            </strong>
          </div>

          <div>
            <span>当前页</span>
            <strong>
              {{ locationsMeta?.page ?? 1 }} /
              {{ locationsMeta?.total_pages ?? 0 }}
            </strong>
          </div>

          <div>
            <span>每页条数</span>
            <strong>
              {{ locationsMeta?.page_size ?? pageSize }}
            </strong>
          </div>

          <div>
            <span>当前排序</span>
            <strong class="locations-sort-summary">
              {{ sortLabel }}
              {{ sortOrder === 'desc' ? '降序' : '升序' }}
            </strong>
          </div>
        </div>

        <!-- 排行表格 -->
        <div class="locations-table-wrapper">
          <table class="locations-table">
            <thead>
              <tr>
                <th class="rank-column">
                  排名
                </th>

                <th>
                  <button
                    type="button"
                    class="locations-sort-button"
                    :class="{
                      active: sortBy === 'country_code',
                    }"
                    :disabled="loading"
                    @click="changeSort('country_code')"
                  >
                    国家代码
                    <span>
                      {{ getSortIndicator('country_code') }}
                    </span>
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    class="locations-sort-button"
                    :class="{ active: sortBy === 'region' }"
                    :disabled="loading"
                    @click="changeSort('region')"
                  >
                    地区
                    <span>
                      {{ getSortIndicator('region') }}
                    </span>
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    class="locations-sort-button"
                    :class="{ active: sortBy === 'city' }"
                    :disabled="loading"
                    @click="changeSort('city')"
                  >
                    城市
                    <span>
                      {{ getSortIndicator('city') }}
                    </span>
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    class="locations-sort-button"
                    :class="{ active: sortBy === 'pv' }"
                    :disabled="loading"
                    @click="changeSort('pv')"
                  >
                    PV
                    <span>
                      {{ getSortIndicator('pv') }}
                    </span>
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    class="locations-sort-button"
                    :class="{ active: sortBy === 'uv' }"
                    :disabled="loading"
                    @click="changeSort('uv')"
                  >
                    UV
                    <span>
                      {{ getSortIndicator('uv') }}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="(item, index) in locations.items"
                :key="[
                  item.country_code ?? '',
                  item.region ?? '',
                  item.city ?? '',
                ].join('|')"
              >
                <td class="rank-cell">
                  <span class="rank-number">
                    {{
                      (currentPage - 1) * pageSize + index + 1
                    }}
                  </span>
                </td>

                <td class="country-cell">
                  <span>
                    {{ formatCountryCode(item.country_code) }}
                  </span>
                </td>

                <td class="location-cell">
                  {{ formatLocation(item.region) }}
                </td>

                <td class="location-cell">
                  {{ formatLocation(item.city) }}
                </td>

                <td class="metric-cell">
                  {{ item.pv.toLocaleString() }}
                </td>

                <td class="metric-cell">
                  {{ item.uv.toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 分页 -->
        <div class="locations-pagination">
          <span class="pagination-info">
            共 {{ locationsMeta?.total ?? 0 }} 条记录
          </span>

          <div class="pagination-controls">
            <button
              type="button"
              :disabled="loading || currentPage <= 1"
              @click="changePage(currentPage - 1)"
            >
              上一页
            </button>

            <span class="pagination-current">
              {{ currentPage }} /
              {{ locationsMeta?.total_pages ?? 0 }}
            </span>

            <button
              type="button"
              :disabled="
                loading ||
                currentPage >= (locationsMeta?.total_pages ?? 0)
              "
              @click="changePage(currentPage + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </section>
  </PageContainer>
</template>

<style scoped>
.locations-section {
  margin-bottom: 24px;
}

.locations-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.locations-section-heading h2 {
  margin: 0;
  color: #334155;
  font-size: 15px;
  font-weight: 650;
}

.locations-section-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.locations-range-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.locations-range-button {
  padding: 8px 16px;
  color: #64748b;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.locations-range-button:hover {
  color: #0f9488;
  border-color: #14b8a6;
}

.locations-range-button.active {
  color: #0f9488;
  background: #eafaf7;
  border-color: #14b8a6;
  font-weight: 600;
}

.locations-range-label {
  flex-shrink: 0;
  padding: 5px 10px;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.locations-state {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  color: #89939e;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  font-size: 13px;
  text-align: center;
}

.locations-state p {
  margin: 0;
}

.locations-state span {
  color: #94a3b8;
  font-size: 12px;
}

.locations-error {
  color: #dc5252;
}

.locations-error button {
  padding: 7px 14px;
  color: #0f766e;
  background: #eaf8f6;
  border: 0;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.locations-result {
  padding: 20px;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 12px;
}

.locations-data-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  margin-bottom: 22px;
}

.locations-data-summary > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.locations-data-summary span {
  color: #94a3b8;
  font-size: 12px;
}

.locations-data-summary strong {
  color: #334155;
  font-size: 19px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.locations-data-summary .locations-sort-summary {
  font-size: 14px;
}

.locations-table-wrapper {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #edf1f4;
  border-radius: 8px;
}

.locations-table {
  width: 100%;
  min-width: 680px;
  border-collapse: collapse;
  text-align: left;
}

.locations-table thead {
  background: #f8fafc;
}

.locations-table th {
  height: 46px;
  padding: 0 16px;
  color: #64748b;
  border-bottom: 1px solid #edf1f4;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.locations-table td {
  height: 56px;
  padding: 10px 16px;
  color: #475569;
  border-bottom: 1px solid #f1f5f9;
  font-size: 13px;
}

.locations-table tbody tr:last-child td {
  border-bottom: 0;
}

.locations-table tbody tr:hover {
  background: #f8fcfb;
}

.rank-column,
.rank-cell {
  width: 76px;
}

.rank-number {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 650;
}

.country-cell {
  min-width: 110px;
  font-weight: 600;
}

.location-cell {
  min-width: 130px;
}

.metric-cell {
  font-variant-numeric: tabular-nums;
}

.locations-sort-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  color: #64748b;
  background: transparent;
  border: 0;
  font: inherit;
  cursor: pointer;
}

.locations-sort-button:hover,
.locations-sort-button.active {
  color: #0f9488;
}

.locations-sort-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.locations-sort-button span {
  color: #94a3b8;
  font-size: 14px;
}

.locations-sort-button.active span {
  color: #0f9488;
}

.locations-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
}

.pagination-info {
  color: #94a3b8;
  font-size: 12px;
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pagination-controls button {
  padding: 7px 12px;
  color: #475569;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.pagination-controls button:hover:not(:disabled) {
  color: #0f9488;
  border-color: #14b8a6;
}

.pagination-controls button:disabled {
  color: #cbd5e1;
  background: #f8fafc;
  cursor: not-allowed;
}

.pagination-current {
  color: #475569;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (max-width: 560px) {
  .locations-section-heading {
    align-items: flex-start;
  }

  .locations-range-button {
    padding: 8px 12px;
    font-size: 12px;
  }

  .locations-result {
    padding: 16px;
  }

  .locations-data-summary {
    gap: 20px;
  }

  .locations-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-controls {
    width: 100%;
    justify-content: space-between;
  }

  .locations-table th,
  .locations-table td {
    padding-right: 12px;
    padding-left: 12px;
  }
}
</style>

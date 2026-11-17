
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PageContainer from '../components/common/PageContainer.vue'
import { apiClient } from '../services/api/client'
import { useAppStore } from '../stores/app'
import { useAnalyticsQuery } from '../composables/useAnalyticsQuery'
import {
  getAnalyticsRangeLabel,
  isAnalyticsMetaValid,
  isPaginationMetaValid,
} from '../utils/analytics-meta'
import type {
  PageSortBy,
  PagesMeta,
  PagesResponse,
} from '../types/analytics'

const store = useAppStore()

const currentPage = ref(1)
const pageSize = ref(10)
const sortBy = ref<PageSortBy>('pv')
const sortOrder = ref<'asc' | 'desc'>('desc')

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

/**
 * 校验 Pages API 返回的数据结构。
 */
function isValidPagesResponse(
  data: unknown,
): data is PagesResponse {
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

    return (
      typeof record.page_path === 'string' &&
      record.page_path.trim().length > 0 &&
      typeof record.pv === 'number' &&
      Number.isFinite(record.pv) &&
      record.pv >= 0 &&
      typeof record.uv === 'number' &&
      Number.isFinite(record.uv) &&
      record.uv >= 0 &&
      typeof record.pv_share === 'number' &&
      Number.isFinite(record.pv_share) &&
      record.pv_share >= 0 &&
      record.pv_share <= 100
    )
  })
}

/**
 * 全局筛选变化时，先同步重置分页。
 * flush: sync 确保 useAnalyticsQuery 的筛选监听执行前，
 * currentPage 已经回到第一页。
 */
watch(
  () => [store.siteId, store.dateRange] as const,
  () => {
    currentPage.value = 1
  },
  { flush: 'sync' },
)

const {
  data: queryResult,
  loading,
  errorMessage,
  retry: retryLoad,
} = useAnalyticsQuery<{
  data: PagesResponse
  meta: PagesMeta
} | null>(
  async ({ siteId, range, signal }) => {
    const response = await apiClient.get<
      PagesResponse,
      PagesMeta
    >(
      '/api/analytics/pages',
      {
        site_id: siteId,
        range,
        page: currentPage.value,
        page_size: pageSize.value,
        sort_by: sortBy.value,
        sort_order: sortOrder.value,
      },
      {
        signal,
      },
    )

    if (!isAnalyticsMetaValid(response.meta, siteId, range)) {
      throw new Error(
        '页面分析接口返回的站点、时间范围或时区信息不匹配。',
      )
    }

    if (
      !isPaginationMetaValid(
        response.meta,
        currentPage.value,
        pageSize.value,
      )
    ) {
      throw new Error(
        '页面分析接口返回的分页信息与请求不一致。',
      )
    }

    if (
      !isValidPagesResponse(response.data) ||
      !['pv', 'uv', 'pv_share', 'page_path'].includes(
        response.meta.sort_by,
      ) ||
      !['asc', 'desc'].includes(response.meta.sort_order)
    ) {
      throw new Error(
        '页面分析接口返回的数据格式异常，请检查 API 响应。',
      )
    }

    if (
      response.meta.sort_by !== sortBy.value ||
      response.meta.sort_order !== sortOrder.value
    ) {
      throw new Error(
        '页面分析接口返回的排序信息与请求不一致。',
      )
    }

    return {
      data: response.data,
      meta: response.meta,
    }
  },
  () => null,
)

const pages = computed(() =>
  queryResult.value?.data ?? null,
)

const pagesMeta = computed(() =>
  queryResult.value?.meta ?? null,
)

const hasPageData = computed(() =>
  (pages.value?.items.length ?? 0) > 0,
)

/**
 * 切换排序字段。
 * 新字段默认降序；再次点击当前字段则切换排序方向。
 */
function changeSort(field: PageSortBy) {
  if (sortBy.value === field) {
    sortOrder.value =
      sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortBy.value = field
    sortOrder.value = field === 'page_path' ? 'asc' : 'desc'
  }

  currentPage.value = 1
  retryLoad()
}

/**
 * 切换分页。
 */
function changePage(page: number) {
  const totalPages = pagesMeta.value?.total_pages ?? 0

  if (
    loading.value ||
    page < 1 ||
    page > totalPages ||
    page === currentPage.value
  ) {
    return
  }

  currentPage.value = page
  retryLoad()
}

/**
 * 返回当前排序字段对应的图标。
 */
function getSortIndicator(field: PageSortBy): string {
  if (sortBy.value !== field) return '↕'

  return sortOrder.value === 'asc' ? '↑' : '↓'
}
</script>

<template>
  <PageContainer
    title="页面分析"
    description="了解访客访问的页面和内容。"
  >
    <section class="pages-section">
      <div class="pages-section-heading">
        <div>
          <h2>页面访问排行</h2>
          <p>按照页面访问情况统计和排序</p>
        </div>

        <span class="pages-range-label">
          {{ rangeLabel }}
        </span>
      </div>

      <div
        v-if="loading"
        class="pages-state"
        role="status"
        aria-live="polite"
      >
        正在加载页面分析数据...
      </div>

      <div
        v-else-if="errorMessage"
        class="pages-state pages-error"
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

      <div
        v-else-if="!pages || !hasPageData"
        class="pages-state"
      >
        <p>所选时间范围内暂无页面访问数据</p>
        <span>当网站产生访问记录后，这里将展示页面访问排行。</span>
      </div>

      <div
        v-else
        class="pages-result"
        aria-live="polite"
      >
        <div class="pages-data-summary">
          <div>
            <span>页面数量</span>
            <strong>{{ pagesMeta?.total ?? 0 }}</strong>
          </div>

          <div>
            <span>当前页</span>
            <strong>
              {{ pagesMeta?.page ?? 1 }} /
              {{ pagesMeta?.total_pages ?? 0 }}
            </strong>
          </div>

          <div>
            <span>每页条数</span>
            <strong>{{ pagesMeta?.page_size ?? pageSize }}</strong>
          </div>
        </div>

        <div class="pages-table-wrapper">
          <table class="pages-table">
            <thead>
              <tr>
                <th class="rank-column">排名</th>

                <th>
                  <button
                    type="button"
                    class="pages-sort-button path-sort"
                    :class="{ active: sortBy === 'page_path' }"
                    :disabled="loading"
                    @click="changeSort('page_path')"
                  >
                    页面路径
                    <span>{{ getSortIndicator('page_path') }}</span>
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    class="pages-sort-button"
                    :class="{ active: sortBy === 'pv' }"
                    :disabled="loading"
                    @click="changeSort('pv')"
                  >
                    PV
                    <span>{{ getSortIndicator('pv') }}</span>
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    class="pages-sort-button"
                    :class="{ active: sortBy === 'uv' }"
                    :disabled="loading"
                    @click="changeSort('uv')"
                  >
                    UV
                    <span>{{ getSortIndicator('uv') }}</span>
                  </button>
                </th>

                <th>
                  <button
                    type="button"
                    class="pages-sort-button"
                    :class="{ active: sortBy === 'pv_share' }"
                    :disabled="loading"
                    @click="changeSort('pv_share')"
                  >
                    PV 占比
                    <span>{{ getSortIndicator('pv_share') }}</span>
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="(item, index) in pages?.items ?? []"
                :key="item.page_path"
              >
                <td class="rank-cell">
                  <span class="rank-number">
                    {{ (currentPage - 1) * pageSize + index + 1 }}
                  </span>
                </td>

                <td class="path-cell">
                  <span :title="item.page_path">
                    {{ item.page_path }}
                  </span>
                </td>

                <td class="metric-cell">
                  {{ item.pv.toLocaleString() }}
                </td>

                <td class="metric-cell">
                  {{ item.uv.toLocaleString() }}
                </td>

                <td class="share-cell">
                  <div class="share-content">
                    <span>{{ item.pv_share.toFixed(2) }}%</span>
                    <div class="share-progress">
                      <div
                        class="share-progress-bar"
                        :style="{ width: `${item.pv_share}%` }"
                      />
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pages-pagination">
          <span class="pagination-info">
            共 {{ pagesMeta?.total ?? 0 }} 条记录
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
              {{ currentPage }} / {{ pagesMeta?.total_pages ?? 0 }}
            </span>

            <button
              type="button"
              :disabled="
                loading ||
                currentPage >= (pagesMeta?.total_pages ?? 0)
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
.pages-section {
  margin-bottom: 24px;
}

.pages-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.pages-section-heading h2 {
  margin: 0;
  color: #334155;
  font-size: 15px;
  font-weight: 650;
}

.pages-section-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.pages-range-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pages-range-button {
  padding: 8px 16px;
  color: #64748b;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.2s ease;
}

.pages-range-button:hover {
  color: #0f9488;
  border-color: #14b8a6;
}

.pages-range-button.active {
  color: #0f9488;
  background: #eafaf7;
  border-color: #14b8a6;
  font-weight: 600;
}

.pages-range-label {
  flex-shrink: 0;
  padding: 5px 10px;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.pages-state {
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

.pages-state p {
  margin: 0;
}

.pages-state span {
  color: #94a3b8;
  font-size: 12px;
}

.pages-error {
  color: #dc5252;
}

.pages-error button {
  padding: 7px 14px;
  color: #0f766e;
  background: #eaf8f6;
  border: 0;
  border-radius: 6px;
  font-size: 12px;
}

.pages-result {
  padding: 20px;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 12px;
}

.pages-data-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 36px;
}

.pages-data-summary > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pages-data-summary span {
  color: #94a3b8;
  font-size: 12px;
}

.pages-data-summary strong {
  color: #334155;
  font-size: 19px;
  font-weight: 600;
}

.pages-development-hint {
  margin: 20px 0 0;
  padding-top: 14px;
  color: #94a3b8;
  border-top: 1px solid #edf1f4;
  font-size: 12px;
}

@media (max-width: 560px) {
  .pages-section-heading {
    align-items: flex-start;
  }

  .pages-range-button {
    padding: 8px 12px;
    font-size: 12px;
  }

  .pages-result {
    padding: 16px;
  }

  .pages-data-summary {
    gap: 22px;
  }
}


.pages-table-wrapper {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #edf1f4;
  border-radius: 8px;
}

.pages-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  text-align: left;
}

.pages-table thead {
  background: #f8fafc;
}

.pages-table th {
  height: 46px;
  padding: 0 16px;
  color: #64748b;
  border-bottom: 1px solid #edf1f4;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.pages-table td {
  height: 56px;
  padding: 10px 16px;
  color: #475569;
  border-bottom: 1px solid #f1f5f9;
  font-size: 13px;
}

.pages-table tbody tr:last-child td {
  border-bottom: 0;
}

.pages-table tbody tr:hover {
  background: #f8fcfb;
}

.rank-column {
  width: 76px;
}

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

.path-cell {
  max-width: 360px;
}

.path-cell span {
  display: block;
  overflow: hidden;
  color: #334155;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-cell {
  font-variant-numeric: tabular-nums;
}

.share-cell {
  min-width: 150px;
}

.share-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.share-content > span {
  min-width: 58px;
  font-variant-numeric: tabular-nums;
}

.share-progress {
  width: 64px;
  height: 6px;
  overflow: hidden;
  background: #e9eef2;
  border-radius: 99px;
}

.share-progress-bar {
  height: 100%;
  background: #14b8a6;
  border-radius: 99px;
  transition: width 0.2s ease;
}

.pages-sort-button {
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

.pages-sort-button:hover,
.pages-sort-button.active {
  color: #0f9488;
}

.pages-sort-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.pages-sort-button span {
  color: #94a3b8;
  font-size: 14px;
}

.pages-sort-button.active span {
  color: #0f9488;
}

.pages-pagination {
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
  .pages-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-controls {
    width: 100%;
    justify-content: space-between;
  }

  .pages-table th,
  .pages-table td {
    padding-right: 12px;
    padding-left: 12px;
  }
}

</style>

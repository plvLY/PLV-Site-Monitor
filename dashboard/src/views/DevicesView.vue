
<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
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
  DeviceDimension,
  DeviceStatsItem,
  DevicesMeta,
  DevicesResponse,
} from '../types/analytics'
import type { AnalyticsRange } from '../types/common'

interface DimensionConfig {
  key: DeviceDimension
  title: string
  description: string
  emptyLabel: string
  nameLabel: string
}

interface DimensionPagination {
  page: number
  pageSize: number
}

interface DevicesQueryResult {
  data: DevicesResponse
  meta: DevicesMeta
}

const DEFAULT_PAGE_SIZE = 10

const dimensions: DeviceDimension[] = ['browser', 'os']

const dimensionConfigs: DimensionConfig[] = [
  {
    key: 'browser',
    title: '浏览器分布',
    description: '分析访客使用的浏览器类型',
    emptyLabel: '暂无浏览器数据',
    nameLabel: '浏览器',
  },
  {
    key: 'os',
    title: '操作系统分布',
    description: '分析访客使用的操作系统',
    emptyLabel: '暂无操作系统数据',
    nameLabel: '操作系统',
  },
]

const store = useAppStore()

const pagination = reactive<Record<DeviceDimension, DimensionPagination>>({
  browser: {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  },
  os: {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  },
})

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

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
      (item.device === null || typeof item.device === 'string') &&
      typeof item.pv === 'number' &&
      Number.isFinite(item.pv) &&
      item.pv >= 0 &&
      Number.isInteger(item.pv) &&
      typeof item.uv === 'number' &&
      Number.isFinite(item.uv) &&
      item.uv >= 0 &&
      Number.isInteger(item.uv)
    )
  })
}

function isValidDevicesResponse(
  data: unknown,
): data is DevicesResponse {
  if (!isRecord(data)) return false

  return (
    isValidDimensionResponse(data.browser) &&
    isValidDimensionResponse(data.os)
  )
}

function isValidDimensionMeta(
  value: unknown,
  expectedPage: number,
  expectedPageSize: number,
): boolean {
  if (
    !isPaginationMetaValid(
      value,
      expectedPage,
      expectedPageSize,
    )
  ) {
    return false
  }

  if (!isRecord(value)) return false

  const { page, page_size, total, total_pages } = value

  if (
    typeof page !== 'number' ||
    typeof page_size !== 'number' ||
    typeof total !== 'number' ||
    typeof total_pages !== 'number'
  ) {
    return false
  }

  if (
    page_size > 100 ||
    total_pages !== Math.ceil(total / page_size)
  ) {
    return false
  }

  if (total === 0) {
    return page === 1 && total_pages === 0
  }

  return page <= total_pages
}

function isValidDevicesMeta(
  meta: unknown,
  siteId: string,
  range: AnalyticsRange,
  requestedPagination: Record<DeviceDimension, DimensionPagination>,
): meta is DevicesMeta {
  if (!isAnalyticsMetaValid(meta, siteId, range)) {
    return false
  }

  if (!isRecord(meta)) return false

  return dimensions.every(dimension => {
    const expected = requestedPagination[dimension]

    return isValidDimensionMeta(
      meta[dimension],
      expected.page,
      expected.pageSize,
    )
  })
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
    return error.message || '获取设备分析数据失败，请稍后重试。'
  }

  return '获取设备分析数据失败，请稍后重试。'
}

// 必须先注册同步 watcher，再创建 useAnalyticsQuery。
// 确保全局筛选变化时，两个维度先重置页码。
watch(
  () => [store.siteId, store.dateRange] as const,
  () => {
    pagination.browser.page = 1
    pagination.os.page = 1
  },
  { flush: 'sync' },
)

const {
  data: queryResult,
  loading,
  errorMessage,
  retry,
} = useAnalyticsQuery<DevicesQueryResult | null>(
  async ({ siteId, range, signal }) => {
    const requestedPagination = {
      browser: {
        page: pagination.browser.page,
        pageSize: pagination.browser.pageSize,
      },
      os: {
        page: pagination.os.page,
        pageSize: pagination.os.pageSize,
      },
    }

    const response = await apiClient.get<
      DevicesResponse,
      DevicesMeta
    >(
      '/api/analytics/devices',
      {
        site_id: siteId,
        range,

        browser_page: requestedPagination.browser.page,
        browser_page_size: requestedPagination.browser.pageSize,

        os_page: requestedPagination.os.page,
        os_page_size: requestedPagination.os.pageSize,
      },
      { signal },
    ).catch((error: unknown) => {
      throw new Error(getRequestErrorMessage(error))
    })

    if (
      !isValidDevicesResponse(response.data) ||
      !isValidDevicesMeta(
        response.meta,
        siteId,
        range,
        requestedPagination,
      )
    ) {
      throw new Error(
        '设备分析接口返回的数据格式异常，请检查 API 响应。',
      )
    }

    for (const dimension of dimensions) {
      const dimensionMeta = response.meta[dimension]

      if (
        response.data[dimension].items.length >
        dimensionMeta.page_size
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
  },
  () => null,
)

const devices = computed(() => queryResult.value?.data ?? null)
const devicesMeta = computed(() => queryResult.value?.meta ?? null)

function changePage(
  dimension: DeviceDimension,
  page: number,
) {
  const totalPages =
    devicesMeta.value?.[dimension].total_pages ?? 0

  if (
    loading.value ||
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

function retryLoad() {
  retry()
}

function getItems(
  dimension: DeviceDimension,
): DeviceStatsItem[] {
  return devices.value?.[dimension].items ?? []
}

function getTotal(dimension: DeviceDimension): number {
  return devicesMeta.value?.[dimension].total ?? 0
}

function getTotalPages(dimension: DeviceDimension): number {
  return devicesMeta.value?.[dimension].total_pages ?? 0
}

function getCurrentPage(dimension: DeviceDimension): number {
  return pagination[dimension].page
}

function getPageSize(dimension: DeviceDimension): number {
  return pagination[dimension].pageSize
}

function getDeviceName(device: string | null): string {
  return device !== null && device.trim()
    ? device
    : '未知'
}

function isEmpty(dimension: DeviceDimension): boolean {
  return getItems(dimension).length === 0
}
</script>

<template>
  <PageContainer
    title="设备分析"
    description="分析访客使用的设备和浏览器，了解不同设备环境的访问表现。"
  >
    <section class="devices-section">
      <div class="devices-section-heading">
        <div>
          <h2>设备环境分析</h2>
          <p>分别查看浏览器和操作系统的访问数据</p>
        </div>

        <span class="devices-range-label">
          {{ rangeLabel }}
        </span>
      </div>

      <div
        v-if="loading"
        class="devices-global-state"
        role="status"
        aria-live="polite"
      >
        正在加载设备分析数据...
      </div>

      <div
        v-else-if="errorMessage"
        class="devices-global-state devices-error"
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
        v-else
        class="devices-grid"
        aria-live="polite"
      >
        <article
          v-for="config in dimensionConfigs"
          :key="config.key"
          class="devices-card"
        >
          <div class="devices-card-heading">
            <div>
              <h3>{{ config.title }}</h3>
              <p>{{ config.description }}</p>
            </div>

            <span class="devices-card-count">
              {{ getTotal(config.key).toLocaleString() }} 条
            </span>
          </div>

          <div
            v-if="!devices || isEmpty(config.key)"
            class="devices-state"
          >
            <p>{{ config.emptyLabel }}</p>
            <span>当网站产生访问记录后，这里将展示设备排行。</span>
          </div>

          <div
            v-else
            class="devices-result"
          >
            <div class="devices-table-wrapper">
              <table class="devices-table">
                <thead>
                  <tr>
                    <th class="rank-column">排名</th>
                    <th>{{ config.nameLabel }}</th>
                    <th>PV</th>
                    <th>UV</th>
                  </tr>
                </thead>

                <tbody>
                  <tr
                    v-for="(item, index) in getItems(config.key)"
                    :key="`${config.key}-${item.device ?? 'null'}-${index}`"
                  >
                    <td class="rank-cell">
                      <span class="rank-number">
                        {{
                          (getCurrentPage(config.key) - 1) *
                            getPageSize(config.key) +
                          index +
                          1
                        }}
                      </span>
                    </td>

                    <td class="device-name-cell">
                      <span :title="getDeviceName(item.device)">
                        {{ getDeviceName(item.device) }}
                      </span>
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

            <div class="devices-pagination">
              <span class="pagination-info">
                共 {{ getTotal(config.key).toLocaleString() }} 条
              </span>

              <div class="pagination-controls">
                <button
                  type="button"
                  :disabled="
                    loading ||
                    getCurrentPage(config.key) <= 1
                  "
                  @click="
                    changePage(
                      config.key,
                      getCurrentPage(config.key) - 1,
                    )
                  "
                >
                  上一页
                </button>

                <span class="pagination-current">
                  {{ getCurrentPage(config.key) }} /
                  {{ getTotalPages(config.key) }}
                </span>

                <button
                  type="button"
                  :disabled="
                    loading ||
                    getCurrentPage(config.key) >=
                      getTotalPages(config.key)
                  "
                  @click="
                    changePage(
                      config.key,
                      getCurrentPage(config.key) + 1,
                    )
                  "
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  </PageContainer>
</template>

<style scoped>
.devices-section {
  margin-bottom: 24px;
}

.devices-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.devices-section-heading h2 {
  margin: 0;
  color: #334155;
  font-size: 15px;
  font-weight: 650;
}

.devices-section-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.devices-range-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.devices-range-button {
  padding: 8px 16px;
  color: #64748b;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.devices-range-button:hover:not(:disabled) {
  color: #0f9488;
  border-color: #14b8a6;
}

.devices-range-button.active {
  color: #0f9488;
  background: #eafaf7;
  border-color: #14b8a6;
  font-weight: 600;
}

.devices-range-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.devices-range-label {
  flex-shrink: 0;
  padding: 5px 10px;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.devices-global-state {
  min-height: 170px;
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

.devices-global-state p {
  margin: 0;
}

.devices-error {
  color: #dc5252;
}

.devices-error p {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.devices-error button {
  padding: 7px 14px;
  color: #0f766e;
  background: #eaf8f6;
  border: 0;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.devices-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.devices-card {
  min-width: 0;
  padding: 20px;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 12px;
}

.devices-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-height: 54px;
  margin-bottom: 16px;
}

.devices-card-heading h3 {
  margin: 0;
  color: #334155;
  font-size: 14px;
  font-weight: 650;
}

.devices-card-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}

.devices-card-count {
  flex-shrink: 0;
  padding: 5px 9px;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.devices-state {
  min-height: 170px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  color: #89939e;
  font-size: 13px;
  text-align: center;
}

.devices-state p {
  margin: 0;
}

.devices-state span {
  color: #94a3b8;
  font-size: 12px;
}

.devices-table-wrapper {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #edf1f4;
  border-radius: 8px;
}

.devices-table {
  width: 100%;
  min-width: 360px;
  border-collapse: collapse;
  text-align: left;
}

.devices-table thead {
  background: #f8fafc;
}

.devices-table th {
  height: 42px;
  padding: 0 12px;
  color: #64748b;
  border-bottom: 1px solid #edf1f4;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.devices-table td {
  height: 50px;
  padding: 9px 12px;
  color: #475569;
  border-bottom: 1px solid #f1f5f9;
  font-size: 12px;
}

.devices-table tbody tr:last-child td {
  border-bottom: 0;
}

.devices-table tbody tr:hover {
  background: #f8fcfb;
}

.rank-column,
.rank-cell {
  width: 56px;
}

.rank-number {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 650;
}

.device-name-cell {
  max-width: 220px;
}

.device-name-cell span {
  display: block;
  overflow: hidden;
  color: #334155;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-cell {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.devices-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
}

.pagination-info {
  color: #94a3b8;
  font-size: 11px;
  white-space: nowrap;
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pagination-controls button {
  padding: 6px 9px;
  color: #475569;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 11px;
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
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .devices-grid {
    gap: 14px;
  }

  .devices-card {
    padding: 16px;
  }
}

@media (max-width: 680px) {
  .devices-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .devices-card {
    padding: 18px;
  }
}

@media (max-width: 560px) {
  .devices-section-heading {
    align-items: flex-start;
  }

  .devices-range-button {
    padding: 8px 12px;
    font-size: 12px;
  }

  .devices-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-controls {
    width: 100%;
    justify-content: space-between;
  }
}
</style>



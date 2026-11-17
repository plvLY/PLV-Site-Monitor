<script setup lang="ts">
import { computed } from 'vue'
import PageContainer from '../components/common/PageContainer.vue'
import { useSourcesData } from '../composables/useSourcesData'
import { useAppStore } from '../stores/app'
import { getAnalyticsRangeLabel } from '../utils/analytics-meta'
import type { SourceDimension } from '../types/analytics'

interface DimensionConfig {
  key: SourceDimension
  title: string
  description: string
  emptyLabel: string
  nameLabel: string
}

const store = useAppStore()

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

const dimensionConfigs: DimensionConfig[] = [
  {
    key: 'referrer_host',
    title: 'Referrer',
    description: '访客从哪些外部网站进入',
    emptyLabel: '暂无来源数据',
    nameLabel: '来源域名',
  },
  {
    key: 'utm_source',
    title: 'UTM Source',
    description: '识别推广流量来自哪个来源',
    emptyLabel: '暂无 UTM Source 数据',
    nameLabel: '流量来源',
  },
  {
    key: 'utm_medium',
    title: 'UTM Medium',
    description: '分析不同营销媒介带来的访问',
    emptyLabel: '暂无 UTM Medium 数据',
    nameLabel: '营销活动',
  },
  {
    key: 'utm_campaign',
    title: 'UTM Campaign',
    description: '分析不同营销活动的访问效果',
    emptyLabel: '暂无 UTM Campaign 数据',
    nameLabel: '营销活动',
  },
]

const {
  pagination,
  data,
  meta,
  loading,
  errors,
  changePage,
  retryDimension,
  retryAll,
} = useSourcesData()

function getSourceName(
  dimension: SourceDimension,
  source: string | null,
): string {
  if (source !== null && source.trim()) {
    return source
  }

  return dimension === 'referrer_host'
    ? '未识别来源'
    : '未设置'
}

function getTotal(dimension: SourceDimension): number {
  return meta.value?.[dimension].total ?? 0
}

function getTotalPages(dimension: SourceDimension): number {
  return meta.value?.[dimension].total_pages ?? 0
}

function getCurrentPage(dimension: SourceDimension): number {
  return pagination[dimension].page
}

function getPageSize(dimension: SourceDimension): number {
  return pagination[dimension].pageSize
}

function isEmpty(dimension: SourceDimension): boolean {
  return (data.value?.[dimension].items.length ?? 0) === 0
}

function changeDimensionPage(
  dimension: SourceDimension,
  page: number,
) {
  changePage(dimension, page)
}
</script>

<template>
  <PageContainer
    title="来源分析"
    description="分析访客来自哪些渠道，了解不同流量来源的访问表现。"
  >

    <section class="sources-section">
      <div class="sources-section-heading">
        <div>
          <h2>流量来源分析</h2>
          <p>分别查看来源域名、推广来源、媒介和活动数据</p>
        </div>

        <span class="sources-range-label">
          {{ rangeLabel }}
        </span>
      </div>

      <div class="sources-grid">
        <article
          v-for="config in dimensionConfigs"
          :key="config.key"
          class="sources-card"
        >
          <div class="sources-card-heading">
            <div>
              <h3>{{ config.title }}</h3>
              <p>{{ config.description }}</p>
            </div>

            <span class="sources-card-count">
              {{ getTotal(config.key).toLocaleString() }} 条
            </span>
          </div>

          <div
            v-if="loading[config.key]"
            class="sources-state"
            role="status"
            aria-live="polite"
          >
            正在加载{{ config.title }}数据...
          </div>

          <div
            v-else-if="errors[config.key]"
            class="sources-state sources-error"
            role="alert"
          >
            <p>{{ errors[config.key] }}</p>

            <button
              type="button"
              @click="retryDimension(config.key)"
            >
              重新加载
            </button>
          </div>

          <div
            v-else-if="!data || isEmpty(config.key)"
            class="sources-state"
          >
            <p>{{ config.emptyLabel }}</p>
            <span>当网站产生访问记录后，这里将展示来源排行。</span>
          </div>

          <div
            v-else
            class="sources-result"
            aria-live="polite"
          >
            <div class="sources-table-wrapper">
              <table class="sources-table">
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
                    v-for="(item, index) in data[config.key].items"
                    :key="`${config.key}-${item.source ?? 'null'}-${index}`"
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

                    <td class="source-name-cell">
                      <span :title="getSourceName(config.key, item.source)">
                        {{ getSourceName(config.key, item.source) }}
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

            <div class="sources-pagination">
              <span class="pagination-info">
                共 {{ getTotal(config.key).toLocaleString() }} 条
              </span>

              <div class="pagination-controls">
                <button
                  type="button"
                  :disabled="
                    loading[config.key] ||
                    getCurrentPage(config.key) <= 1
                  "
                  @click="
                    changeDimensionPage(
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
                    loading[config.key] ||
                    getCurrentPage(config.key) >=
                      getTotalPages(config.key)
                  "
                  @click="
                    changeDimensionPage(
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

      <div
        v-if="
          !loading.referrer_host &&
          !loading.utm_source &&
          !loading.utm_medium &&
          !loading.utm_campaign &&
          (
            errors.referrer_host ||
            errors.utm_source ||
            errors.utm_medium ||
            errors.utm_campaign
          )
        "
        class="sources-retry-all"
      >
        <button
          type="button"
          @click="retryAll"
        >
          重新加载全部来源数据
        </button>
      </div>
    </section>
  </PageContainer>
</template>

<style scoped>
.sources-section {
  margin-bottom: 24px;
}

.sources-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.sources-section-heading h2 {
  margin: 0;
  color: #334155;
  font-size: 15px;
  font-weight: 650;
}

.sources-section-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.sources-range-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sources-range-button {
  padding: 8px 16px;
  color: #64748b;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.sources-range-button:hover {
  color: #0f9488;
  border-color: #14b8a6;
}

.sources-range-button.active {
  color: #0f9488;
  background: #eafaf7;
  border-color: #14b8a6;
  font-weight: 600;
}

.sources-range-label {
  flex-shrink: 0;
  padding: 5px 10px;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.sources-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.sources-card {
  min-width: 0;
  padding: 20px;
  background: #fff;
  border: 1px solid #e9eef2;
  border-radius: 12px;
}

.sources-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-height: 54px;
  margin-bottom: 16px;
}

.sources-card-heading h3 {
  margin: 0;
  color: #334155;
  font-size: 14px;
  font-weight: 650;
}

.sources-card-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}

.sources-card-count {
  flex-shrink: 0;
  padding: 5px 9px;
  color: #0f9488;
  background: #eaf8f6;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.sources-state {
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

.sources-state p {
  margin: 0;
}

.sources-state span {
  color: #94a3b8;
  font-size: 12px;
}

.sources-error {
  color: #dc5252;
}

.sources-error p {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.sources-error button,
.sources-retry-all button {
  padding: 7px 14px;
  color: #0f766e;
  background: #eaf8f6;
  border: 0;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.sources-table-wrapper {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #edf1f4;
  border-radius: 8px;
}

.sources-table {
  width: 100%;
  min-width: 360px;
  border-collapse: collapse;
  text-align: left;
}

.sources-table thead {
  background: #f8fafc;
}

.sources-table th {
  height: 42px;
  padding: 0 12px;
  color: #64748b;
  border-bottom: 1px solid #edf1f4;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.sources-table td {
  height: 50px;
  padding: 9px 12px;
  color: #475569;
  border-bottom: 1px solid #f1f5f9;
  font-size: 12px;
}

.sources-table tbody tr:last-child td {
  border-bottom: 0;
}

.sources-table tbody tr:hover {
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

.source-name-cell {
  max-width: 220px;
}

.source-name-cell span {
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

.sources-pagination {
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

.sources-retry-all {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}

@media (max-width: 900px) {
  .sources-grid {
    gap: 14px;
  }

  .sources-card {
    padding: 16px;
  }
}

@media (max-width: 680px) {
  .sources-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .sources-card {
    padding: 18px;
  }
}

@media (max-width: 560px) {
  .sources-section-heading {
    align-items: flex-start;
  }

  .sources-range-button {
    padding: 8px 12px;
    font-size: 12px;
  }

  .sources-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-controls {
    width: 100%;
    justify-content: space-between;
  }
}
</style>

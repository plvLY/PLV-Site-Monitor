
<script setup lang="ts">
import { computed } from 'vue'
import { apiClient } from '../../services/api/client'
import { useAppStore } from '../../stores/app'
import { useAnalyticsQuery } from '../../composables/useAnalyticsQuery'
import {
  getAnalyticsRangeLabel,
  isAnalyticsMetaValid,
  isPaginationMetaValid,
} from '../../utils/analytics-meta'
import type {
  SourceDimension,
  SourcesMeta,
  SourcesResponse,
} from '../../types/analytics'

const store = useAppStore()

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

const dimensions: {
  key: SourceDimension
  title: string
  description: string
}[] = [
  {
    key: 'referrer_host',
    title: 'Referrer',
    description: '外部引荐网站',
  },
  {
    key: 'utm_source',
    title: 'UTM Source',
    description: '推广来源',
  },
  {
    key: 'utm_medium',
    title: 'UTM Medium',
    description: '营销媒介',
  },
  {
    key: 'utm_campaign',
    title: 'UTM Campaign',
    description: '营销活动',
  },
]

const {
  data,
  loading,
  errorMessage,
  retry,
} = useAnalyticsQuery<SourcesResponse | null>(
  async ({ siteId, range, signal }) => {
    const response = await apiClient.get<
      SourcesResponse,
      SourcesMeta
    >(
      '/api/analytics/sources',
      {
        site_id: siteId,
        range,
        referrer_host_page: 1,
        referrer_host_page_size: 5,
        utm_source_page: 1,
        utm_source_page_size: 5,
        utm_medium_page: 1,
        utm_medium_page_size: 5,
        utm_campaign_page: 1,
        utm_campaign_page_size: 5,
      },
      { signal },
    )

    if (!isAnalyticsMetaValid(response.meta, siteId, range)) {
      throw new Error('流量来源接口返回的站点、时间范围或时区信息不匹配。')
    }

    for (const dimension of dimensions) {
      const items = response.data[dimension.key]?.items
      const meta = response.meta[dimension.key]

      if (
        !isPaginationMetaValid(meta, 1, 5) ||
        !Array.isArray(items) ||
        !items.every(item =>
          (item.source === null || typeof item.source === 'string') &&
          typeof item.pv === 'number' &&
          Number.isFinite(item.pv) &&
          item.pv >= 0 &&
          typeof item.uv === 'number' &&
          Number.isFinite(item.uv) &&
          item.uv >= 0,
        )
      ) {
        throw new Error(
          `${dimension.title} 接口返回的数据或分页信息异常。`,
        )
      }
    }

    return response.data
  },
  () => null,
)

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
</script>


<template>
  <section class="overview-top-sources">
    <div class="top-sources-heading">
      <div>
        <h2>流量来源</h2>
        <p>{{ rangeLabel }}访客来源分布</p>
      </div>

      <span class="top-sources-period">{{ rangeLabel }}</span>
    </div>

    <div v-if="loading" class="top-sources-state" role="status">
      正在加载流量来源...
    </div>

    <div
      v-else-if="errorMessage"
      class="top-sources-state top-sources-error"
      role="alert"
    >
      <p>{{ errorMessage }}</p>
      <button type="button" @click="retry">重新加载</button>
    </div>

    <div v-else-if="data" class="top-sources-list">
      <div
        v-for="dimension in dimensions"
        :key="dimension.key"
        class="top-source-group"
      >
        <div class="top-source-group-heading">
          <div>
            <h3>{{ dimension.title }}</h3>
            <p>{{ dimension.description }}</p>
          </div>

          <span class="top-source-total">
            {{ data[dimension.key].items.length }} 项
          </span>
        </div>

        <div
          v-if="data[dimension.key].items.length === 0"
          class="top-source-empty"
        >
          暂无数据
        </div>

        <div
          v-for="(item, index) in data[dimension.key].items.slice(0, 5)"
          :key="`${dimension.key}-${item.source ?? 'null'}-${index}`"
          class="top-source-item"
        >
          <span class="top-source-rank">{{ index + 1 }}</span>

          <span
            class="top-source-name"
            :title="getSourceName(dimension.key, item.source)"
          >
            {{ getSourceName(dimension.key, item.source) }}
          </span>

          <span class="top-source-metric">
            {{ item.pv.toLocaleString() }} PV
          </span>

          <span class="top-source-uv">
            {{ item.uv.toLocaleString() }} UV
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.overview-top-sources {
  min-width: 0;
  padding: 20px;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  background: #fff;
}

.top-sources-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.top-sources-heading h2 {
  margin: 0;
  color: #334155;
  font-size: 15px;
  font-weight: 650;
}

.top-sources-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.top-sources-period {
  flex-shrink: 0;
  padding: 5px 9px;
  border-radius: 6px;
  background: #eaf8f6;
  color: #0f9488;
  font-size: 11px;
}

.top-sources-list {
  display: flex;
  flex-direction: column;
  gap: 17px;
}

.top-source-group {
  padding-bottom: 14px;
  border-bottom: 1px solid #f1f5f9;
}

.top-source-group:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.top-source-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.top-source-group-heading h3 {
  margin: 0;
  color: #475569;
  font-size: 12px;
  font-weight: 650;
}

.top-source-group-heading p {
  margin: 4px 0 0;
  color: #a0aab7;
  font-size: 11px;
}

.top-source-total {
  color: #94a3b8;
  font-size: 11px;
}

.top-source-item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 9px;
  min-height: 32px;
}

.top-source-rank {
  display: inline-flex;
  width: 21px;
  height: 21px;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 10px;
}

.top-source-item:nth-of-type(2) .top-source-rank {
  background: #eaf8f6;
  color: #0f9488;
}

.top-source-name {
  overflow: hidden;
  color: #475569;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-source-metric,
.top-source-uv {
  color: #64748b;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.top-source-uv {
  color: #94a3b8;
}

.top-source-empty {
  padding: 10px 0;
  color: #a0aab7;
  font-size: 12px;
}

.top-sources-state {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: #89939e;
  font-size: 13px;
  text-align: center;
}

.top-sources-state p {
  margin: 0;
}

.top-sources-error {
  color: #dc5252;
}

.top-sources-error button {
  padding: 7px 14px;
  border: 1px solid #e9eef2;
  border-radius: 6px;
  background: #fff;
  color: #0f766e;
  font-size: 12px;
  cursor: pointer;
}

@media (max-width: 420px) {
  .top-source-item {
    grid-template-columns: 22px minmax(0, 1fr) auto;
  }

  .top-source-uv {
    display: none;
  }
}
</style>




<script setup lang="ts">
import { computed } from 'vue'
import PageContainer from '../components/common/PageContainer.vue'
import { apiClient } from '../services/api/client'
import { useAppStore } from '../stores/app'
import { useAnalyticsQuery } from '../composables/useAnalyticsQuery'
import {
  getAnalyticsRangeLabel,
  isAnalyticsMetaValid,
} from '../utils/analytics-meta'
import type {
  TrendGranularity,
  TrendsMeta,
  TrendsResponse,
} from '../types/analytics'
import TrendsChart from '../components/trends/TrendsChart.vue'

const store = useAppStore()

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

function getGranularityLabel(
  granularity: TrendGranularity,
): string {
  return granularity === 'hour' ? '按小时统计' : '按天统计'
}

/**
 * 对 API 返回的数据进行运行时校验。
 * TypeScript 类型无法保证服务端实际返回的数据结构正确。
 */
function isValidTrendsResponse(
  data: unknown,
): data is TrendsResponse {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const result = data as Record<string, unknown>

  if (
    result.granularity !== 'hour' &&
    result.granularity !== 'day'
  ) {
    return false
  }

  if (!Array.isArray(result.items)) {
    return false
  }

  return result.items.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      return false
    }

    const record = item as Record<string, unknown>

    if (
      typeof record.date !== 'string' ||
      !record.date.trim() ||
      typeof record.pv !== 'number' ||
      !Number.isFinite(record.pv) ||
      record.pv < 0 ||
      typeof record.uv !== 'number' ||
      !Number.isFinite(record.uv) ||
      record.uv < 0
    ) {
      return false
    }

    if (result.granularity === 'hour') {
      return (
        typeof record.bucket_start_utc === 'string' &&
        record.bucket_start_utc.length > 0 &&
        typeof record.offset_minutes === 'number' &&
        Number.isInteger(record.offset_minutes)
      )
    }

    return true
  })
}

const {
  data: trends,
  loading,
  errorMessage,
  retry: retryLoad,
} = useAnalyticsQuery<TrendsResponse | null>(
  async ({ siteId, range, signal }) => {
    const response = await apiClient.get<
      TrendsResponse,
      TrendsMeta
    >(
      '/api/analytics/trends',
      {
        site_id: siteId,
        range,
      },
      {
        signal,
      },
    )

    if (!isAnalyticsMetaValid(response.meta, siteId, range)) {
      throw new Error(
        '趋势接口返回的站点、时间范围或时区信息不匹配。',
      )
    }

    if (!isValidTrendsResponse(response.data)) {
      throw new Error(
        '趋势接口返回的数据格式异常，请检查 API 响应。',
      )
    }

    return response.data
  },
  () => null,
)

const hasTrendData = computed(() => {
  return trends.value?.items.some(
    item => item.pv > 0 || item.uv > 0,
  ) ?? false
})

const granularityLabel = computed(() => {
  return trends.value
    ? getGranularityLabel(trends.value.granularity)
    : ''
})
</script>


<template>
  <PageContainer
    title="访问趋势"
    description="跟踪网站访问量和用户变化趋势。"
  >
    <section class="trends-section">
      <div class="trends-section-heading">
        <div>
          <h2>访问趋势</h2>
          <p>
            {{ granularityLabel || '等待加载数据' }}
          </p>
        </div>

        <span class="trends-range-label">
          {{ rangeLabel }}
        </span>
      </div>

      <div
        v-if="loading"
        class="trends-state"
        role="status"
        aria-live="polite"
      >
        正在加载访问趋势...
      </div>

      <div
        v-else-if="errorMessage"
        class="trends-state trends-error"
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
        v-else-if="!trends || !hasTrendData"
        class="trends-state"
      >
        <p>所选时间范围内暂无访问数据</p>
        <span>当网站产生访问记录后，这里将展示 PV / UV 趋势。</span>
      </div>

      <div v-else class="trends-result">
        <div class="trends-data-summary">
          <div>
            <span>统计时间点</span>
            <strong>{{ trends.items.length }}</strong>
          </div>

          <div>
            <span>统计粒度</span>
            <strong>
              {{ trends.granularity === 'hour' ? '小时' : '日' }}
            </strong>
          </div>
        </div>

        <TrendsChart
          :items="trends.items"
          :granularity="trends.granularity"
        />
      </div>
    </section>
  </PageContainer>
</template>

<style scoped>
.trends-section {
  margin-bottom: 24px;
}

.trends-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.trends-section-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.trends-section-heading p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #89939e;
}

.trends-range-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.trends-range-button {
  padding: 8px 16px;
  border: 1px solid #e9eef2;
  border-radius: 8px;
  background: #fff;
  color: #64748b;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.trends-range-button:hover:not(:disabled) {
  border-color: #14b8a6;
  color: #0f9488;
}

.trends-range-button.active {
  border-color: #14b8a6;
  background: #eafaf7;
  color: #0f9488;
  font-weight: 600;
}

.trends-range-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.trends-range-label {
  padding: 5px 10px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 12px;
}

.trends-state {
  min-height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  background: #fff;
  color: #89939e;
  font-size: 13px;
}

.trends-error {
  color: #dc5252;
}

.trends-error button {
  padding: 6px 14px;
  border: 1px solid #e9eef2;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

.trends-loaded {
  flex-direction: row;
  gap: 20px;
  color: #0f9488;
}


.trends-result {
  padding: 16px 20px 12px;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  background: #ffffff;
}

.trends-data-summary {
  display: flex;
  gap: 36px;
  padding-bottom: 12px;
}

.trends-data-summary > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.trends-data-summary span {
  color: #94a3b8;
  font-size: 12px;
}

.trends-data-summary strong {
  color: #334155;
  font-size: 18px;
  font-weight: 600;
}

</style>

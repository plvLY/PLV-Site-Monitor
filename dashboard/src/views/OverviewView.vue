<script setup lang="ts">
import { computed } from 'vue'
import PageContainer from '../components/common/PageContainer.vue'
import OverviewMetricCard from '../components/overview/OverviewMetricCard.vue'
import OverviewTrendChart from '../components/overview/OverviewTrendChart.vue'
import OverviewTopPages from '../components/overview/OverviewTopPages.vue'
import OverviewTopSources from '../components/overview/OverviewTopSources.vue'
import { apiClient } from '../services/api/client'
import { useAppStore } from '../stores/app'
import { useAnalyticsQuery } from '../composables/useAnalyticsQuery'
import {
  getAnalyticsRangeLabel,
  isAnalyticsMetaValid,
} from '../utils/analytics-meta'
import type {
  OverviewMeta,
  OverviewResponse,
} from '../types/analytics'

const store = useAppStore()

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

const {
  data: stats,
  loading,
  errorMessage,
  retry: loadOverview,
} = useAnalyticsQuery<OverviewResponse | null>(
  async ({ siteId, range, signal }) => {
    const response = await apiClient.get<
      OverviewResponse,
      OverviewMeta
    >(
      '/api/analytics/overview',
      {
        site_id: siteId,
        range,
      },
      { signal },
    )

    if (!isAnalyticsMetaValid(response.meta, siteId, range)) {
      throw new Error('网站总览接口返回的站点、时间范围或时区信息不匹配。')
    }

    const value = response.data

    if (
      !value ||
      !Number.isFinite(value.pv) ||
      !Number.isFinite(value.uv) ||
      !Number.isFinite(value.sessions) ||
      !Number.isFinite(value.bounce_sessions) ||
      (value.bounce_rate !== null &&
        !Number.isFinite(value.bounce_rate))
    ) {
      throw new Error('网站总览接口返回的数据格式异常。')
    }

    return value
  },
  () => null,
)

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatBounceRate(value: number | null): string {
  return value === null ? '暂无数据' : `${value}%`
}
</script>


<template>
  <PageContainer
    title="网站总览"
    description="了解你的网站整体访问表现。"
  >
    <div class="overview-section">
      <div class="overview-section-heading">
        <div>
          <h2>核心指标</h2>
          <p>{{ rangeLabel }}的网站访问数据</p>
        </div>

        <span class="overview-range-label">{{ rangeLabel }}</span>
      </div>

      <div v-if="errorMessage" class="overview-error">
        <p>{{ errorMessage }}</p>
        <button @click="loadOverview">重新加载</button>
      </div>

      <div class="overview-metrics-grid">
        <OverviewMetricCard
          title="浏览量 PV"
          :value="stats ? formatNumber(stats.pv) : '--'"
          description="页面累计浏览次数"
          icon="↗"
          :loading="loading"
        />

        <OverviewMetricCard
          title="独立访客 UV"
          :value="stats ? formatNumber(stats.uv) : '--'"
          description="去重后的访客数量"
          icon="◉"
          :loading="loading"
        />

        <OverviewMetricCard
          title="访问会话"
          :value="stats ? formatNumber(stats.sessions) : '--'"
          description="网站访问会话总数"
          icon="⌁"
          :loading="loading"
        />

        <OverviewMetricCard
          title="跳出率"
          :value="stats ? formatBounceRate(stats.bounce_rate) : '--'"
          :description="
            stats
              ? `跳出会话 ${formatNumber(stats.bounce_sessions)} 次`
              : '跳出会话统计'
          "
          icon="%"
          :loading="loading"
        />
      </div>
      <OverviewTrendChart />

      <div class="overview-detail-grid">
        <OverviewTopPages />
        <OverviewTopSources />
      </div>
    </div>
  </PageContainer>
</template>

<style scoped>
.overview-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 24px;
}

@media (max-width: 900px) {
  .overview-detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

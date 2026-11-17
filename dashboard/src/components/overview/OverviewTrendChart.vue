
<script setup lang="ts">
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  watch,
} from 'vue'
import * as echarts from 'echarts'
import { apiClient } from '../../services/api/client'
import { useAppStore } from '../../stores/app'
import { useAnalyticsQuery } from '../../composables/useAnalyticsQuery'
import {
  getAnalyticsRangeLabel,
  isAnalyticsMetaValid,
} from '../../utils/analytics-meta'
import type {
  TrendItem,
  TrendsMeta,
  TrendsResponse,
} from '../../types/analytics'

const store = useAppStore()

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

const {
  data: trends,
  loading,
  errorMessage,
  retry: retryLoad,
} = useAnalyticsQuery<TrendItem[]>(
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
      { signal },
    )

    if (!isAnalyticsMetaValid(response.meta, siteId, range)) {
      throw new Error('访问趋势接口返回的站点、时间范围或时区信息不匹配。')
    }

    const result = response.data

    if (
      !result ||
      !Array.isArray(result.items) ||
      (result.granularity !== 'hour' &&
        result.granularity !== 'day')
    ) {
      throw new Error('趋势接口返回的数据格式异常。')
    }

    const validItems = result.items.every(item => {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof item.date !== 'string' ||
        !Number.isFinite(item.pv) ||
        item.pv < 0 ||
        !Number.isFinite(item.uv) ||
        item.uv < 0
      ) {
        return false
      }

      if (result.granularity === 'hour') {
        const hourly = item as Extract<
          TrendItem,
          { bucket_start_utc: string }
        >

        return (
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(hourly.date) &&
          typeof hourly.bucket_start_utc === 'string' &&
          Number.isFinite(Date.parse(hourly.bucket_start_utc)) &&
          Number.isFinite(hourly.offset_minutes)
        )
      }

      return /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    })

    if (!validItems) {
      throw new Error('趋势接口返回的趋势数据格式异常。')
    }

    if (
      (range === 'today' || range === 'yesterday') &&
      result.granularity !== 'hour'
    ) {
      throw new Error('今天和昨天的趋势数据应为小时粒度。')
    }

    if (
      (range === '7d' || range === '30d') &&
      result.granularity !== 'day'
    ) {
      throw new Error('近7天和近30天的趋势数据应为日粒度。')
    }

    return result.items
  },
  () => [],
)

const chartElement = ref<HTMLDivElement | null>(null)

let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

function formatDate(item: TrendItem): string {
  if ('bucket_start_utc' in item) {
    return `${item.date.slice(5, 10)} ${item.date.slice(11, 16)}`
  }

  return item.date.slice(5)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function disposeChart() {
  resizeObserver?.disconnect()
  resizeObserver = null

  chart?.dispose()
  chart = null
}

function renderChart() {
  const element = chartElement.value

  if (!element || trends.value.length === 0) {
    disposeChart()
    return
  }

  // 时间范围切换时，加载状态会销毁旧图表 DOM。
  // 如果新 DOM 与旧 ECharts 实例绑定的 DOM 不同，必须重新初始化。
  if (chart && chart.getDom() !== element) {
    disposeChart()
  }

  if (!chart) {
    chart = echarts.init(element)

    resizeObserver = new ResizeObserver(() => {
      chart?.resize()
    })

    resizeObserver.observe(element)
  }

  chart.setOption({
    animation: true,
    animationDuration: 500,
    color: ['#14b8a6', '#60a5fa'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#ffffff',
      borderColor: '#e9eef2',
      borderWidth: 1,
      textStyle: {
        color: '#334155',
        fontSize: 12,
      },
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: '#cbd5e1',
          type: 'dashed',
        },
      },
      formatter(params: unknown) {
        const items = params as Array<{
          axisValueLabel: string
          marker: string
          seriesName: string
          value: number
        }>

        if (!items.length) return ''

        const rows = items.map(item =>
          `${item.marker}${item.seriesName}：${formatNumber(item.value)}`,
        )

        return [
          `<div style="margin-bottom:8px;font-weight:600">${items[0].axisValueLabel}</div>`,
          ...rows,
        ].join('<br/>')
      },
    },
    legend: {
      top: 4,
      right: 4,
      itemWidth: 9,
      itemHeight: 9,
      textStyle: {
        color: '#64748b',
        fontSize: 12,
      },
      data: ['PV', 'UV'],
    },
    grid: {
      top: 48,
      left: 12,
      right: 20,
      bottom: 12,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trends.value.map(formatDate),
      axisLine: {
        lineStyle: { color: '#e9eef2' },
      },
      axisTick: { show: false },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        margin: 14,
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
      },
      splitLine: {
        lineStyle: {
          color: '#f1f5f9',
          type: 'dashed',
        },
      },
    },
    series: [
      {
        name: 'PV',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        showSymbol: false,
        lineStyle: { width: 3 },
        emphasis: {
          focus: 'series',
          scale: 1.4,
        },
        areaStyle: { opacity: 0.07 },
        data: trends.value.map(item => item.pv),
      },
      {
        name: 'UV',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        showSymbol: false,
        lineStyle: { width: 3 },
        emphasis: {
          focus: 'series',
          scale: 1.4,
        },
        data: trends.value.map(item => item.uv),
      },
    ],
  })
}

watch(
  trends,
  async () => {
    await nextTick()
    renderChart()
  },
  { flush: 'post' },
)

onUnmounted(disposeChart)
</script>


<template>
  <section class="overview-trend-section">
    <div class="overview-trend-heading">
      <div>
        <h2>访问趋势</h2>
        <p>{{ rangeLabel }} PV 与 UV 变化情况</p>
      </div>

      <span class="overview-trend-range">{{ rangeLabel }}</span>
    </div>

    <div
      v-if="loading"
      class="overview-trend-state"
      role="status"
      aria-live="polite"
    >
      <span class="loading-indicator"></span>
      正在加载访问趋势...
    </div>

    <div
      v-else-if="errorMessage"
      class="overview-trend-state overview-trend-error"
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
      v-else-if="!trends.length || !trends.some(item => item.pv > 0 || item.uv > 0)"
      class="overview-trend-state"
    >
      <p>{{ rangeLabel }}暂无访问数据</p>
      <span>当网站产生访问记录后，这里将展示 PV / UV 趋势。</span>
    </div>

    <div
      v-else
      class="overview-trend-chart-wrapper"
    >
      <div
        ref="chartElement"
        class="overview-trend-chart"
        role="img"
        :aria-label="`${rangeLabel}网站 PV 和 UV 访问趋势图`"
      ></div>
    </div>
  </section>
</template>

<style scoped>
.overview-trend-section {
  margin-top: 28px;
}

.overview-trend-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.overview-trend-heading h2 {
  margin: 0;
  color: #1f2937;
  font-size: 16px;
  font-weight: 600;
}

.overview-trend-heading p {
  margin: 6px 0 0;
  color: #89939e;
  font-size: 13px;
}

.overview-trend-range {
  padding: 5px 10px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

.overview-trend-chart-wrapper {
  padding: 16px 20px 12px;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  background: #ffffff;
}

.overview-trend-chart {
  width: 100%;
  height: 300px;
}

.overview-trend-state {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  background: #ffffff;
  color: #89939e;
  font-size: 13px;
  text-align: center;
}

.overview-trend-state p {
  margin: 0;
}

.overview-trend-state span {
  font-size: 12px;
  color: #94a3b8;
}

.overview-trend-error {
  color: #dc5252;
}

.overview-trend-error button {
  padding: 7px 16px;
  border: 1px solid #e9eef2;
  border-radius: 6px;
  background: #ffffff;
  color: #64748b;
  cursor: pointer;
}

.overview-trend-error button:hover {
  border-color: #14b8a6;
  color: #0f9488;
}

.loading-indicator {
  width: 20px;
  height: 20px;
  border: 2px solid #e2e8f0;
  border-top-color: #14b8a6;
  border-radius: 50%;
  animation: overview-spin 0.8s linear infinite;
}

@keyframes overview-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .overview-trend-chart-wrapper {
    padding: 12px 8px;
  }

  .overview-trend-chart {
    height: 240px;
  }
}
</style>


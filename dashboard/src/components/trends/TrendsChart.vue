
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { ECharts, EChartsOption } from 'echarts'
import type {
  TrendGranularity,
  TrendItem,
} from '../../types/analytics'

const props = defineProps<{
  items: TrendItem[]
  granularity: TrendGranularity
}>()

const chartElement = ref<HTMLDivElement | null>(null)

let chartInstance: ECharts | null = null
let resizeObserver: ResizeObserver | null = null

function formatDailyLabel(date: string): string {
  return date.slice(5)
}

function formatHourlyLabel(date: string): string {
  // API 返回的是站点时区的本地时间字符串
  // 不使用浏览器 Date 转换，避免时区二次偏移
  return `${date.slice(5, 10)} ${date.slice(11, 16)}`
}

function getAxisLabels(): string[] {
  return props.items.map(item => {
    if (props.granularity === 'hour' && 'bucket_start_utc' in item) {
      return formatHourlyLabel(item.date)
    }

    return formatDailyLabel(item.date)
  })
}

function createChartOption(): EChartsOption {
  const dates = getAxisLabels()
  const pvData = props.items.map(item => item.pv)
  const uvData = props.items.map(item => item.uv)

  const isHourly = props.granularity === 'hour'

  return {
    animation: true,

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
    },

    legend: {
      top: 4,
      right: 8,
      itemWidth: 9,
      itemHeight: 9,
      textStyle: {
        color: '#64748b',
        fontSize: 11,
      },
      data: ['PV', 'UV'],
    },

    grid: {
      top: 48,
      right: 24,
      bottom: 36,
      left: 48,
      containLabel: false,
    },

    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates,
      axisLine: {
        lineStyle: {
          color: '#e9eef2',
        },
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
        margin: 14,
        hideOverlap: true,
        interval: 'auto',
        rotate: isHourly ? 0 : 0,
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
      axisLine: {
        show: false,
      },
      axisTick: {
        show: false,
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
        symbol: isHourly ? 'none' : 'circle',
        symbolSize: 7,
        data: pvData,
        lineStyle: {
          width: 3,
        },
        itemStyle: {
          borderWidth: 2,
          borderColor: '#ffffff',
        },
        areaStyle: {
          opacity: 0.08,
        },
      },
      {
        name: 'UV',
        type: 'line',
        smooth: true,
        symbol: isHourly ? 'none' : 'circle',
        symbolSize: 7,
        data: uvData,
        lineStyle: {
          width: 2,
        },
        itemStyle: {
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      },
    ],
  }
}

function renderChart() {
  if (!chartElement.value || !chartInstance) return

  chartInstance.setOption(createChartOption(), true)
}

onMounted(() => {
  if (!chartElement.value) return

  chartInstance = echarts.init(chartElement.value)
  renderChart()

  resizeObserver = new ResizeObserver(() => {
    chartInstance?.resize()
  })

  resizeObserver.observe(chartElement.value)
})

watch(
  () => [props.items, props.granularity],
  () => {
    renderChart()
  },
  { deep: true, flush: 'post' },
)

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null

  chartInstance?.dispose()
  chartInstance = null
})
</script>

<template>
  <div
    ref="chartElement"
    class="trends-chart"
    role="img"
    aria-label="PV 和 UV 访问趋势折线图"
  ></div>
</template>

<style scoped>
.trends-chart {
  width: 100%;
  height: 360px;
  min-width: 0;
}

@media (max-width: 640px) {
  .trends-chart {
    height: 280px;
  }
}
</style>

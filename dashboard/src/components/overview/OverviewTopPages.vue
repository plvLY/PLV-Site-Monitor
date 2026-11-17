
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
  PagesMeta,
  PagesResponse,
} from '../../types/analytics'

const store = useAppStore()

const rangeLabel = computed(() =>
  getAnalyticsRangeLabel(store.dateRange),
)

const {
  data: items,
  loading,
  errorMessage,
  retry,
} = useAnalyticsQuery<PagesResponse['items']>(
  async ({ siteId, range, signal }) => {
    const response = await apiClient.get<
      PagesResponse,
      PagesMeta
    >(
      '/api/analytics/pages',
      {
        site_id: siteId,
        range,
        page: 1,
        page_size: 5,
        sort_by: 'pv',
        sort_order: 'desc',
      },
      { signal },
    )

    if (!isAnalyticsMetaValid(response.meta, siteId, range)) {
      throw new Error('热门页面接口返回的站点、时间范围或时区信息不匹配。')
    }

    if (
      !isPaginationMetaValid(response.meta, 1, 5) ||
      response.meta.sort_by !== 'pv' ||
      response.meta.sort_order !== 'desc'
    ) {
      throw new Error('热门页面接口返回的分页或排序信息不匹配。')
    }

    if (
      !Array.isArray(response.data.items) ||
      !response.data.items.every(item =>
        typeof item.page_path === 'string' &&
        typeof item.pv === 'number' &&
        Number.isFinite(item.pv) &&
        item.pv >= 0 &&
        typeof item.uv === 'number' &&
        Number.isFinite(item.uv) &&
        item.uv >= 0 &&
        typeof item.pv_share === 'number' &&
        Number.isFinite(item.pv_share),
      )
    ) {
      throw new Error('热门页面接口返回的数据格式异常。')
    }

    return response.data.items.slice(0, 5)
  },
  () => [],
)
</script>


<template>
  <section class="overview-top-pages">
    <div class="top-pages-heading">
      <div>
        <h2>热门页面</h2>
        <p>{{ rangeLabel }}访问量最高的页面</p>
      </div>

      <span class="top-pages-period">{{ rangeLabel }}</span>
    </div>

    <div v-if="loading" class="top-pages-state" role="status">
      正在加载热门页面...
    </div>

    <div
      v-else-if="errorMessage"
      class="top-pages-state top-pages-error"
      role="alert"
    >
      <p>{{ errorMessage }}</p>
      <button type="button" @click="retry">重新加载</button>
    </div>

    <div v-else-if="items.length === 0" class="top-pages-state">
      <p>暂无页面访问数据</p>
      <span>网站产生访问记录后，这里将展示热门页面。</span>
    </div>

    <div v-else class="top-pages-list">
      <div
        v-for="(item, index) in items"
        :key="item.page_path"
        class="top-page-item"
      >
        <div class="top-page-rank">{{ index + 1 }}</div>

        <div class="top-page-content">
          <div class="top-page-main">
            <span class="top-page-path" :title="item.page_path">
              {{ item.page_path }}
            </span>
            <span class="top-page-pv">
              {{ item.pv.toLocaleString() }} PV
            </span>
          </div>

          <div class="top-page-progress">
            <div
              class="top-page-progress-bar"
              :style="{ width: `${Math.min(item.pv_share, 100)}%` }"
            />
          </div>

          <div class="top-page-meta">
            <span>UV {{ item.uv.toLocaleString() }}</span>
            <span>{{ item.pv_share.toFixed(2) }}%</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.overview-top-pages {
  min-width: 0;
  padding: 20px;
  border: 1px solid #e9eef2;
  border-radius: 12px;
  background: #fff;
}

.top-pages-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.top-pages-heading h2 {
  margin: 0;
  color: #334155;
  font-size: 15px;
  font-weight: 650;
}

.top-pages-heading p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.top-pages-period {
  flex-shrink: 0;
  padding: 5px 9px;
  border-radius: 6px;
  background: #eaf8f6;
  color: #0f9488;
  font-size: 11px;
}

.top-pages-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.top-page-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.top-page-rank {
  display: flex;
  flex-shrink: 0;
  width: 25px;
  height: 25px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #eaf8f6;
  color: #0f9488;
  font-size: 11px;
  font-weight: 650;
}

.top-page-content {
  flex: 1;
  min-width: 0;
}

.top-page-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.top-page-path {
  min-width: 0;
  overflow: hidden;
  color: #334155;
  font-size: 13px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-page-pv {
  flex-shrink: 0;
  color: #475569;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.top-page-progress {
  height: 5px;
  overflow: hidden;
  border-radius: 99px;
  background: #edf2f5;
}

.top-page-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: #14b8a6;
  transition: width 0.2s ease;
}

.top-page-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  color: #94a3b8;
  font-size: 11px;
}

.top-pages-state {
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

.top-pages-state p {
  margin: 0;
}

.top-pages-state span {
  color: #94a3b8;
  font-size: 12px;
}

.top-pages-error {
  color: #dc5252;
}

.top-pages-error button {
  padding: 7px 14px;
  border: 1px solid #e9eef2;
  border-radius: 6px;
  background: #fff;
  color: #0f766e;
  font-size: 12px;
  cursor: pointer;
}
</style>


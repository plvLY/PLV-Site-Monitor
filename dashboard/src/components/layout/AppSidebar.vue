
<script setup lang="ts">
import { RouterLink } from 'vue-router'
import {
  Activity,
  ChartLine,
  FileText,
  LayoutDashboard,
  MapPin,
  Monitor,
  Settings,
  Share2,
  X,
  Globe,
} from 'lucide-vue-next'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const navigation = [
  { label: '总览', path: '/overview', icon: LayoutDashboard },
  { label: '访问趋势', path: '/trends', icon: ChartLine },
  { label: '页面分析', path: '/pages', icon: FileText },
  { label: '来源分析', path: '/sources', icon: Share2 },
  { label: '地域分析', path: '/locations', icon: MapPin },
  { label: '设备分析', path: '/devices', icon: Monitor },
]
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar-open': open }">
    <div class="sidebar-brand">
      <div class="brand-icon"><Activity :size="21" /></div>
      <div class="brand-text">
        <strong>PLV</strong>
        <span>Site Monitor</span>
      </div>
      <button class="mobile-close" aria-label="关闭导航" @click="emit('close')">
        <X :size="19" />
      </button>
    </div>

    <div class="sidebar-section-label">站点管理</div>

    <nav class="sidebar-nav">
      <RouterLink
        to="/sites"
        class="nav-item"
        active-class="nav-item-active"
        @click="emit('close')"
      >
        <Globe :size="18" :stroke-width="1.8" />
        <span>我的站点</span>
      </RouterLink>
    </nav>

    <div class="sidebar-section-label">数据分析</div>

    <nav class="sidebar-nav">
      <RouterLink
        v-for="item in navigation"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        active-class="nav-item-active"
        @click="emit('close')"
      >
        <component :is="item.icon" :size="18" :stroke-width="1.8" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar-bottom">
      <div class="sidebar-section-label">偏好设置</div>
            <RouterLink
        to="/settings"
        class="nav-item settings-item"
        active-class="nav-item-active"
        @click="emit('close')"
      >
        <Settings :size="18" :stroke-width="1.8" />
        <span>系统设置</span>
      </RouterLink>

      <div class="sidebar-footer">
        <span class="status-dot"></span>
        <span>所有系统运行正常</span>
      </div>
    </div>
  </aside>
</template>

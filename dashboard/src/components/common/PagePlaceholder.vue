
<script setup lang="ts">
import { Activity } from 'lucide-vue-next'

defineProps<{ title: string }>()
</script>

<template>
  <section class="placeholder-card">
    <div class="placeholder-icon">
      <Activity :size="23" />
    </div>
    <h2>{{ title }}数据分析</h2>
    <p>页面布局已就绪，统计数据将在后续开发阶段接入。</p>
    <span class="coming-soon">数据接入准备中</span>
  </section>
</template>

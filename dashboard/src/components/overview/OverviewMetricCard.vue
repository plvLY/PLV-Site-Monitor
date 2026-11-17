<script setup lang="ts">
defineProps<{
  title: string
  value: string
  description: string
  icon: string
  loading?: boolean
}>()
</script>

<template>
  <section class="overview-metric-card">
    <div class="metric-card-top">
      <span class="metric-title">{{ title }}</span>
      <span class="metric-icon">{{ icon }}</span>
    </div>

    <div v-if="loading" class="metric-loading">
      <span></span>
    </div>

    <template v-else>
      <div class="metric-value">{{ value }}</div>
      <div class="metric-description">{{ description }}</div>
    </template>
  </section>
</template>
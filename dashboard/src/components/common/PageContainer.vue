
<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <main class="page-container">
    <div class="page-heading">
      <div>
        <div class="page-eyebrow">网站访问分析</div>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
    </div>

    <slot />
  </main>
</template>

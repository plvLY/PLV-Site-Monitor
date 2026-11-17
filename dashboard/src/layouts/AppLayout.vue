
<script setup lang="ts">
import { ref } from 'vue'
import { RouterView } from 'vue-router'
import AppSidebar from '../components/layout/AppSidebar.vue'
import AppHeader from '../components/layout/AppHeader.vue'

const sidebarOpen = ref(false)
</script>

<template>
  <div class="app-shell">
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />

    <div
      v-if="sidebarOpen"
      class="sidebar-overlay"
      @click="sidebarOpen = false"
    ></div>

    <div class="main-panel">
      <AppHeader @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <RouterView />
    </div>
  </div>
</template>

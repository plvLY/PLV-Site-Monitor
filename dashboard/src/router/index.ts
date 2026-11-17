import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: {
        title: '管理员登录',
      },
    },
    {
      path: '/',
      component: AppLayout,
      redirect: '/overview',
      meta: {
        requiresAuth: true,
      },
      children: [
        {
          path: 'sites',
          name: 'sites',
          component: () => import('../views/SitesView.vue'),
          meta: {
            title: '我的站点',
            description: '管理你的网站及数据采集配置。',
          },
        },
        {
          path: 'overview',
          name: 'overview',
          component: () => import('../views/OverviewView.vue'),
          meta: {
            title: '总览',
            description: '了解网站整体访问表现。',
          },
        },
        {
          path: 'trends',
          name: 'trends',
          component: () => import('../views/TrendsView.vue'),
          meta: {
            title: '访问趋势',
            description: '跟踪网站访问量和用户变化趋势。',
          },
        },
        {
          path: 'pages',
          name: 'pages',
          component: () => import('../views/PagesView.vue'),
          meta: {
            title: '页面分析',
            description: '了解访客访问的页面和内容。',
          },
        },
        {
          path: 'sources',
          name: 'sources',
          component: () => import('../views/SourcesView.vue'),
          meta: {
            title: '来源分析',
            description: '分析访客来自哪些渠道。',
          },
        },
        {
          path: 'locations',
          name: 'locations',
          component: () => import('../views/LocationsView.vue'),
          meta: {
            title: '地域分析',
            description: '查看访客的地域分布。',
          },
        },
        {
          path: 'devices',
          name: 'devices',
          component: () => import('../views/DevicesView.vue'),
          meta: {
            title: '设备分析',
            description: '分析访客使用的设备和浏览器。',
          },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('../views/SettingsView.vue'),
          meta: {
            title: '系统设置',
            description: '管理数据保留策略与隐私配置。',
          },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/overview',
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (auth.status === 'unknown') {
    try {
      await auth.initialize()
    } catch {
      // 会话恢复失败时保持未授权状态，由下方守卫阻止访问管理页面。
    }
  }

  if (to.name === 'login') {
    if (auth.status === 'authenticated') {
      return '/overview'
    }

    return true
  }

  if (to.meta.requiresAuth !== true) {
    return true
  }

  if (auth.status === 'authenticated') {
    return true
  }

  return {
    name: 'login',
    query: {
      redirect: to.fullPath,
    },
  }
})

export default router

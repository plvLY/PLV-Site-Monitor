import {
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { ApiClientError } from '../services/api/client'
import { useAppStore } from '../stores/app'
import type { AnalyticsRange } from '../types/common'

export interface AnalyticsQueryContext {
  siteId: string
  range: AnalyticsRange
  signal: AbortSignal
}

type AnalyticsLoader<T> = (
  context: AnalyticsQueryContext,
) => Promise<T>

export function useAnalyticsQuery<T>(
  loader: AnalyticsLoader<T>,
  createEmpty: () => T,
) {
  const store = useAppStore()

  const data = shallowRef<T>(createEmpty())
  const loading = ref(false)
  const errorMessage = ref('')

  let controller: AbortController | null = null
  let requestId = 0

  async function execute() {
    controller?.abort()

    const currentController = new AbortController()
    controller = currentController

    const currentRequestId = ++requestId
    const siteId = store.siteId
    const range = store.dateRange

    data.value = createEmpty()
    errorMessage.value = ''

    if (!siteId) {
      errorMessage.value =
        '尚未配置站点 ID，请检查默认站点配置或重新选择站点。'
      loading.value = false
      return
    }

    loading.value = true

    try {
      const result = await loader({
        siteId,
        range,
        signal: currentController.signal,
      })

      if (
        currentController.signal.aborted ||
        currentRequestId !== requestId
      ) {
        return
      }

      data.value = result
    } catch (error) {
      if (
        currentController.signal.aborted ||
        currentRequestId !== requestId ||
        (error instanceof ApiClientError &&
          error.kind === 'ABORTED')
      ) {
        return
      }

      errorMessage.value =
        error instanceof Error
          ? error.message
          : '获取统计数据失败，请稍后重试。'
    } finally {
      if (currentRequestId === requestId) {
        loading.value = false
      }
    }
  }

  watch(
    () => [store.siteId, store.dateRange] as const,
    () => {
      void execute()
    },
    { immediate: true },
  )

  function retry() {
    void execute()
  }

  onUnmounted(() => {
    requestId++
    controller?.abort()
    controller = null
  })

  return {
    data,
    loading,
    errorMessage,
    retry,
  }
}

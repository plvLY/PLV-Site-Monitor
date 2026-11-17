import type { AnalyticsBaseMeta } from '../types/common'
import type { AnalyticsRange } from '../types/common'

export function isAnalyticsMetaValid(
  meta: unknown,
  siteId: string,
  range: AnalyticsRange,
): meta is AnalyticsBaseMeta {
  if (
    typeof meta !== 'object' ||
    meta === null ||
    Array.isArray(meta)
  ) {
    return false
  }

  const value = meta as Record<string, unknown>

  return (
    value.site_id === siteId &&
    value.range === range &&
    typeof value.start === 'string' &&
    value.start.length > 0 &&
    typeof value.end === 'string' &&
    value.end.length > 0 &&
    typeof value.timezone === 'string' &&
    value.timezone.trim().length > 0
  )
}

export function isPaginationMetaValid(
  meta: unknown,
  expectedPage: number,
  expectedPageSize: number,
): boolean {
  if (
    typeof meta !== 'object' ||
    meta === null ||
    Array.isArray(meta)
  ) {
    return false
  }

  const value = meta as Record<string, unknown>

  return (
    value.page === expectedPage &&
    value.page_size === expectedPageSize &&
    typeof value.total === 'number' &&
    Number.isInteger(value.total) &&
    value.total >= 0 &&
    typeof value.total_pages === 'number' &&
    Number.isInteger(value.total_pages) &&
    value.total_pages >= 0
  )
}

export function getAnalyticsRangeLabel(
  range: AnalyticsRange,
): string {
  const labels: Record<AnalyticsRange, string> = {
    today: '今天',
    yesterday: '昨天',
    '7d': '最近 7 天',
    '30d': '最近 30 天',
    custom: '自定义时间',
  }

  return labels[range]
}

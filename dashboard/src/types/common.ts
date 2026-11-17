
export type AnalyticsRange =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | 'custom'

export type SortOrder = 'asc' | 'desc'

export interface DateRangeParams {
  site_id: string
  range?: AnalyticsRange
  start?: string
  end?: string
}

export interface PaginationParams {
  page?: number
  page_size?: number
}

export interface PaginationMeta {
  page: number
  page_size: number
  total: number
  total_pages: number
}

export interface AnalyticsBaseMeta {
  site_id: string
  range: AnalyticsRange
  start: string
  end: string
  timezone: string
}

export interface SortParams<T extends string> {
  sort_by?: T
  sort_order?: SortOrder
}

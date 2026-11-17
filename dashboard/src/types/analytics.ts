
import type {
  AnalyticsBaseMeta,
  PaginationMeta,
  SortOrder,
} from './common'

// ==============================
// Overview
// ==============================

export interface OverviewStats {
  pv: number
  uv: number
  sessions: number
  bounce_sessions: number
  bounce_rate: number | null
}

export type OverviewResponse = OverviewStats

export type OverviewMeta = AnalyticsBaseMeta

// ==============================
// Trends
// ==============================

export type TrendGranularity = 'hour' | 'day'

export interface HourlyTrendItem {
  bucket_start_utc: string
  date: string
  offset_minutes: number
  pv: number
  uv: number
}

export interface DailyTrendItem {
  date: string
  pv: number
  uv: number
}

export type TrendItem = HourlyTrendItem | DailyTrendItem

export interface TrendsResponse {
  granularity: TrendGranularity
  items: TrendItem[]
}

export type TrendsMeta = AnalyticsBaseMeta

// ==============================
// Pages
// ==============================

export interface PageStatsItem {
  page_path: string
  pv: number
  uv: number
  pv_share: number
}

export type PageSortBy =
  | 'pv'
  | 'uv'
  | 'pv_share'
  | 'page_path'

export interface PagesResponse {
  items: PageStatsItem[]
}

export interface PagesMeta
  extends AnalyticsBaseMeta,
    PaginationMeta {
  sort_by: PageSortBy
  sort_order: SortOrder
}

// ==============================
// Sources
// ==============================

export type SourceDimension =
  | 'referrer_host'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign'

export interface SourceStatsItem {
  source: string | null
  pv: number
  uv: number
}

export interface SourceDimensionResponse {
  items: SourceStatsItem[]
}

export interface SourceDimensionMeta {
  page: number
  page_size: number
  total: number
  total_pages: number
}

export interface SourcesResponse {
  referrer_host: SourceDimensionResponse
  utm_source: SourceDimensionResponse
  utm_medium: SourceDimensionResponse
  utm_campaign: SourceDimensionResponse
}

export interface SourcesMeta extends AnalyticsBaseMeta {
  referrer_host: SourceDimensionMeta
  utm_source: SourceDimensionMeta
  utm_medium: SourceDimensionMeta
  utm_campaign: SourceDimensionMeta
}

// ==============================
// Locations
// ==============================

export interface LocationStatsItem {
  country_code: string | null
  region: string | null
  city: string | null
  pv: number
  uv: number
}

export type LocationSortBy =
  | 'pv'
  | 'uv'
  | 'country_code'
  | 'region'
  | 'city'

export interface LocationsResponse {
  items: LocationStatsItem[]
}

export interface LocationsMeta
  extends AnalyticsBaseMeta,
    PaginationMeta {
  sort_by: LocationSortBy
  sort_order: SortOrder
}

// ==============================
// Devices
// ==============================

export type DeviceDimension = 'browser' | 'os'

export interface DeviceStatsItem {
  device: string | null
  pv: number
  uv: number
}

export interface DeviceDimensionResponse {
  items: DeviceStatsItem[]
}

export interface DevicesResponse {
  browser: DeviceDimensionResponse
  os: DeviceDimensionResponse
}

export interface DevicesMeta extends AnalyticsBaseMeta {
  browser: SourceDimensionMeta
  os: SourceDimensionMeta
}

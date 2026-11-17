
import type { PaginationMeta } from './common'

export type SiteStatus = 'active' | 'disabled' | 'archived'

export interface SiteDomain {
  domain: string
  is_primary: boolean
}

export interface SiteListItem {
  id: string
  name: string
  status: SiteStatus
  timezone: string
  created_at: string
  updated_at: string
  domains: SiteDomain[]
}

export interface SitesResponse {
  items: SiteListItem[]
}

export type SitesMeta = PaginationMeta

export interface SiteDomainInput {
  domain: string
  is_primary: boolean
}

export interface CreateSiteInput {
  name: string
  timezone: string
  domains: SiteDomainInput[]
}

export interface UpdateSiteInput {
  id: string
  name: string
  timezone: string
  domains: SiteDomainInput[]
}

export interface UpdateSiteStatusInput {
  id: string
  status: SiteStatus
}

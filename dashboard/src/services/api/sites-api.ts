import { apiClient } from './client'
import type { RequestOptions } from './client'
import type {
  SiteListItem,
  SiteStatus,
  SitesMeta,
  SitesResponse,
} from '../../types/sites'

export interface SiteDomainInput {
  domain: string
  is_primary: boolean
}

export interface CreateSiteRequest {
  name: string
  timezone: string
  domains?: SiteDomainInput[]
}

export interface UpdateSiteRequest {
  site_id: string
  name?: string
  timezone?: string
  domains?: SiteDomainInput[]
}

export interface UpdateSiteStatusRequest {
  site_id: string
  status: SiteStatus
}

export interface SiteMutationResponse {
  item: SiteListItem
}

export interface GetSitesRequest {
  page: number
  page_size: number
}

type SiteMutationMeta = Record<string, never>

export function getSites(
  input: GetSitesRequest,
  options: RequestOptions = {},
) {
  return apiClient.get<SitesResponse, SitesMeta>(
    '/api/sites',
    {
      page: input.page,
      page_size: input.page_size,
    },
    options,
  )
}

export function createSite(
  input: CreateSiteRequest,
) {
  return apiClient.post<
    SiteMutationResponse,
    SiteMutationMeta,
    CreateSiteRequest
  >('/api/sites', input)
}

export function updateSite(
  input: UpdateSiteRequest,
) {
  return apiClient.patch<
    SiteMutationResponse,
    SiteMutationMeta,
    UpdateSiteRequest
  >('/api/sites', input)
}

export function updateSiteStatus(
  input: UpdateSiteStatusRequest,
) {
  return apiClient.patch<
    SiteMutationResponse,
    SiteMutationMeta,
    UpdateSiteStatusRequest
  >('/api/sites', input)
}


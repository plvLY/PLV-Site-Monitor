
import type {
  ApiErrorCode,
  ApiSuccessResponse,
} from '../../types/api'
import { ApiError } from '../../types/api'

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined

export type QueryParams = Record<string, QueryValue>

export interface RequestOptions {
  timeout?: number
  signal?: AbortSignal
}

export interface ApiClientConfig {
  baseUrl?: string
  timeout?: number
}

export type ApiClientErrorKind =
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'ABORTED'

export class ApiClientError extends Error {
  public readonly kind: ApiClientErrorKind

  constructor(
    kind: ApiClientErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
    this.kind = kind
  }
}

const VALID_ERROR_CODES: readonly ApiErrorCode[] = [
  'INVALID_QUERY',
  'INVALID_SETTINGS',
  'METHOD_NOT_ALLOWED',
  'RETENTION_LIMIT_EXCEEDED',
  'INVALID_DATE_RANGE',
  'INVALID_TIMEZONE',
  'UNAUTHORIZED',
  'SITE_ACCESS_DENIED',
  'SITE_NOT_FOUND',
  'INTERNAL_ERROR',
];

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function normalizeErrorCode(value: unknown): ApiErrorCode {
  if (
    typeof value === 'string' &&
    VALID_ERROR_CODES.includes(value as ApiErrorCode)
  ) {
    return value as ApiErrorCode
  }

  return 'INTERNAL_ERROR'
}

function buildUrl(
  baseUrl: string,
  path: string,
  params?: QueryParams,
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/')
    ? path
    : `/${path}`

  const url = `${normalizedBase}${normalizedPath}`

  if (!params) {
    return url
  }

  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value))
    }
  }

  const queryString = searchParams.toString()

  if (!queryString) {
    return url
  }

  return `${url}${url.includes('?') ? '&' : '?'}${queryString}`
}

function parseErrorResponse(
  body: unknown,
  status: number,
): ApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const code = normalizeErrorCode(body.error.code)
    const message =
      typeof body.error.message === 'string'
        ? body.error.message
        : 'Request failed.'

    return new ApiError(code, message, status)
  }

  return new ApiError(
    'INTERNAL_ERROR',
    `Request failed with HTTP ${status}.`,
    status,
  )
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly timeout: number

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? ''
    this.timeout = config.timeout ?? 15000
  }

  async get<T, M>(
    path: string,
    params?: QueryParams,
    options: RequestOptions = {},
  ): Promise<ApiSuccessResponse<T, M>> {
    return this.request<T, M>(
      'GET',
      path,
      undefined,
      params,
      options,
    )
  }

  async post<T, M, B = unknown>(
    path: string,
    body: B,
    options: RequestOptions = {},
  ): Promise<ApiSuccessResponse<T, M>> {
    return this.request<T, M>(
      'POST',
      path,
      body,
      undefined,
      options,
    )
  }

  async patch<T, M, B = unknown>(
    path: string,
    body: B,
    options: RequestOptions = {},
  ): Promise<ApiSuccessResponse<T, M>> {
    return this.request<T, M>(
      'PATCH',
      path,
      body,
      undefined,
      options,
    )
  }

  private async request<T, M>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    params?: QueryParams,
    options: RequestOptions = {},
  ): Promise<ApiSuccessResponse<T, M>> {
    const url = buildUrl(this.baseUrl, path, params)
    const timeout = options.timeout ?? this.timeout

    const controller = new AbortController()
    let timedOut = false

    const handleExternalAbort = () => {
      controller.abort(options.signal?.reason)
    }

    if (options.signal?.aborted) {
      throw new ApiClientError(
        'ABORTED',
        'Request was cancelled.',
      )
    }

    options.signal?.addEventListener(
      'abort',
      handleExternalAbort,
      { once: true },
    )

    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeout)

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      }

      const requestInit: RequestInit = {
        method,
        headers,
        credentials: 'same-origin',
        signal: controller.signal,
      }

      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json'
        requestInit.body = JSON.stringify(body)
      }

      const response = await fetch(url, requestInit)
      const responseText = await response.text()

      let responseBody: unknown = null

      if (responseText) {
        try {
          responseBody = JSON.parse(responseText)
        } catch {
          throw new ApiClientError(
            'INVALID_RESPONSE',
            'Server returned invalid JSON.',
          )
        }
      }

      if (!response.ok) {
        throw parseErrorResponse(
          responseBody,
          response.status,
        )
      }

      if (
        !isRecord(responseBody) ||
        responseBody.success !== true ||
        !('data' in responseBody) ||
        !('meta' in responseBody)
      ) {
        if (
          isRecord(responseBody) &&
          responseBody.success === false
        ) {
          throw parseErrorResponse(
            responseBody,
            response.status,
          )
        }

        throw new ApiClientError(
          'INVALID_RESPONSE',
          'Server returned an invalid API response.',
        )
      }

      return responseBody as unknown as ApiSuccessResponse<T, M>
    } catch (error) {
      if (
        error instanceof ApiError ||
        error instanceof ApiClientError
      ) {
        throw error
      }

      if (timedOut) {
        throw new ApiClientError(
          'TIMEOUT',
          `Request timed out after ${timeout}ms.`,
        )
      }

      if (
        options.signal?.aborted ||
        (error instanceof DOMException &&
          error.name === 'AbortError')
      ) {
        throw new ApiClientError(
          'ABORTED',
          'Request was cancelled.',
        )
      }

      throw new ApiClientError(
        'NETWORK_ERROR',
        error instanceof Error
          ? error.message
          : 'Network request failed.',
      )
    } finally {
      clearTimeout(timeoutId)

      options.signal?.removeEventListener(
        'abort',
        handleExternalAbort,
      )
    }
  }
}

export const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

const configuredTimeout = Number(
  import.meta.env.VITE_API_TIMEOUT,
)

const apiTimeout =
  Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 15000

export const apiClient = new ApiClient({
  baseUrl: apiBaseUrl,
  timeout: apiTimeout,
})



export type ApiErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_TIMEZONE'
  | 'UNAUTHORIZED'
  | 'SITE_ACCESS_DENIED'
  | 'SITE_NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'INVALID_SETTINGS'
  | 'METHOD_NOT_ALLOWED'
  | 'RETENTION_LIMIT_EXCEEDED'

export interface ApiSuccessResponse<T, M> {
  success: true
  data: T
  meta: M
}

export interface ApiErrorResponse {
  success: false
  error: {
    code: ApiErrorCode
    message: string
  }
}

export type ApiResponse<T, M> =
  | ApiSuccessResponse<T, M>
  | ApiErrorResponse


export class ApiError extends Error {
  public readonly code: ApiErrorCode
  public readonly status: number

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
  ) {
    super(message)

    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}


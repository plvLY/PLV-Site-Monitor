export type AnalyticsErrorCode =
  | "INVALID_QUERY"
  | "INVALID_SETTINGS"
  | "METHOD_NOT_ALLOWED"
  | "RETENTION_LIMIT_EXCEEDED"
  | "INVALID_DATE_RANGE"
  | "INVALID_TIMEZONE"
  | "UNAUTHORIZED"
  | "SITE_ACCESS_DENIED"
  | "SITE_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "CSRF_REJECTED";

/**
 * 统一错误码与 HTTP 状态码映射。
 *
 * 未知异常一律映射为 INTERNAL_ERROR（500），且不对外暴露堆栈或连接信息。
 */
export const ERROR_STATUS: Record<AnalyticsErrorCode, number> = {
  INVALID_QUERY: 400,
  INVALID_SETTINGS: 400,
  METHOD_NOT_ALLOWED: 405,
  RETENTION_LIMIT_EXCEEDED: 400,
  INVALID_DATE_RANGE: 400,
  INVALID_TIMEZONE: 400,
  UNAUTHORIZED: 401,
  SITE_ACCESS_DENIED: 403,
  SITE_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  CSRF_REJECTED: 403,
};

/**
 * 统计分析 API 统一错误类型。
 */
export class AnalyticsError extends Error {
  public readonly code: AnalyticsErrorCode;
  public readonly status: number;
  public readonly isOperational: boolean;

  constructor(
    code: AnalyticsErrorCode,
    message: string,
    isOperational = true,
  ) {
    super(message);
    this.name = "AnalyticsError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.isOperational = isOperational;

    // 不在错误对象上保留内部堆栈，避免泄露到客户端。
    Error.captureStackTrace?.(this, AnalyticsError);
  }
}

/**
 * 返回错误码对应的 HTTP 状态码。
 */
export function errorStatus(code: AnalyticsErrorCode): number {
  return ERROR_STATUS[code];
}

/**
 * 将任意未知异常统一转换为 AnalyticsError。
 *
 * 已是 AnalyticsError 的原样返回，其余一律转为 INTERNAL_ERROR，
 * 消息不包含内部实现细节。
 */
export function toAnalyticsError(error: unknown): AnalyticsError {
  if (error instanceof AnalyticsError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error);

  return new AnalyticsError(
    "INTERNAL_ERROR",
    "An internal server error occurred.",
    true,
  );
}

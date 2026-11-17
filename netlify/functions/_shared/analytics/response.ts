import { AnalyticsError, errorStatus } from "./errors";

export interface SuccessMeta {
  [key: string]: unknown;
}

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta: SuccessMeta;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

/**
 * 构造统一成功响应 JSON。
 *
 * 正确设置 JSON Content-Type，支持指定 HTTP 状态码。
 */
export function jsonSuccess<T>(
  data: T,
  meta: SuccessMeta,
  status = 200,
): string {
  return JSON.stringify({
    success: true,
    data,
    meta,
  });
}

/**
 * 构造统一错误响应 JSON。
 *
 * 对外不暴露数据库连接信息和内部异常堆栈。
 */
export function jsonError(error: AnalyticsError): string {
  return JSON.stringify({
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
  });
}

/**
 * 构造统一成功的 Response。
 */
export function successResponse<T>(
  data: T,
  meta: SuccessMeta,
  status = 200,
): Response {
  return new Response(jsonSuccess(data, meta, status), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * 构造统一错误的 Response。
 *
 * 状态码按错误码映射，消息不含内部堆栈。
 */
export function errorResponse(
  error: AnalyticsError,
): Response {
  return new Response(jsonError(error), {
    status: errorStatus(error.code),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * Return a 405 response for unsupported HTTP methods.
 */
export function methodNotAllowedResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "INVALID_QUERY",
        message: "Only GET requests are supported.",
      },
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

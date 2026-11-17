
import {
  Authorization,
  type SiteAuthorization,
} from "../analytics/authorization";
import { AnalyticsError } from "../analytics/errors";
import { parseOrigin } from "../origin";
import {
  getAdminAuthContext,
  type AdminAuthContext,
} from "./auth-context";
import type { AdminSessionIdentity } from "./session";

/**
 * 可注入认证上下文解析器，供单元测试使用。
 *
 * 生产环境始终使用 getAdminAuthContext。
 */
export type AdminAuthContextResolver = (
  request: Request,
) => Promise<AdminAuthContext>;

export interface AdminGuardOptions {
  resolveAuthContext?: AdminAuthContextResolver;
}

const UNAUTHORIZED_ERROR = () =>
  new AnalyticsError(
    "UNAUTHORIZED",
    "Authentication required.",
  );

const CSRF_ERROR = () =>
  new AnalyticsError(
    "CSRF_REJECTED",
    "Request origin validation failed.",
  );

/**
 * 验证当前 HTTP Request 对应的管理员身份。
 *
 * 每次调用都解析当前请求的 Cookie，不缓存管理员身份。
 * Session 无效、过期、撤销或数据库异常均拒绝访问。
 */
export async function requireAdmin(
  request: Request,
  options: AdminGuardOptions = {},
): Promise<AdminSessionIdentity> {
  const resolveAuthContext =
    options.resolveAuthContext ?? getAdminAuthContext;

  let authContext: AdminAuthContext;

  try {
    authContext = await resolveAuthContext(request);
  } catch {
    throw UNAUTHORIZED_ERROR();
  }

  if (
    !authContext ||
    authContext.authenticated !== true ||
    !authContext.admin
  ) {
    throw UNAUTHORIZED_ERROR();
  }

  return authContext.admin;
}

/**
 * 创建当前 HTTP Request 专属的 Analytics Authorization。
 *
 * 当前系统只有一个超级管理员，因此认证成功后允许访问所有站点。
 * 站点是否存在、是否有效仍由原有 Analytics 业务查询负责验证。
 *
 * 不创建全局 Authorization 实例，不在请求之间共享身份。
 */
export async function createAdminAuthorization(
  request: Request,
  options: AdminGuardOptions = {},
): Promise<Authorization> {
  const admin = await requireAdmin(request, options);

  const siteAuthorization: SiteAuthorization = {
    checkSiteAccess(): boolean {
      return true;
    },
  };

  return new Authorization({
    authContext: {
      userId: String(admin.adminUserId),
      authenticated: true,
    },
    siteAuthorization,
  });
}

/**
 * 校验管理写请求的 Origin。
 *
 * 要求：
 * 1. Origin 必须存在。
 * 2. 拒绝 null Origin。
 * 3. Origin 必须符合 parseOrigin 的规则。
 * 4. Origin 必须与当前 Request URL 的 Origin 完全一致。
 *
 * SameSite Cookie 不能替代此项校验。
 */
export function assertSameOrigin(request: Request): void {
  const parsedOrigin = parseOrigin(
    request.headers.get("origin"),
  );

  if (!parsedOrigin) {
    throw CSRF_ERROR();
  }

  try {
    const requestUrl = new URL(request.url);

    if (
      requestUrl.protocol !== "http:" &&
      requestUrl.protocol !== "https:"
    ) {
      throw CSRF_ERROR();
    }

    if (
      requestUrl.username ||
      requestUrl.password ||
      parsedOrigin.origin !== requestUrl.origin
    ) {
      throw CSRF_ERROR();
    }
  } catch (error) {
    if (
      error instanceof AnalyticsError &&
      error.code === "CSRF_REJECTED"
    ) {
      throw error;
    }

    throw CSRF_ERROR();
  }
}

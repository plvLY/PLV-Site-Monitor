import { AnalyticsError } from "./errors";

export interface AuthContext {
  /** 已认证的用户身份；尚未接入认证提供者时为 null。 */
  readonly userId: string | null;
  readonly authenticated: boolean;
}

export interface SiteAuthorization {
  /**
   * 检查当前认证上下文是否允许访问指定站点的统计数据。
   *
   * 未接入认证提供者时，默认拒绝所有受保护的 Analytics 请求。
   */
  checkSiteAccess(siteId: string, authContext: AuthContext): boolean | Promise<boolean>;
}

/**
 * 默认认证上下文：未认证，无用户身份。
 */
export const UNAUTHENTICATED_CONTEXT: AuthContext = {
  userId: null,
  authenticated: false,
};

/**
 * 默认站点授权：在未接入认证提供者前，拒绝所有站点访问。
 *
 * 不把 site_id 当作认证凭据，不把 Origin 校验当作用户认证。
 */
export const DEFAULT_SITE_AUTHORIZATION: SiteAuthorization = {
  checkSiteAccess(): boolean {
    return false;
  },
};

/**
 * 统一认证与站点授权边界。
 *
 * 支持通过构造函数注入 Mock 身份和授权实现，方便测试；
 * 后续接入统一用户认证模块时，只需替换 provider，无需修改统计业务代码。
 */
export class Authorization {
  private readonly authContext: AuthContext;
  private readonly siteAuthorization: SiteAuthorization;

  constructor(
    options: {
      authContext?: AuthContext;
      siteAuthorization?: SiteAuthorization;
    } = {},
  ) {
    this.authContext = options.authContext ?? UNAUTHENTICATED_CONTEXT;
    this.siteAuthorization =
      options.siteAuthorization ?? DEFAULT_SITE_AUTHORIZATION;
  }

  /** 当前认证上下文。 */
  getContext(): AuthContext {
    return this.authContext;
  }

  /** 是否已认证。 */
  isAuthenticated(): boolean {
    return this.authContext.authenticated === true;
  }

  /**
   * 检查当前上下文是否允许访问指定站点。
   *
   * 未认证或无站点权限时返回 false。
   */
  async canAccessSite(siteId: string): Promise<boolean> {
    if (!this.isAuthenticated()) {
      return false;
    }

    return Boolean(
      await this.siteAuthorization.checkSiteAccess(siteId, this.authContext),
    );
  }

  /**
   * 断言当前上下文允许访问指定站点，否则抛出错误。
   *
   * 未认证时抛出 UNAUTHORIZED；无权访问时抛出 SITE_ACCESS_DENIED。
   */
  async requireSiteAccess(siteId: string): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new AnalyticsError("UNAUTHORIZED", "Authentication required.");
    }

    const allowed = await this.canAccessSite(siteId);

    if (!allowed) {
      throw new AnalyticsError(
        "SITE_ACCESS_DENIED",
        "Access to the specified site is denied.",
      );
    }
  }
}

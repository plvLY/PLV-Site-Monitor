import {
  Authorization,
  type AuthContext,
  type SiteAuthorization,
} from "./authorization.js";

/**
 * 仅允许 Netlify Dev 本地环境启用测试授权。
 * 生产、预览和分支部署始终使用默认拒绝策略。
 */
export function createAnalyticsAuthorization(): Authorization {
  const isLocalTestEnabled =
    process.env.CONTEXT === "dev" &&
    process.env.PLV_ANALYTICS_LOCAL_AUTH === "true";

  if (!isLocalTestEnabled) {
    return new Authorization();
  }

  const allowedSiteIds = new Set(
    (process.env.PLV_ANALYTICS_LOCAL_SITE_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );

  const authContext: AuthContext = {
    userId: "local-analytics-test",
    authenticated: true,
  };

  const siteAuthorization: SiteAuthorization = {
    checkSiteAccess(siteId: string): boolean {
      return allowedSiteIds.has(siteId);
    },
  };

  return new Authorization({
    authContext,
    siteAuthorization,
  });
}

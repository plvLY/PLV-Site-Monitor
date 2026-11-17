import { pool } from "../../db/client";
import { createAdminAuthorization } from "./_shared/admin-auth/guard";
import { parseDateRange } from "./_shared/analytics/date-range";
import { AnalyticsError } from "./_shared/analytics/errors";
import {
  errorResponse,
  successResponse,
  methodNotAllowedResponse,
} from "./_shared/analytics/response";
import { getOverviewStats } from "./_shared/analytics/overview-service";

export const config = {
  path: "/api/analytics/overview",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_QUERY_KEYS = new Set([
  "site_id",
  "range",
  "start",
  "end",
]);

type AuthorizationGuard = {
  requireSiteAccess(siteId: string): Promise<void> | void;
};

type Database = typeof pool;

type AuthorizationResolver = (
  request: Request,
) => Promise<AuthorizationGuard>;

interface HandlerDependencies {
  database: Database;
  resolveAuthorization: AuthorizationResolver;
}

export function createOverviewHandler(
  dependencies: HandlerDependencies,
) {
  const { database, resolveAuthorization } = dependencies;

  return async function handleOverview(request: Request): Promise<Response> {
    try {
      if (request.method !== "GET") {
        return methodNotAllowedResponse();
      }

      // 每个请求独立验证管理员 Session。
      const authorization = await resolveAuthorization(request);

      const url = new URL(request.url);
      const params = url.searchParams;

      // 只允许接口设计中定义的查询参数。
      for (const key of params.keys()) {
        if (!ALLOWED_QUERY_KEYS.has(key)) {
          throw new AnalyticsError(
            "INVALID_QUERY",
            `Unknown query parameter: ${key}`,
          );
        }
      }

      // 拒绝重复参数，避免 site_id/range 等参数出现歧义。
      for (const key of ALLOWED_QUERY_KEYS) {
        if (params.getAll(key).length > 1) {
          throw new AnalyticsError(
            "INVALID_QUERY",
            `Duplicate query parameter: ${key}`,
          );
        }
      }

      const siteId = params.get("site_id");

      if (!siteId || !UUID_REGEX.test(siteId)) {
        throw new AnalyticsError(
          "INVALID_QUERY",
          "A valid site_id is required.",
        );
      }

      const range = params.get("range") ?? undefined;
      const start = params.get("start") ?? undefined;
      const end = params.get("end") ?? undefined;

      // 自定义时间范围必须明确使用 range=custom。
      if (
        (start !== undefined || end !== undefined) &&
        range !== "custom"
      ) {
        throw new AnalyticsError(
          "INVALID_QUERY",
          "start and end can only be used with range=custom.",
        );
      }

      if (range === "custom" && (!start || !end)) {
        throw new AnalyticsError(
          "INVALID_DATE_RANGE",
          "Both start and end are required for custom date ranges.",
        );
      }

      // 先授权，再查询站点，避免未授权请求探测站点是否存在。
      await authorization.requireSiteAccess(siteId);

      const siteResult = await database.query<{
        id: string;
        timezone: string;
      }>(
        `
        SELECT id, timezone
        FROM sites
        WHERE id = $1::uuid
        LIMIT 1
        `,
        [siteId],
      );

      const site = siteResult.rows[0];

      if (!site) {
        throw new AnalyticsError(
          "SITE_NOT_FOUND",
          "The requested site was not found.",
        );
      }

      const dateRange = parseDateRange({
        range,
        start,
        end,
        timeZone: site.timezone,
      });

      const data = await getOverviewStats(
        database,
        siteId,
        dateRange.start,
        dateRange.end,
      );

      return successResponse(data, {
        site_id: siteId,
        range: dateRange.range,
        start: dateRange.startIso,
        end: dateRange.endIso,
        timezone: dateRange.timeZone,
      });
    } catch (error) {
      if (error instanceof AnalyticsError) {
        return errorResponse(error);
      }

      console.error("[analytics-overview] Unexpected error:", error);

      return errorResponse(
        new AnalyticsError(
          "INTERNAL_ERROR",
          "An internal error occurred.",
        ),
      );
    }
  };
}

// 默认授权策略为拒绝访问。
// 接入统一用户认证后
export default createOverviewHandler({
  database: pool,
  resolveAuthorization: createAdminAuthorization,
});

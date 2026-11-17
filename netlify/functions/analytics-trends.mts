
import type { Pool } from "pg";

import { pool } from "../../db/client";
import { parseDateRange } from "./_shared/analytics/date-range.js";
import { createAdminAuthorization } from "./_shared/admin-auth/guard.js";
import { AnalyticsError } from "./_shared/analytics/errors.js";
import {
  errorResponse,
  successResponse,
  methodNotAllowedResponse,
} from "./_shared/analytics/response.js";
import {
  getTrendStats,
  type TrendGranularity,
} from "./_shared/analytics/trends-service.js";

export const config = {
  path: "/api/analytics/trends",
};

interface SiteAuthorization {
  requireSiteAccess(siteId: string): Promise<void> | void;
}

type AuthorizationResolver = (
  request: Request,
) => Promise<SiteAuthorization>;

interface HandlerDependencies {
  database: Pick<Pool, "query">;
  resolveAuthorization: AuthorizationResolver;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_QUERY_PARAMS = new Set([
  "site_id",
  "range",
  "start",
  "end",
]);

function getSingleQueryParam(
  params: URLSearchParams,
  name: string,
): string | undefined {
  const values = params.getAll(name);

  if (values.length > 1) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      `Query parameter '${name}' must not be repeated.`,
    );
  }

  return values[0];
}

function resolveGranularity(
  range: string,
  start: Date,
  end: Date,
): TrendGranularity {
  if (range === "today" || range === "yesterday") {
    return "hour";
  }

  if (range === "7d" || range === "30d") {
    return "day";
  }

  if (range === "custom") {
    const duration = end.getTime() - start.getTime();
    const fortyEightHours = 48 * 60 * 60 * 1000;

    return duration <= fortyEightHours ? "hour" : "day";
  }

  throw new AnalyticsError(
    "INVALID_QUERY",
    "Unsupported analytics range.",
  );
}

export function createTrendsHandler(
  dependencies: HandlerDependencies,
) {
  const { database, resolveAuthorization } = dependencies;

  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "GET") {
        return methodNotAllowedResponse();
      }

      const authorization = await resolveAuthorization(request);

      const url = new URL(request.url);
      const params = url.searchParams;

      for (const key of params.keys()) {
        if (!ALLOWED_QUERY_PARAMS.has(key)) {
          throw new AnalyticsError(
            "INVALID_QUERY",
            `Unknown query parameter '${key}'.`,
          );
        }
      }

      const siteId = getSingleQueryParam(params, "site_id");
      const range = getSingleQueryParam(params, "range") ?? "7d";
      const start = getSingleQueryParam(params, "start");
      const end = getSingleQueryParam(params, "end");

      if (!siteId || !UUID_PATTERN.test(siteId)) {
        throw new AnalyticsError(
          "INVALID_QUERY",
          "A valid site_id is required.",
        );
      }

      if (range === "custom") {
        if (!start || !end) {
          throw new AnalyticsError(
            "INVALID_DATE_RANGE",
            "Custom range requires both start and end.",
          );
        }
      } else if (start !== undefined || end !== undefined) {
        throw new AnalyticsError(
          "INVALID_QUERY",
          "start and end can only be used with range=custom.",
        );
      }

      // Authentication and site-level authorization must happen
      // before reading site data or analytics data.
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

      const granularity = resolveGranularity(
        range,
        dateRange.start,
        dateRange.end,
      );

      const items = await getTrendStats(
        database,
        siteId,
        dateRange.start,
        dateRange.end,
        dateRange.timeZone,
        granularity,
      );

      return successResponse(
        {
          granularity,
          items,
        },
        {
          site_id: siteId,
          range,
          start: dateRange.startIso,
          end: dateRange.endIso,
          timezone: dateRange.timeZone,
        },
      );
    } catch (error) {
      if (error instanceof AnalyticsError) {
        return errorResponse(error);
      }

      console.error("[analytics-trends] Unexpected error:", error);

      return errorResponse(
        new AnalyticsError(
          "INTERNAL_ERROR",
          "An internal error occurred.",
        ),
      );
    }
  };
}

export default createTrendsHandler({
  database: pool,
  resolveAuthorization: createAdminAuthorization,
});


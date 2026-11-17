
import type { Pool } from "pg";

import { pool } from "../../db/client";
import { createAdminAuthorization } from "./_shared/admin-auth/guard";
import { parseDateRange } from "./_shared/analytics/date-range.js";
import { AnalyticsError } from "./_shared/analytics/errors.js";
import {
  errorResponse,
  successResponse,
  methodNotAllowedResponse,
} from "./_shared/analytics/response.js";
import {
  getLocationStats,
  type LocationSortBy,
  type SortOrder,
} from "./_shared/analytics/locations-service.js";

export const config = {
  path: "/api/analytics/locations",
};

interface SiteAuthorization {
  requireSiteAccess(siteId: string): Promise<void> | void;
}

interface HandlerDependencies {
  database: Pick<Pool, "query">;
  resolveAuthorization(
    request: Request,
  ): Promise<SiteAuthorization>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_QUERY_PARAMS = new Set([
  "site_id",
  "range",
  "start",
  "end",
  "page",
  "page_size",
  "sort_by",
  "sort_order",
]);

const ALLOWED_SORT_FIELDS = new Set<LocationSortBy>([
  "pv",
  "uv",
  "country_code",
  "region",
  "city",
]);

const ALLOWED_SORT_ORDERS = new Set<SortOrder>(["asc", "desc"]);

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

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  name: string,
  maximum?: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      `Query parameter '${name}' must be a positive integer.`,
    );
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      maximum === undefined
        ? `Query parameter '${name}' must be a positive integer.`
        : `Query parameter '${name}' must be between 1 and ${maximum}.`,
    );
  }

  return parsed;
}

function parseSortBy(value: string | undefined): LocationSortBy {
  const sortBy = value ?? "pv";

  if (!ALLOWED_SORT_FIELDS.has(sortBy as LocationSortBy)) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "sort_by must be one of: pv, uv, country_code, region, city.",
    );
  }

  return sortBy as LocationSortBy;
}

function parseSortOrder(value: string | undefined): SortOrder {
  const sortOrder = value ?? "desc";

  if (!ALLOWED_SORT_ORDERS.has(sortOrder as SortOrder)) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "sort_order must be either asc or desc.",
    );
  }

  return sortOrder as SortOrder;
}

export function createLocationsHandler(
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

      const page = parsePositiveInteger(
        getSingleQueryParam(params, "page"),
        1,
        "page",
      );

      const pageSize = parsePositiveInteger(
        getSingleQueryParam(params, "page_size"),
        10,
        "page_size",
        100,
      );

      const sortBy = parseSortBy(
        getSingleQueryParam(params, "sort_by"),
      );

      const sortOrder = parseSortOrder(
        getSingleQueryParam(params, "sort_order"),
      );

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

      // Authorization must happen before reading site or analytics data.
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

      const result = await getLocationStats({
        database,
        siteId,
        start: dateRange.start,
        end: dateRange.end,
        page,
        pageSize,
        sortBy,
        sortOrder,
      });

      const totalPages = Math.ceil(result.total / pageSize);

      return successResponse(
        {
          items: result.items,
        },
        {
          site_id: siteId,
          range: dateRange.range,
          start: dateRange.startIso,
          end: dateRange.endIso,
          timezone: dateRange.timeZone,
          page,
          page_size: pageSize,
          total: result.total,
          total_pages: totalPages,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      );
    } catch (error) {
      if (error instanceof AnalyticsError) {
        return errorResponse(error);
      }

      console.error("[analytics-locations] Unexpected error:", error);

      return errorResponse(
        new AnalyticsError(
          "INTERNAL_ERROR",
          "An internal error occurred.",
        ),
      );
    }
  };
}

export default createLocationsHandler({
  database: pool,
  resolveAuthorization: createAdminAuthorization,
});


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
  getSourcesStats,
  type SourceDimension,
  type SourcePagination,
} from "./_shared/analytics/sources-service.js";

export const config = {
  path: "/api/analytics/sources",
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

const DIMENSIONS: SourceDimension[] = [
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
];

const ALLOWED_QUERY_PARAMS = new Set([
  "site_id",
  "range",
  "start",
  "end",
  ...DIMENSIONS.flatMap((dimension) => [
    `${dimension}_page`,
    `${dimension}_page_size`,
  ]),
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

function parseDimensionPagination(
  params: URLSearchParams,
  dimension: SourceDimension,
): SourcePagination {
  return {
    page: parsePositiveInteger(
      getSingleQueryParam(params, `${dimension}_page`),
      1,
      `${dimension}_page`,
    ),
    pageSize: parsePositiveInteger(
      getSingleQueryParam(params, `${dimension}_page_size`),
      10,
      `${dimension}_page_size`,
      100,
    ),
  };
}

export function createSourcesHandler(
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

      // Reject unknown query parameters.
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

      // Validate date range parameters.
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

      // Parse independent pagination for each dimension.
      const pagination = Object.fromEntries(
        DIMENSIONS.map((dimension) => [
          dimension,
          parseDimensionPagination(params, dimension),
        ]),
      ) as Record<SourceDimension, SourcePagination>;

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

      const result = await getSourcesStats({
        database,
        siteId,
        start: dateRange.start,
        end: dateRange.end,
        pagination,
      });

      return successResponse(
        {
          referrer_host: {
            items: result.referrer_host.items,
          },
          utm_source: {
            items: result.utm_source.items,
          },
          utm_medium: {
            items: result.utm_medium.items,
          },
          utm_campaign: {
            items: result.utm_campaign.items,
          },
        },
        {
          site_id: siteId,
          range: dateRange.range,
          start: dateRange.startIso,
          end: dateRange.endIso,
          timezone: dateRange.timeZone,

          referrer_host: {
            page: result.referrer_host.page,
            page_size: result.referrer_host.pageSize,
            total: result.referrer_host.total,
            total_pages: result.referrer_host.totalPages,
          },

          utm_source: {
            page: result.utm_source.page,
            page_size: result.utm_source.pageSize,
            total: result.utm_source.total,
            total_pages: result.utm_source.totalPages,
          },

          utm_medium: {
            page: result.utm_medium.page,
            page_size: result.utm_medium.pageSize,
            total: result.utm_medium.total,
            total_pages: result.utm_medium.totalPages,
          },

          utm_campaign: {
            page: result.utm_campaign.page,
            page_size: result.utm_campaign.pageSize,
            total: result.utm_campaign.total,
            total_pages: result.utm_campaign.totalPages,
          },
        },
      );
    } catch (error) {
      if (error instanceof AnalyticsError) {
        return errorResponse(error);
      }

      console.error("[analytics-sources] Unexpected error:", error);

      return errorResponse(
        new AnalyticsError(
          "INTERNAL_ERROR",
          "An internal error occurred.",
        ),
      );
    }
  };
}

export default createSourcesHandler({
  database: pool,
  resolveAuthorization: createAdminAuthorization,
});

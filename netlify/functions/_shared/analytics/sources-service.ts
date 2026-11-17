
import type { Pool } from "pg";

export type SourceDimension =
  | "referrer_host"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign";

export interface SourceStatsItem {
  source: string | null;
  pv: number;
  uv: number;
}

export interface SourcePagination {
  page: number;
  pageSize: number;
}

export interface SourcesStatsOptions {
  database: Pick<Pool, "query">;
  siteId: string;
  start: Date;
  end: Date;
  pagination: Record<SourceDimension, SourcePagination>;
}

export interface SourceStatsResult {
  items: SourceStatsItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SourcesStatsResult {
  referrer_host: SourceStatsResult;
  utm_source: SourceStatsResult;
  utm_medium: SourceStatsResult;
  utm_campaign: SourceStatsResult;
}

interface CountRow {
  total: string | number;
}

interface StatsRow {
  source: string | null;
  pv: string | number;
  uv: string | number;
}

const SOURCE_COLUMNS: Record<SourceDimension, string> = {
  referrer_host: "referrer_host",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
};

function validateDateRange(start: Date, end: Date): void {
  if (
    !(start instanceof Date) ||
    !(end instanceof Date) ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start >= end
  ) {
    throw new Error("Invalid date range");
  }
}

function validatePagination(pagination: SourcePagination): void {
  if (
    !Number.isSafeInteger(pagination.page) ||
    pagination.page < 1
  ) {
    throw new Error("Invalid page");
  }

  if (
    !Number.isSafeInteger(pagination.pageSize) ||
    pagination.pageSize < 1 ||
    pagination.pageSize > 100
  ) {
    throw new Error("Invalid pageSize");
  }

  const offset = (pagination.page - 1) * pagination.pageSize;

  if (!Number.isSafeInteger(offset)) {
    throw new Error("Invalid pagination offset");
  }
}

async function getDimensionStats(
  database: Pick<Pool, "query">,
  siteId: string,
  start: Date,
  end: Date,
  dimension: SourceDimension,
  pagination: SourcePagination,
): Promise<SourceStatsResult> {
  const column = SOURCE_COLUMNS[dimension];

  const offset = (pagination.page - 1) * pagination.pageSize;

  // 统计分组总数，不受当前分页影响。
  const countResult = await database.query<CountRow>(
    `
      SELECT COUNT(*) AS total
      FROM (
        SELECT ${column}
        FROM page_events
        WHERE site_id = $1
          AND event_type = 'page_view'
          AND received_at >= $2
          AND received_at < $3
        GROUP BY ${column}
      ) AS grouped_sources
    `,
    [siteId, start, end],
  );

  const total = Number(countResult.rows[0]?.total ?? 0);

  // 查询当前维度的分页数据。
  const statsResult = await database.query<StatsRow>(
    `
      SELECT
        ${column} AS source,
        COUNT(*) AS pv,
        COUNT(DISTINCT visitor_id) AS uv
      FROM page_events
      WHERE site_id = $1
        AND event_type = 'page_view'
        AND received_at >= $2
        AND received_at < $3
      GROUP BY ${column}
      ORDER BY
        COUNT(*) DESC,
        ${column} ASC NULLS LAST
      LIMIT $4
      OFFSET $5
    `,
    [
      siteId,
      start,
      end,
      pagination.pageSize,
      offset,
    ],
  );

  return {
    items: statsResult.rows.map((row) => ({
      source: row.source,
      pv: Number(row.pv),
      uv: Number(row.uv),
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: total === 0
      ? 0
      : Math.ceil(total / pagination.pageSize),
  };
}

export async function getSourcesStats(
  options: SourcesStatsOptions,
): Promise<SourcesStatsResult> {
  const {
    database,
    siteId,
    start,
    end,
    pagination,
  } = options;

  if (!siteId || typeof siteId !== "string") {
    throw new Error("Invalid siteId");
  }

  validateDateRange(start, end);

  validatePagination(pagination.referrer_host);
  validatePagination(pagination.utm_source);
  validatePagination(pagination.utm_medium);
  validatePagination(pagination.utm_campaign);

  const [
    referrer_host,
    utm_source,
    utm_medium,
    utm_campaign,
  ] = await Promise.all([
    getDimensionStats(
      database,
      siteId,
      start,
      end,
      "referrer_host",
      pagination.referrer_host,
    ),
    getDimensionStats(
      database,
      siteId,
      start,
      end,
      "utm_source",
      pagination.utm_source,
    ),
    getDimensionStats(
      database,
      siteId,
      start,
      end,
      "utm_medium",
      pagination.utm_medium,
    ),
    getDimensionStats(
      database,
      siteId,
      start,
      end,
      "utm_campaign",
      pagination.utm_campaign,
    ),
  ]);

  return {
    referrer_host,
    utm_source,
    utm_medium,
    utm_campaign,
  };
}


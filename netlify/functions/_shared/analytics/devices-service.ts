
import type { Pool } from "pg";

export type DeviceDimension = "browser" | "os";

export interface DeviceStatsItem {
  device: string | null;
  pv: number;
  uv: number;
}

export interface DevicePagination {
  page: number;
  pageSize: number;
}

export interface DevicesStatsOptions {
  database: Pick<Pool, "query">;
  siteId: string;
  start: Date;
  end: Date;
  pagination: Record<DeviceDimension, DevicePagination>;
}

export interface DeviceStatsResult {
  items: DeviceStatsItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DevicesStatsResult {
  browser: DeviceStatsResult;
  os: DeviceStatsResult;
}

interface CountRow {
  total: string | number;
}

interface StatsRow {
  device: string | null;
  pv: string | number;
  uv: string | number;
}

const DEVICE_COLUMNS: Record<DeviceDimension, string> = {
  browser: "browser",
  os: "os",
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

function validatePagination(pagination: DevicePagination): void {
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
  dimension: DeviceDimension,
  pagination: DevicePagination,
): Promise<DeviceStatsResult> {
  const column = DEVICE_COLUMNS[dimension];

  const offset = (pagination.page - 1) * pagination.pageSize;

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
      ) AS grouped_devices
    `,
    [siteId, start, end],
  );

  const total = Number(countResult.rows[0]?.total ?? 0);

  const statsResult = await database.query<StatsRow>(
    `
      SELECT
        ${column} AS device,
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
      device: row.device,
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

export async function getDevicesStats(
  options: DevicesStatsOptions,
): Promise<DevicesStatsResult> {
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

  validatePagination(pagination.browser);
  validatePagination(pagination.os);

  const [browser, os] = await Promise.all([
    getDimensionStats(
      database,
      siteId,
      start,
      end,
      "browser",
      pagination.browser,
    ),
    getDimensionStats(
      database,
      siteId,
      start,
      end,
      "os",
      pagination.os,
    ),
  ]);

  return { browser, os };
}


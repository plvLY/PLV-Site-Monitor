
import type { Pool } from "pg";

export type LocationSortBy =
  | "pv"
  | "uv"
  | "country_code"
  | "region"
  | "city";

export type SortOrder = "asc" | "desc";

export interface LocationStatsItem {
  country_code: string | null;
  region: string | null;
  city: string | null;
  pv: number;
  uv: number;
}

export interface LocationStatsResult {
  items: LocationStatsItem[];
  total: number;
}

interface LocationStatsRow {
  country_code: string | null;
  region: string | null;
  city: string | null;
  pv: string | number;
  uv: string | number;
}

interface TotalRow {
  total: string | number;
}

export interface GetLocationStatsOptions {
  database: Pick<Pool, "query">;
  siteId: string;
  start: Date;
  end: Date;
  page: number;
  pageSize: number;
  sortBy?: LocationSortBy;
  sortOrder?: SortOrder;
}

const SORT_COLUMNS: Record<LocationSortBy, string> = {
  pv: "pv",
  uv: "uv",
  country_code: "country_code",
  region: "region",
  city: "city",
};

function toNumber(value: string | number): number {
  return Number(value);
}

export async function getLocationStats(
  options: GetLocationStatsOptions,
): Promise<LocationStatsResult> {
  const {
    database,
    siteId,
    start,
    end,
    page,
    pageSize,
    sortBy = "pv",
    sortOrder = "desc",
  } = options;

  // 日期范围校验
  if (start.getTime() >= end.getTime()) {
    throw new Error("Location stats start must be earlier than end.");
  }

  // 分页参数校验
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(
      "Page must be an integer greater than or equal to 1.",
    );
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new Error(
      "Page size must be an integer between 1 and 100.",
    );
  }

  // 排序参数校验
  if (!Object.hasOwn(SORT_COLUMNS, sortBy)) {
    throw new Error("Invalid location sort field.");
  }

  if (sortOrder !== "asc" && sortOrder !== "desc") {
    throw new Error("Invalid location sort order.");
  }

  const offset = (page - 1) * pageSize;
  const sortColumn = SORT_COLUMNS[sortBy];
  const direction = sortOrder.toUpperCase();

  const parameters = [siteId, start, end];

  // 查询符合条件的地理位置组合总数。
  const countResult = await database.query<TotalRow>(
    `
      SELECT COUNT(*) AS total
      FROM (
        SELECT
          country_code,
          region,
          city
        FROM page_events
        WHERE site_id = $1::uuid
          AND event_type = 'page_view'
          AND received_at >= $2::timestamptz
          AND received_at < $3::timestamptz
        GROUP BY
          country_code,
          region,
          city
      ) AS location_groups
    `,
    parameters,
  );

  // 查询地理位置组合的 PV、UV 及分页数据。
  const result = await database.query<LocationStatsRow>(
    `
      WITH filtered_events AS (
        SELECT
          country_code,
          region,
          city,
          visitor_id
        FROM page_events
        WHERE site_id = $1::uuid
          AND event_type = 'page_view'
          AND received_at >= $2::timestamptz
          AND received_at < $3::timestamptz
      ),
      location_stats AS (
        SELECT
          country_code,
          region,
          city,
          COUNT(*) AS pv,
          COUNT(DISTINCT visitor_id) AS uv
        FROM filtered_events
        GROUP BY
          country_code,
          region,
          city
      )
      SELECT
        country_code,
        region,
        city,
        pv,
        uv
      FROM location_stats
      ORDER BY
        ${sortColumn} ${direction} NULLS LAST,
        country_code ASC NULLS LAST,
        region ASC NULLS LAST,
        city ASC NULLS LAST
      LIMIT $4
      OFFSET $5
    `,
    [...parameters, pageSize, offset],
  );

  return {
    items: result.rows.map((row) => ({
      country_code: row.country_code,
      region: row.region,
      city: row.city,
      pv: toNumber(row.pv),
      uv: toNumber(row.uv),
    })),
    total: toNumber(countResult.rows[0]?.total ?? 0),
  };
}

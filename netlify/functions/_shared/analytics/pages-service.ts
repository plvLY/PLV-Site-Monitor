
import type { Pool } from "pg";

export type PageSortBy = "pv" | "uv" | "pv_share" | "page_path";
export type SortOrder = "asc" | "desc";

export interface PageStatsItem {
  page_path: string;
  pv: number;
  uv: number;
  pv_share: number;
}

export interface PageStatsResult {
  items: PageStatsItem[];
  total: number;
}

interface PageStatsRow {
  page_path: string;
  pv: string | number;
  uv: string | number;
  pv_share: string | number;
}

interface TotalRow {
  total: string | number;
}

export interface GetPageStatsOptions {
  database: Pick<Pool, "query">;
  siteId: string;
  start: Date;
  end: Date;
  page: number;
  pageSize: number;
  sortBy?: PageSortBy;
  sortOrder?: SortOrder;
}

const SORT_COLUMNS: Record<PageSortBy, string> = {
  pv: "pv",
  uv: "uv",
  pv_share: "pv_share",
  page_path: "page_path",
};

function toNumber(value: string | number): number {
  return Number(value);
}

export async function getPageStats(
  options: GetPageStatsOptions,
): Promise<PageStatsResult> {
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

  if (start.getTime() >= end.getTime()) {
    throw new Error("Page stats start must be earlier than end.");
  }

  if (!Number.isInteger(page) || page < 1) {
    throw new Error("Page must be an integer greater than or equal to 1.");
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new Error("Page size must be an integer between 1 and 100.");
  }

  if (!Object.hasOwn(SORT_COLUMNS, sortBy)) {
    throw new Error("Invalid page sort field.");
  }

  if (sortOrder !== "asc" && sortOrder !== "desc") {
    throw new Error("Invalid page sort order.");
  }

  const offset = (page - 1) * pageSize;
  const sortColumn = SORT_COLUMNS[sortBy];
  const direction = sortOrder.toUpperCase();

  const parameters = [siteId, start, end];

  // 查询符合条件的页面分组总数。
  const countResult = await database.query<TotalRow>(
    `
      SELECT COUNT(*) AS total
      FROM (
        SELECT page_path
        FROM page_events
        WHERE site_id = $1::uuid
          AND event_type = 'page_view'
          AND received_at >= $2::timestamptz
          AND received_at < $3::timestamptz
        GROUP BY page_path
      ) AS page_groups
    `,
    parameters,
  );

  // 查询页面 PV、UV 及其占整体 PV 的比例。
  const result = await database.query<PageStatsRow>(
    `
      WITH filtered_events AS (
        SELECT
          page_path,
          visitor_id
        FROM page_events
        WHERE site_id = $1::uuid
          AND event_type = 'page_view'
          AND received_at >= $2::timestamptz
          AND received_at < $3::timestamptz
      ),
      page_stats AS (
        SELECT
          page_path,
          COUNT(*) AS pv,
          COUNT(DISTINCT visitor_id) AS uv
        FROM filtered_events
        GROUP BY page_path
      ),
      total_stats AS (
        SELECT COUNT(*) AS total_pv
        FROM filtered_events
      )
      SELECT
        page_stats.page_path,
        page_stats.pv,
        page_stats.uv,
        CASE
          WHEN total_stats.total_pv = 0 THEN 0
          ELSE ROUND(
            page_stats.pv * 100.0 / total_stats.total_pv,
            2
          )
        END AS pv_share
      FROM page_stats
      CROSS JOIN total_stats
      ORDER BY ${sortColumn} ${direction}, page_stats.page_path ASC
      LIMIT $4
      OFFSET $5
    `,
    [...parameters, pageSize, offset],
  );

  return {
    items: result.rows.map((row) => ({
      page_path: row.page_path,
      pv: toNumber(row.pv),
      uv: toNumber(row.uv),
      pv_share: toNumber(row.pv_share),
    })),
    total: toNumber(countResult.rows[0]?.total ?? 0),
  };
}

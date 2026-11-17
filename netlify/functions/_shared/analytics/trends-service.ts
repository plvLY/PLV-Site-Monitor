
import type { Pool } from "pg";

export type TrendGranularity = "hour" | "day";

export interface HourlyTrendItem {
  bucket_start_utc: string;
  date: string;
  offset_minutes: number;
  pv: number;
  uv: number;
}

export interface DailyTrendItem {
  date: string;
  pv: number;
  uv: number;
}

export type TrendItem = HourlyTrendItem | DailyTrendItem;

interface HourlyTrendRow {
  bucket_start_utc: Date | string;
  local_date: string;
  offset_minutes: number | string;
  pv: string | number;
  uv: string | number;
}

interface DailyTrendRow {
  date: string;
  pv: string | number;
  uv: string | number;
}

function toNumber(value: string | number): number {
  return Number(value);
}

export async function getTrendStats(
  database: Pick<Pool, "query">,
  siteId: string,
  start: Date,
  end: Date,
  timeZone: string,
  granularity: TrendGranularity,
): Promise<TrendItem[]> {
  if (start.getTime() >= end.getTime()) {
    throw new Error("Trend start must be earlier than end.");
  }

  if (granularity === "hour") {
    const result = await database.query<HourlyTrendRow>(
      `
      WITH bounds AS (
        SELECT
          date_trunc(
            'hour',
            $2::timestamptz AT TIME ZONE 'UTC'
          ) AT TIME ZONE 'UTC' AS first_bucket,
          $3::timestamptz AS end_time
      ),
      buckets AS (
        SELECT
          generated.bucket_start
        FROM bounds
        CROSS JOIN LATERAL generate_series(
          bounds.first_bucket,
          bounds.end_time - INTERVAL '1 microsecond',
          INTERVAL '1 hour'
        ) AS generated(bucket_start)
      ),
      event_stats AS (
        SELECT
          date_trunc(
            'hour',
            received_at AT TIME ZONE 'UTC'
          ) AT TIME ZONE 'UTC' AS bucket_start,
          COUNT(*) AS pv,
          COUNT(DISTINCT visitor_id) AS uv
        FROM page_events
        WHERE site_id = $1::uuid
          AND event_type = 'page_view'
          AND received_at >= $2::timestamptz
          AND received_at < $3::timestamptz
        GROUP BY 1
      )
      SELECT
        buckets.bucket_start AS bucket_start_utc,
        to_char(
          buckets.bucket_start AT TIME ZONE $4,
          'YYYY-MM-DD"T"HH24:MI:SS'
        ) AS local_date,
        (
          EXTRACT(
            EPOCH FROM (
              (buckets.bucket_start AT TIME ZONE $4)
              -
              (buckets.bucket_start AT TIME ZONE 'UTC')
            )
          ) / 60
        )::integer AS offset_minutes,
        COALESCE(event_stats.pv, 0)::bigint AS pv,
        COALESCE(event_stats.uv, 0)::bigint AS uv
      FROM buckets
      LEFT JOIN event_stats
        ON event_stats.bucket_start = buckets.bucket_start
      ORDER BY buckets.bucket_start ASC
      `,
      [siteId, start, end, timeZone],
    );

    return result.rows.map((row) => ({
      bucket_start_utc:
        row.bucket_start_utc instanceof Date
          ? row.bucket_start_utc.toISOString()
          : new Date(row.bucket_start_utc).toISOString(),
      date: row.local_date,
      offset_minutes: toNumber(row.offset_minutes),
      pv: toNumber(row.pv),
      uv: toNumber(row.uv),
    }));
  }

  const result = await database.query<DailyTrendRow>(
    `
    WITH bounds AS (
      SELECT
        ($2::timestamptz AT TIME ZONE $4)::date AS first_day,
        (($3::timestamptz - INTERVAL '1 microsecond')
          AT TIME ZONE $4)::date AS last_day
    ),
    buckets AS (
      SELECT generated.local_day::date AS local_day
      FROM bounds
      CROSS JOIN LATERAL generate_series(
        bounds.first_day::timestamp,
        bounds.last_day::timestamp,
        INTERVAL '1 day'
      ) AS generated(local_day)
    ),
    event_stats AS (
      SELECT
        (received_at AT TIME ZONE $4)::date AS local_day,
        COUNT(*) AS pv,
        COUNT(DISTINCT visitor_id) AS uv
      FROM page_events
      WHERE site_id = $1::uuid
        AND event_type = 'page_view'
        AND received_at >= $2::timestamptz
        AND received_at < $3::timestamptz
      GROUP BY 1
    )
    SELECT
      to_char(buckets.local_day, 'YYYY-MM-DD') AS date,
      COALESCE(event_stats.pv, 0)::bigint AS pv,
      COALESCE(event_stats.uv, 0)::bigint AS uv
    FROM buckets
    LEFT JOIN event_stats
      ON event_stats.local_day = buckets.local_day
    ORDER BY buckets.local_day ASC
    `,
    [siteId, start, end, timeZone],
  );

  return result.rows.map((row) => ({
    date: row.date,
    pv: toNumber(row.pv),
    uv: toNumber(row.uv),
  }));
}

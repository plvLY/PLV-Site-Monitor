import type { Pool } from "pg";

export interface OverviewStats {
  pv: number;
  uv: number;
  sessions: number;
  bounce_sessions: number;
  bounce_rate: number | null;
}

interface OverviewRow {
  pv: string | number;
  uv: string | number;
  sessions: string | number;
  bounce_sessions: string | number;
}

export async function getOverviewStats(
  database: Pick<Pool, "query">,
  siteId: string,
  start: Date,
  end: Date,
): Promise<OverviewStats> {
  const result = await database.query<OverviewRow>(
    `
    WITH filtered_events AS (
      SELECT
        visitor_id,
        session_id
      FROM page_events
      WHERE site_id = $1::uuid
        AND event_type = 'page_view'
        AND received_at >= $2::timestamptz
        AND received_at < $3::timestamptz
    ),
    session_stats AS (
      SELECT
        session_id,
        COUNT(*) AS page_view_count
      FROM filtered_events
      GROUP BY session_id
    ),
    overview_counts AS (
      SELECT
        COUNT(*) AS pv,
        COUNT(DISTINCT visitor_id) AS uv,
        COUNT(DISTINCT session_id) AS sessions
      FROM filtered_events
    ),
    bounce_counts AS (
      SELECT
        COUNT(*) FILTER (
          WHERE page_view_count = 1
        ) AS bounce_sessions
      FROM session_stats
    )
    SELECT
      overview_counts.pv,
      overview_counts.uv,
      overview_counts.sessions,
      bounce_counts.bounce_sessions
    FROM overview_counts
    CROSS JOIN bounce_counts
    `,
    [siteId, start, end],
  );

  const row = result.rows[0];

  const pv = Number(row?.pv ?? 0);
  const uv = Number(row?.uv ?? 0);
  const sessions = Number(row?.sessions ?? 0);
  const bounceSessions = Number(row?.bounce_sessions ?? 0);

  return {
    pv,
    uv,
    sessions,
    bounce_sessions: bounceSessions,
    bounce_rate:
      sessions === 0
        ? null
        : Number(((bounceSessions / sessions) * 100).toFixed(2)),
  };
}
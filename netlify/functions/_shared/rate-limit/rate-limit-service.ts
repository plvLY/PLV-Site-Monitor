
import type { Pool } from "pg";

export const SITE_RATE_LIMIT_WINDOW_SECONDS = 60;

const MIN_MAX_REQUESTS = 1;
const MAX_MAX_REQUESTS = 10000;
const MAX_COUNTER_VALUE = MAX_MAX_REQUESTS + 1;

interface RateLimitDatabase {
  query: Pick<Pool, "query">["query"];
}

interface SiteRateLimitRow {
  request_count: number;
  window_start: Date;
  retry_after_seconds: number;
}

export interface SiteRateLimitResult {
  allowed: boolean;
  requestCount: number;
  windowStart: Date;
  retryAfterSeconds: number | null;
}

/**
 * Atomically consumes one request from a site's fixed 60-second rate limit window.
 *
 * The window is aligned to Unix epoch boundaries.
 * PostgreSQL is the authoritative time source.
 *
 * Requests are counted up to the system-wide maximum limit + 1.
 * Database errors are intentionally propagated to the caller.
 */
export async function checkSiteRateLimit(
  database: RateLimitDatabase,
  siteId: string,
  maxRequests: number,
): Promise<SiteRateLimitResult> {
  if (!siteId || typeof siteId !== "string") {
    throw new TypeError("siteId must be a non-empty string");
  }

  if (
    !Number.isInteger(maxRequests) ||
    maxRequests < MIN_MAX_REQUESTS ||
    maxRequests > MAX_MAX_REQUESTS
  ) {
    throw new RangeError(
      `maxRequests must be an integer between ${MIN_MAX_REQUESTS} and ${MAX_MAX_REQUESTS}`,
    );
  }

  const result = await database.query<SiteRateLimitRow>(
    `
      WITH request_clock AS MATERIALIZED (
        SELECT clock_timestamp() AS now
      ),
      request_window AS MATERIALIZED (
        SELECT
          to_timestamp(
            floor(extract(epoch FROM now) / $3) * $3
          ) AS window_start
        FROM request_clock
      )
      INSERT INTO site_rate_limit_counters AS counter (
        site_id,
        window_start,
        request_count,
        created_at,
        updated_at
      )
      SELECT
        $1::uuid,
        request_window.window_start,
        1,
        request_clock.now,
        request_clock.now
      FROM request_clock
      CROSS JOIN request_window
      WHERE TRUE
      ON CONFLICT (site_id, window_start)
      DO UPDATE SET
        request_count = LEAST(
          counter.request_count + 1,
          $2::integer
        ),
        updated_at = EXCLUDED.updated_at
      RETURNING
        request_count,
        window_start,
        GREATEST(
          0,
          CEIL(
            EXTRACT(
              EPOCH FROM (
                window_start
                + INTERVAL '60 seconds'
                - clock_timestamp()
              )
            )
          )::integer
        ) AS retry_after_seconds
    `,
    [siteId, MAX_COUNTER_VALUE, SITE_RATE_LIMIT_WINDOW_SECONDS],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Site rate limit counter update returned no result");
  }

  const allowed = row.request_count <= maxRequests;

  return {
    allowed,
    requestCount: row.request_count,
    windowStart: row.window_start,
    retryAfterSeconds: allowed ? null : row.retry_after_seconds,
  };
}

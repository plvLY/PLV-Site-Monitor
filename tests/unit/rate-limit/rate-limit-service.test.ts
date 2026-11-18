
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkSiteRateLimit,
  SITE_RATE_LIMIT_WINDOW_SECONDS,
} from "../../../netlify/functions/_shared/rate-limit/rate-limit-service";

const SITE_ID = "accb07ee-6504-4855-b25b-4a5bf22d8164";

const WINDOW_START = new Date("2026-11-18T10:00:00.000Z");

function createTestDatabase(
  rows: Array<{
    request_count: number;
    window_start: Date;
    retry_after_seconds: number;
  }> = [],
) {
  const query = vi.fn().mockResolvedValue({
    rows,
    rowCount: rows.length,
  });

  const database = {
    query,
  } as unknown as Parameters<typeof checkSiteRateLimit>[0];

  return { database, query };
}

describe("checkSiteRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a request below the configured limit", async () => {
    const { database, query } = createTestDatabase([
      {
        request_count: 1,
        window_start: WINDOW_START,
        retry_after_seconds: 0,
      },
    ]);

    const result = await checkSiteRateLimit(database, SITE_ID, 600);

    expect(result).toEqual({
      allowed: true,
      requestCount: 1,
      windowStart: WINDOW_START,
      retryAfterSeconds: null,
    });

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      [SITE_ID, 10001, SITE_RATE_LIMIT_WINDOW_SECONDS],
    );
  });

  it("allows the request that reaches the configured limit", async () => {
    const { database } = createTestDatabase([
      {
        request_count: 600,
        window_start: WINDOW_START,
        retry_after_seconds: 0,
      },
    ]);

    const result = await checkSiteRateLimit(database, SITE_ID, 600);

    expect(result.allowed).toBe(true);
    expect(result.requestCount).toBe(600);
    expect(result.retryAfterSeconds).toBeNull();
  });

  it("rejects the first request exceeding the configured limit", async () => {
    const { database } = createTestDatabase([
      {
        request_count: 601,
        window_start: WINDOW_START,
        retry_after_seconds: 37,
      },
    ]);

    const result = await checkSiteRateLimit(database, SITE_ID, 600);

    expect(result).toEqual({
      allowed: false,
      requestCount: 601,
      windowStart: WINDOW_START,
      retryAfterSeconds: 37,
    });
  });

  it("returns the database retry interval for rejected requests", async () => {
    const { database } = createTestDatabase([
      {
        request_count: 101,
        window_start: WINDOW_START,
        retry_after_seconds: 42,
      },
    ]);

    const result = await checkSiteRateLimit(database, SITE_ID, 100);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(42);
  });

  it("uses an atomic upsert and saturates the counter at the system maximum + 1", async () => {
    const { database, query } = createTestDatabase([
      {
        request_count: 101,
        window_start: WINDOW_START,
        retry_after_seconds: 30,
      },
    ]);

    await checkSiteRateLimit(database, SITE_ID, 100);

    const [sql, parameters] = query.mock.calls[0];

    expect(sql).toContain("ON CONFLICT (site_id, window_start)");
    expect(sql).toContain("DO UPDATE SET");
    expect(sql).toContain("LEAST(");
    expect(sql).toContain("counter.request_count + 1");
    expect(sql).toContain("$2::integer");
    expect(sql).not.toContain("$2::integer + 1");

    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("INTERVAL '60 seconds'");

    expect(parameters).toEqual([
      SITE_ID,
      10001,
      SITE_RATE_LIMIT_WINDOW_SECONDS,
    ]);
  });

  it("applies the current limit while preserving the counter value", async () => {
    const lowLimitDb = createTestDatabase([
      {
        request_count: 500,
        window_start: WINDOW_START,
        retry_after_seconds: 30,
      },
    ]);

    const highLimitDb = createTestDatabase([
      {
        request_count: 500,
        window_start: WINDOW_START,
        retry_after_seconds: 30,
      },
    ]);

    const rejected = await checkSiteRateLimit(
      lowLimitDb.database,
      SITE_ID,
      100,
    );

    const allowed = await checkSiteRateLimit(
      highLimitDb.database,
      SITE_ID,
      600,
    );

    expect(rejected.allowed).toBe(false);
    expect(rejected.requestCount).toBe(500);

    expect(allowed.allowed).toBe(true);
    expect(allowed.requestCount).toBe(500);

    expect(lowLimitDb.query.mock.calls[0][1]).toEqual([
      SITE_ID,
      10001,
      SITE_RATE_LIMIT_WINDOW_SECONDS,
    ]);

    expect(highLimitDb.query.mock.calls[0][1]).toEqual([
      SITE_ID,
      10001,
      SITE_RATE_LIMIT_WINDOW_SECONDS,
    ]);
  });
  it("uses a fixed 60-second window", () => {
    expect(SITE_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
  });

  it("rejects an empty site ID without querying the database", async () => {
    const { database, query } = createTestDatabase();

    await expect(
      checkSiteRateLimit(database, "", 600),
    ).rejects.toThrow("siteId must be a non-empty string");

    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    0,
    -1,
    10001,
    1.5,
    NaN,
    Infinity,
  ])("rejects invalid maxRequests: %s", async (maxRequests) => {
    const { database, query } = createTestDatabase();

    await expect(
      checkSiteRateLimit(database, SITE_ID, maxRequests),
    ).rejects.toThrow(RangeError);

    expect(query).not.toHaveBeenCalled();
  });

  it.each([1, 10000])(
    "accepts maxRequests boundary value %s",
    async (maxRequests) => {
      const { database, query } = createTestDatabase([
        {
          request_count: 1,
          window_start: WINDOW_START,
          retry_after_seconds: 0,
        },
      ]);

      const result = await checkSiteRateLimit(
        database,
        SITE_ID,
        maxRequests,
      );

      expect(result.allowed).toBe(true);
      expect(query).toHaveBeenCalledOnce();
    },
  );

  it("propagates database errors without swallowing them", async () => {
    const databaseError = new Error("Database connection failed");

    const { database, query } = createTestDatabase();
    query.mockRejectedValueOnce(databaseError);

    await expect(
      checkSiteRateLimit(database, SITE_ID, 600),
    ).rejects.toBe(databaseError);
  });

  it("throws when the database returns no counter row", async () => {
    const { database } = createTestDatabase([]);

    await expect(
      checkSiteRateLimit(database, SITE_ID, 600),
    ).rejects.toThrow(
      "Site rate limit counter update returned no result",
    );
  });
});

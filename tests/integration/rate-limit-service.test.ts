import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

const LOCAL_DATABASE_URL =
  "postgresql://plv_dev:plv_local_dev_2026@localhost:5433/plv_site_monitor_dev";

let pool:
  | typeof import("../../db/client").pool
  | undefined;

let checkSiteRateLimit:
  typeof import("../../netlify/functions/_shared/rate-limit/rate-limit-service").checkSiteRateLimit;

const siteIds: string[] = [];

async function createTestSite(): Promise<string> {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO sites (name)
     VALUES ($1)
     RETURNING id`,
    [`Rate Limit Integration ${crypto.randomUUID()}`],
  );

  const siteId = result.rows[0].id;
  siteIds.push(siteId);

  return siteId;
}

async function seedCurrentWindowCounter(
  siteId: string,
  requestCount: number,
): Promise<Date> {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  const result = await pool.query<{ window_start: Date }>(
    `
      WITH current_window AS (
        SELECT to_timestamp(
          floor(extract(epoch FROM clock_timestamp()) / 60) * 60
        ) AS window_start
      )
      INSERT INTO site_rate_limit_counters (
        site_id,
        window_start,
        request_count
      )
      SELECT $1::uuid, window_start, $2
      FROM current_window
      RETURNING window_start
    `,
    [siteId, requestCount],
  );

  return result.rows[0].window_start;
}

async function runInSeededWindow(
  siteId: string,
  initialCount: number,
  limits: number[],
) {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await pool.query(
      "DELETE FROM site_rate_limit_counters WHERE site_id = $1",
      [siteId],
    );

    const seededWindow = await seedCurrentWindowCounter(
      siteId,
      initialCount,
    );

    const results = [];

    for (const limit of limits) {
      results.push(
        await checkSiteRateLimit(pool, siteId, limit),
      );
    }

    if (
      results.every(
        (result) =>
          result.windowStart.getTime() === seededWindow.getTime(),
      )
    ) {
      return results;
    }
  }

  throw new Error(
    "Could not complete rate limit test within one database window",
  );
}

describe("Site Rate Limit Service Integration", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ||= LOCAL_DATABASE_URL;

    const databaseUrl = process.env.DATABASE_URL;

    if (databaseUrl !== LOCAL_DATABASE_URL) {
      throw new Error(
        "Unsafe database target. Only local plv_site_monitor_dev is allowed.",
      );
    }

    const parsed = new URL(databaseUrl);

    if (
      !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
      parsed.port !== "5433" ||
      parsed.pathname !== "/plv_site_monitor_dev"
    ) {
      throw new Error(
        "Unsafe database target. Only local plv_site_monitor_dev is allowed.",
      );
    }

    const [clientModule, serviceModule] = await Promise.all([
      import("../../db/client"),
      import("../../netlify/functions/_shared/rate-limit/rate-limit-service"),
    ]);

    pool = clientModule.pool;
    checkSiteRateLimit = serviceModule.checkSiteRateLimit;
  });

  afterEach(async () => {
    if (!pool) return;

    for (const siteId of siteIds.splice(0)) {
      await pool.query(
        "DELETE FROM sites WHERE id = $1",
        [siteId],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("rejects requests after the configured site limit", async () => {
    const siteId = await createTestSite();

    const results = await runInSeededWindow(
      siteId,
      2,
      [2],
    );

    expect(results[0].requestCount).toBe(3);
    expect(results[0].allowed).toBe(false);
    expect(results[0].retryAfterSeconds).not.toBeNull();
  });

  it("keeps counters isolated between sites", async () => {
    const siteA = await createTestSite();
    const siteB = await createTestSite();

    const [resultA, resultB] = await Promise.all([
      checkSiteRateLimit(pool!, siteA, 100),
      checkSiteRateLimit(pool!, siteB, 100),
    ]);

    expect(resultA.requestCount).toBe(1);
    expect(resultB.requestCount).toBe(1);
    expect(resultA.allowed).toBe(true);
    expect(resultB.allowed).toBe(true);
  });

  it("preserves every concurrent request without lost updates", async () => {
    const siteId = await createTestSite();
    const requestTotal = 30;

    const results = await Promise.all(
      Array.from(
        { length: requestTotal },
        () => checkSiteRateLimit(pool!, siteId, 10000),
      ),
    );

    const databaseResult = await pool!.query<{
      window_start: Date;
      request_count: number;
    }>(
      `
        SELECT window_start, request_count
        FROM site_rate_limit_counters
        WHERE site_id = $1
        ORDER BY window_start
      `,
      [siteId],
    );

    const totalCount = databaseResult.rows.reduce(
      (sum, row) => sum + row.request_count,
      0,
    );

    expect(totalCount).toBe(requestTotal);

    const groupedResults = new Map<string, number[]>();

    for (const result of results) {
      const key = result.windowStart.toISOString();
      const counts = groupedResults.get(key) ?? [];

      counts.push(result.requestCount);
      groupedResults.set(key, counts);
    }

    for (const counts of groupedResults.values()) {
      counts.sort((a, b) => a - b);

      expect(counts).toEqual(
        Array.from({ length: counts.length }, (_, index) => index + 1),
      );
    }
  });

  it("preserves accumulated counts when the configured limit changes", async () => {
    const siteId = await createTestSite();

    const results = await runInSeededWindow(
      siteId,
      500,
      [100, 600],
    );

    expect(results[0].requestCount).toBe(501);
    expect(results[0].allowed).toBe(false);

    expect(results[1].requestCount).toBe(502);
    expect(results[1].allowed).toBe(true);
  });

  it("saturates the counter at the system maximum plus one", async () => {
    const siteId = await createTestSite();

    const results = await runInSeededWindow(
      siteId,
      10000,
      [10000, 10000],
    );

    expect(results[0].requestCount).toBe(10001);
    expect(results[1].requestCount).toBe(10001);

    expect(results[0].allowed).toBe(false);
    expect(results[1].allowed).toBe(false);
  });
});

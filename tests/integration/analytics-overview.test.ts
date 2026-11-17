import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../db/client";
import {
  getOverviewStats,
} from "../../netlify/functions/_shared/analytics/overview-service";

describe("Overview statistics - PostgreSQL integration", () => {
  const siteA = "accb07ee-6504-4855-b25b-4a5bf22d8164";

  const start = new Date("2026-11-05T00:00:00.000Z");
  const end = new Date("2026-11-09T00:00:00.000Z");

  afterAll(async () => {
    await pool.end();
  });

  it("should calculate overview statistics from real PostgreSQL data", async () => {
    const result = await getOverviewStats(
      pool,
      siteA,
      start,
      end,
    );

    expect(result).toEqual({
      pv: 13,
      uv: 4,
      sessions: 5,
      bounce_sessions: 2,
      bounce_rate: 40,
    });
  });

  it("should isolate statistics by site_id", async () => {
    const siteB = "c77de8cc-d44f-475c-b68c-32975934b0d1";

    const result = await getOverviewStats(
      pool,
      siteB,
      start,
      end,
    );

    expect(result).toEqual({
      pv: 1,
      uv: 1,
      sessions: 1,
      bounce_sessions: 1,
      bounce_rate: 100,
    });
  });

  it("should return zero statistics for an empty time range", async () => {
    const emptyStart = new Date("2026-11-09T00:00:00.000Z");
    const emptyEnd = new Date("2026-11-10T00:00:00.000Z");

    const result = await getOverviewStats(
      pool,
      siteA,
      emptyStart,
      emptyEnd,
    );

    expect(result).toEqual({
      pv: 0,
      uv: 0,
      sessions: 0,
      bounce_sessions: 0,
      bounce_rate: null,
    });
  });
});
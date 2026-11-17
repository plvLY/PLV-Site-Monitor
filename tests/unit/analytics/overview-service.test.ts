import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import {
  getOverviewStats,
} from "../../../netlify/functions/_shared/analytics/overview-service";

function createMockDatabase(row: Record<string, unknown>) {
  return {
    query: vi.fn().mockResolvedValue({
      rows: [row],
    }),
  } as unknown as Pick<Pool, "query">;
}

describe("getOverviewStats", () => {
  const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";
  const start = new Date("2026-11-01T00:00:00.000Z");
  const end = new Date("2026-11-09T00:00:00.000Z");

  it("should return correct overview statistics", async () => {
    const database = createMockDatabase({
      pv: "13",
      uv: "4",
      sessions: "5",
      bounce_sessions: "2",
    });

    const result = await getOverviewStats(
      database,
      siteId,
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

  it("should return null bounce_rate when there are no sessions", async () => {
    const database = createMockDatabase({
      pv: "0",
      uv: "0",
      sessions: "0",
      bounce_sessions: "0",
    });

    const result = await getOverviewStats(
      database,
      siteId,
      start,
      end,
    );

    expect(result).toEqual({
      pv: 0,
      uv: 0,
      sessions: 0,
      bounce_sessions: 0,
      bounce_rate: null,
    });
  });

  it("should calculate bounce rate with two decimal places", async () => {
    const database = createMockDatabase({
      pv: "10",
      uv: "5",
      sessions: "3",
      bounce_sessions: "1",
    });

    const result = await getOverviewStats(
      database,
      siteId,
      start,
      end,
    );

    expect(result.bounce_rate).toBe(33.33);
  });

  it("should use parameterized SQL with site and time range", async () => {
    const database = createMockDatabase({
      pv: "1",
      uv: "1",
      sessions: "1",
      bounce_sessions: "1",
    });

    await getOverviewStats(
      database,
      siteId,
      start,
      end,
    );

    expect(database.query).toHaveBeenCalledTimes(1);

    const [sql, params] = (
      database.query as ReturnType<typeof vi.fn>
    ).mock.calls[0];

    expect(sql).toContain("site_id = $1::uuid");
    expect(sql).toContain("received_at >= $2::timestamptz");
    expect(sql).toContain("received_at < $3::timestamptz");

    expect(params).toEqual([siteId, start, end]);
  });
});
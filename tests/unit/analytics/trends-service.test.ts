
import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import {
  getTrendStats,
} from "../../../netlify/functions/_shared/analytics/trends-service";

function createMockDatabase(rows: unknown[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pick<Pool, "query">;
}

describe("getTrendStats", () => {
  const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";

  const start = new Date("2026-11-08T00:00:00.000Z");
  const end = new Date("2026-11-09T00:00:00.000Z");

  it("should return hourly trend data with UTC keys and local offsets", async () => {
    const database = createMockDatabase([
      {
        bucket_start_utc: new Date("2026-11-08T08:00:00.000Z"),
        local_date: "2026-11-08T01:00:00",
        offset_minutes: "-420",
        pv: "2",
        uv: "1",
      },
      {
        bucket_start_utc: new Date("2026-11-08T09:00:00.000Z"),
        local_date: "2026-11-08T01:00:00",
        offset_minutes: "-480",
        pv: "3",
        uv: "2",
      },
    ]);

    const result = await getTrendStats(
      database,
      siteId,
      start,
      end,
      "America/Los_Angeles",
      "hour",
    );

    expect(result).toEqual([
      {
        bucket_start_utc: "2026-11-08T08:00:00.000Z",
        date: "2026-11-08T01:00:00",
        offset_minutes: -420,
        pv: 2,
        uv: 1,
      },
      {
        bucket_start_utc: "2026-11-08T09:00:00.000Z",
        date: "2026-11-08T01:00:00",
        offset_minutes: -480,
        pv: 3,
        uv: 2,
      },
    ]);
  });

  it("should return daily trend data", async () => {
    const database = createMockDatabase([
      {
        date: "2026-11-08",
        pv: "7",
        uv: "3",
      },
    ]);

    const result = await getTrendStats(
      database,
      siteId,
      start,
      end,
      "Asia/Shanghai",
      "day",
    );

    expect(result).toEqual([
      {
        date: "2026-11-08",
        pv: 7,
        uv: 3,
      },
    ]);
  });

  it("should preserve empty buckets returned by SQL", async () => {
    const database = createMockDatabase([
      {
        bucket_start_utc: new Date("2026-11-08T00:00:00.000Z"),
        local_date: "2026-11-08T00:00:00",
        offset_minutes: "0",
        pv: "0",
        uv: "0",
      },
    ]);

    const result = await getTrendStats(
      database,
      siteId,
      start,
      end,
      "UTC",
      "hour",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      pv: 0,
      uv: 0,
    });
  });

  it("should use parameterized SQL and the requested site and time range", async () => {
    const database = createMockDatabase([]);

    await getTrendStats(
      database,
      siteId,
      start,
      end,
      "Asia/Shanghai",
      "day",
    );

    expect(database.query).toHaveBeenCalledTimes(1);

    const [sql, params] = (
      database.query as ReturnType<typeof vi.fn>
    ).mock.calls[0];

    expect(sql).toContain("site_id = $1::uuid");
    expect(sql).toContain("received_at >= $2::timestamptz");
    expect(sql).toContain("received_at < $3::timestamptz");
    expect(params).toEqual([
      siteId,
      start,
      end,
      "Asia/Shanghai",
    ]);
  });

  it("should reject invalid time ranges before querying", async () => {
    const database = createMockDatabase([]);

    await expect(
      getTrendStats(
        database,
        siteId,
        end,
        start,
        "UTC",
        "day",
      ),
    ).rejects.toThrow("Trend start must be earlier than end.");

    expect(database.query).not.toHaveBeenCalled();
  });
});


import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getLocationStats,
  type GetLocationStatsOptions,
} from "../../../netlify/functions/_shared/analytics/locations-service";

describe("Locations Service", () => {
  const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";
  const start = new Date("2026-11-08T00:00:00.000Z");
  const end = new Date("2026-11-09T00:00:00.000Z");

  let query: ReturnType<typeof vi.fn>;

  function createOptions(
    overrides: Partial<GetLocationStatsOptions> = {},
  ): GetLocationStatsOptions {
    return {
      database: { query } as unknown as GetLocationStatsOptions["database"],
      siteId,
      start,
      end,
      page: 1,
      pageSize: 10,
      ...overrides,
    };
  }

  beforeEach(() => {
    query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ total: "3" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            country_code: "US",
            region: "California",
            city: "San Jose",
            pv: "120",
            uv: "60",
          },
          {
            country_code: "US",
            region: "California",
            city: "Los Angeles",
            pv: "80",
            uv: "40",
          },
          {
            country_code: "US",
            region: null,
            city: null,
            pv: "20",
            uv: "10",
          },
        ],
      });
  });

  it("UT-01: should return location statistics with correct number conversion", async () => {
    const result = await getLocationStats(createOptions());

    expect(result.total).toBe(3);
    expect(result.items).toEqual([
      {
        country_code: "US",
        region: "California",
        city: "San Jose",
        pv: 120,
        uv: 60,
      },
      {
        country_code: "US",
        region: "California",
        city: "Los Angeles",
        pv: 80,
        uv: 40,
      },
      {
        country_code: "US",
        region: null,
        city: null,
        pv: 20,
        uv: 10,
      },
    ]);

    expect(query).toHaveBeenCalledTimes(2);
  });

  it("UT-02: should preserve NULL location fields", async () => {
    const result = await getLocationStats(createOptions());

    expect(result.items[2]).toEqual({
      country_code: "US",
      region: null,
      city: null,
      pv: 20,
      uv: 10,
    });
  });

  it("UT-03: should return empty items when no location data exists", async () => {
    query
      .mockReset()
      .mockResolvedValueOnce({
        rows: [{ total: "0" }],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const result = await getLocationStats(createOptions());

    expect(result).toEqual({
      items: [],
      total: 0,
    });
  });

  it("UT-04: should sort by PV descending by default", async () => {
    await getLocationStats(createOptions());

    const sql = query.mock.calls[1][0] as string;

    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("pv DESC NULLS LAST");
    expect(query.mock.calls[1][1]).toEqual([
      siteId,
      start,
      end,
      10,
      0,
    ]);
  });

  it("UT-05: should support UV ascending sorting", async () => {
    await getLocationStats(
      createOptions({
        sortBy: "uv",
        sortOrder: "asc",
      }),
    );

    const sql = query.mock.calls[1][0] as string;

    expect(sql).toContain("uv ASC NULLS LAST");
  });

  it.each([
    ["country_code", "country_code DESC NULLS LAST"],
    ["region", "region ASC NULLS LAST"],
    ["city", "city DESC NULLS LAST"],
  ] as const)(
    "UT-06: should support sorting by %s",
    async (sortBy, expectedOrder) => {
      await getLocationStats(
        createOptions({
          sortBy,
          sortOrder: sortBy === "region" ? "asc" : "desc",
        }),
      );

      const sql = query.mock.calls[1][0] as string;

      expect(sql).toContain(expectedOrder);
    },
  );

  it("UT-07: should calculate pagination offset correctly", async () => {
    await getLocationStats(
      createOptions({
        page: 3,
        pageSize: 5,
      }),
    );

    expect(query.mock.calls[1][1]).toEqual([
      siteId,
      start,
      end,
      5,
      10,
    ]);
  });

  it("UT-08: should reject invalid date range", async () => {
    await expect(
      getLocationStats(
        createOptions({
          start: end,
          end: start,
        }),
      ),
    ).rejects.toThrow(
      "Location stats start must be earlier than end.",
    );

    expect(query).not.toHaveBeenCalled();
  });

  it("UT-09: should reject invalid pagination parameters", async () => {
    await expect(
      getLocationStats(createOptions({ page: 0 })),
    ).rejects.toThrow(
      "Page must be an integer greater than or equal to 1.",
    );

    await expect(
      getLocationStats(createOptions({ pageSize: 101 })),
    ).rejects.toThrow(
      "Page size must be an integer between 1 and 100.",
    );

    await expect(
      getLocationStats(createOptions({ pageSize: 0 })),
    ).rejects.toThrow(
      "Page size must be an integer between 1 and 100.",
    );

    expect(query).not.toHaveBeenCalled();
  });

  it("UT-10: should reject invalid sort field and sort order", async () => {
    await expect(
      getLocationStats(
        createOptions({
          sortBy: "invalid" as GetLocationStatsOptions["sortBy"],
        }),
      ),
    ).rejects.toThrow("Invalid location sort field.");

    await expect(
      getLocationStats(
        createOptions({
          sortOrder: "invalid" as GetLocationStatsOptions["sortOrder"],
        }),
      ),
    ).rejects.toThrow("Invalid location sort order.");

    expect(query).not.toHaveBeenCalled();
  });

  it("UT-11: should use parameterized SQL for site and date filters", async () => {
    await getLocationStats(createOptions());

    const countSql = query.mock.calls[0][0] as string;
    const statsSql = query.mock.calls[1][0] as string;

    expect(countSql).toContain("site_id = $1::uuid");
    expect(countSql).toContain("received_at >= $2::timestamptz");
    expect(countSql).toContain("received_at < $3::timestamptz");

    expect(statsSql).toContain("site_id = $1::uuid");
    expect(statsSql).toContain("received_at >= $2::timestamptz");
    expect(statsSql).toContain("received_at < $3::timestamptz");

    expect(statsSql).toContain("COUNT(DISTINCT visitor_id)");
    expect(statsSql).toContain("GROUP BY");
  });

  it("UT-12: should not execute SQL when validation fails", async () => {
    await expect(
      getLocationStats(
        createOptions({
          page: -1,
        }),
      ),
    ).rejects.toThrow();

    expect(query).not.toHaveBeenCalled();
  });
});

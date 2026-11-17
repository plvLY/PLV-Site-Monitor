
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getPageStats,
  type GetPageStatsOptions,
} from "../../../netlify/functions/_shared/analytics/pages-service";

describe("Pages Service", () => {
  const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";
  const start = new Date("2026-11-08T00:00:00.000Z");
  const end = new Date("2026-11-09T00:00:00.000Z");

  let query: ReturnType<typeof vi.fn>;

  function createOptions(
    overrides: Partial<GetPageStatsOptions> = {},
  ): GetPageStatsOptions {
    return {
      database: { query } as unknown as GetPageStatsOptions["database"],
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
        rows: [{ total: "2" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            page_path: "/",
            pv: "6",
            uv: "3",
            pv_share: "46.15",
          },
          {
            page_path: "/products",
            pv: "5",
            uv: "2",
            pv_share: "38.46",
          },
        ],
      });
  });

  it("UT-01: should return page statistics with correct number conversion", async () => {
    const result = await getPageStats(createOptions());

    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      {
        page_path: "/",
        pv: 6,
        uv: 3,
        pv_share: 46.15,
      },
      {
        page_path: "/products",
        pv: 5,
        uv: 2,
        pv_share: 38.46,
      },
    ]);

    expect(query).toHaveBeenCalledTimes(2);
  });

  it("UT-02: should return empty items when no page data exists", async () => {
    query
      .mockReset()
      .mockResolvedValueOnce({
        rows: [{ total: "0" }],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const result = await getPageStats(createOptions());

    expect(result).toEqual({
      items: [],
      total: 0,
    });
  });

  it("UT-03: should sort by PV descending by default", async () => {
    await getPageStats(createOptions());

    const sql = query.mock.calls[1][0] as string;

    expect(sql).toContain("ORDER BY pv DESC");
    expect(query.mock.calls[1][1]).toEqual([
      siteId,
      start,
      end,
      10,
      0,
    ]);
  });

  it("UT-04: should support custom sorting", async () => {
    await getPageStats(
      createOptions({
        sortBy: "uv",
        sortOrder: "asc",
      }),
    );

    const sql = query.mock.calls[1][0] as string;

    expect(sql).toContain("ORDER BY uv ASC");
  });

  it("UT-05: should calculate pagination offset correctly", async () => {
    await getPageStats(
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

  it("UT-06: should reject invalid date range", async () => {
    await expect(
      getPageStats(
        createOptions({
          start: end,
          end: start,
        }),
      ),
    ).rejects.toThrow(
      "Page stats start must be earlier than end.",
    );

    expect(query).not.toHaveBeenCalled();
  });

  it("UT-07: should reject invalid pagination parameters", async () => {
    await expect(
      getPageStats(createOptions({ page: 0 })),
    ).rejects.toThrow(
      "Page must be an integer greater than or equal to 1.",
    );

    await expect(
      getPageStats(createOptions({ pageSize: 101 })),
    ).rejects.toThrow(
      "Page size must be an integer between 1 and 100.",
    );

    await expect(
      getPageStats(createOptions({ pageSize: 0 })),
    ).rejects.toThrow(
      "Page size must be an integer between 1 and 100.",
    );

    expect(query).not.toHaveBeenCalled();
  });

  it("UT-08: should reject invalid sort field and sort order", async () => {
    await expect(
      getPageStats(
        createOptions({
          sortBy: "invalid" as GetPageStatsOptions["sortBy"],
        }),
      ),
    ).rejects.toThrow("Invalid page sort field.");

    await expect(
      getPageStats(
        createOptions({
          sortOrder: "invalid" as GetPageStatsOptions["sortOrder"],
        }),
      ),
    ).rejects.toThrow("Invalid page sort order.");

    expect(query).not.toHaveBeenCalled();
  });
});

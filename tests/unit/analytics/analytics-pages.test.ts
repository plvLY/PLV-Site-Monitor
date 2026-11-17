
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";
import { createPagesHandler } from "../../../netlify/functions/analytics-pages.mts";

const mocks = vi.hoisted(() => ({
  parseDateRange: vi.fn(),
  getPageStats: vi.fn(),
}));

vi.mock("../../../netlify/functions/_shared/analytics/date-range.js", () => ({
  parseDateRange: mocks.parseDateRange,
}));

vi.mock("../../../netlify/functions/_shared/analytics/pages-service.js", () => ({
  getPageStats: mocks.getPageStats,
}));

function createMockDatabase(
  rows: unknown[] = [{ id: siteId, timezone: "America/Los_Angeles" }],
) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pick<Pool, "query">;
}

function createRequest(
  query = "site_id=" + siteId,
  method = "GET",
): Request {
  return new Request(
    `http://localhost/api/analytics/pages?${query}`,
    { method },
  );
}

interface PagesSuccessBody {
  success: true;
  data: {
    items: unknown[];
  };
  meta: Record<string, unknown>;
}

interface PagesErrorBody {
  success: boolean;
  error: {
    code: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readSuccessJson(
  response: Response,
): Promise<PagesSuccessBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    !Array.isArray(body.data.items) ||
    !isRecord(body.meta)
  ) {
    throw new Error("Invalid pages success response");
  }

  return {
    success: true,
    data: {
      items: body.data.items,
    },
    meta: body.meta,
  };
}

async function readErrorJson(
  response: Response,
): Promise<PagesErrorBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    typeof body.success !== "boolean" ||
    !isRecord(body.error) ||
    typeof body.error.code !== "string"
  ) {
    throw new Error("Invalid pages error response");
  }

  return {
    success: body.success,
    error: {
      code: body.error.code,
    },
  };
}

const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";

const dateRange = {
  range: "7d",
  start: new Date("2026-11-02T07:00:00.000Z"),
  end: new Date("2026-11-09T08:00:00.000Z"),
  startIso: "2026-11-02T00:00:00-07:00",
  endIso: "2026-11-09T00:00:00-08:00",
  timeZone: "America/Los_Angeles",
};

const pageStatsResult = {
  items: [
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
  ],
  total: 3,
};

describe("createPagesHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.parseDateRange.mockReturnValue(dateRange);
    mocks.getPageStats.mockResolvedValue(pageStatsResult);
  });

  function createHandler(options?: {
    rows?: unknown[];
    authorization?: {
      requireSiteAccess: (siteId: string) => Promise<void> | void;
    };
  }) {
    const database = createMockDatabase(options?.rows);
    const authorization = options?.authorization ?? {
      requireSiteAccess: vi.fn(
        async (_siteId: string): Promise<void> => undefined,
      ),
    };

    const handler = createPagesHandler({
      database,
      resolveAuthorization: async () => authorization,
    });

    return {
      handler,
      database,
      authorization,
    };
  }

  it("UT-01 should return page statistics successfully", async () => {
    const { handler } = createHandler();

    const response = await handler(createRequest());
    const body = await readSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual(pageStatsResult.items);
    expect(body.meta).toMatchObject({
      site_id: siteId,
      range: "7d",
      timezone: "America/Los_Angeles",
      page: 1,
      page_size: 10,
      total: 3,
      total_pages: 1,
      sort_by: "pv",
      sort_order: "desc",
    });
  });

  it("UT-02 should reject non-GET requests", async () => {
    const { handler } = createHandler();

    const response = await handler(createRequest("", "POST"));
    const body = await readErrorJson(response);

    expect(response.status).toBe(405);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("UT-03 should reject missing or invalid site_id", async () => {
    const { handler, database } = createHandler();

    const missingResponse = await handler(createRequest(""));
    const invalidResponse = await handler(
      createRequest("site_id=invalid"),
    );

    expect((await readErrorJson(missingResponse)).error.code).toBe(
      "INVALID_QUERY",
    );
    expect((await readErrorJson(invalidResponse)).error.code).toBe(
      "INVALID_QUERY",
    );

    expect(database.query).not.toHaveBeenCalled();
  });

  it("UT-04 should reject unknown and repeated query parameters", async () => {
    const { handler } = createHandler();

    const unknownResponse = await handler(
      createRequest(`site_id=${siteId}&unknown=value`),
    );

    const duplicateResponse = await handler(
      createRequest(`site_id=${siteId}&page=1&page=2`),
    );

    expect((await readErrorJson(unknownResponse)).error.code).toBe(
      "INVALID_QUERY",
    );
    expect((await readErrorJson(duplicateResponse)).error.code).toBe(
      "INVALID_QUERY",
    );
  });

  it("UT-05 should use default pagination and sorting", async () => {
    const { handler } = createHandler();

    await handler(createRequest());

    expect(mocks.getPageStats).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId,
        page: 1,
        pageSize: 10,
        sortBy: "pv",
        sortOrder: "desc",
      }),
    );
  });

  it("UT-06 should parse custom pagination and sorting parameters", async () => {
    const { handler } = createHandler();

    await handler(
      createRequest(
        `site_id=${siteId}&page=2&page_size=20&sort_by=uv&sort_order=asc`,
      ),
    );

    expect(mocks.getPageStats).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 20,
        sortBy: "uv",
        sortOrder: "asc",
      }),
    );
  });

  it("UT-07 should reject invalid page values", async () => {
    const { handler } = createHandler();

    const cases = ["0", "-1", "1.5", "abc", ""];

    for (const value of cases) {
      const response = await handler(
        createRequest(`site_id=${siteId}&page=${encodeURIComponent(value)}`),
      );

      expect((await readErrorJson(response)).error.code).toBe("INVALID_QUERY");
    }
  });

  it("UT-08 should reject invalid page_size values", async () => {
    const { handler } = createHandler();

    const cases = ["0", "-1", "1.5", "abc", "101"];

    for (const value of cases) {
      const response = await handler(
        createRequest(`site_id=${siteId}&page_size=${encodeURIComponent(value)}`),
      );

      expect((await readErrorJson(response)).error.code).toBe("INVALID_QUERY");
    }
  });

  it("UT-09 should reject unsupported sort_by", async () => {
    const { handler } = createHandler();

    const response = await handler(
      createRequest(`site_id=${siteId}&sort_by=created_at`),
    );

    expect((await readErrorJson(response)).error.code).toBe("INVALID_QUERY");
    expect(mocks.getPageStats).not.toHaveBeenCalled();
  });

  it("UT-10 should reject unsupported sort_order", async () => {
    const { handler } = createHandler();

    const response = await handler(
      createRequest(`site_id=${siteId}&sort_order=random`),
    );

    expect((await readErrorJson(response)).error.code).toBe("INVALID_QUERY");
    expect(mocks.getPageStats).not.toHaveBeenCalled();
  });

  it("UT-11 should require start and end for custom range", async () => {
    const { handler } = createHandler();

    const response = await handler(
      createRequest(`site_id=${siteId}&range=custom&start=2026-11-01`),
    );

    expect((await readErrorJson(response)).error.code).toBe(
      "INVALID_DATE_RANGE",
    );
    expect(mocks.parseDateRange).not.toHaveBeenCalled();
  });

  it("UT-12 should reject start and end outside custom range", async () => {
    const { handler } = createHandler();

    const response = await handler(
      createRequest(
        `site_id=${siteId}&range=7d&start=2026-11-01&end=2026-11-08`,
      ),
    );

    expect((await readErrorJson(response)).error.code).toBe("INVALID_QUERY");
    expect(mocks.parseDateRange).not.toHaveBeenCalled();
  });

  it("UT-13 should authorize before querying site data", async () => {
    const authorization = {
      requireSiteAccess: vi.fn(
        async (_siteId: string): Promise<void> => {
          throw new AnalyticsError(
            "UNAUTHORIZED",
            "Authentication required.",
          );
        },
      ),
    };

    const { handler, database } = createHandler({ authorization });

    const response = await handler(createRequest());
    const body = await readErrorJson(response);

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(authorization.requireSiteAccess).toHaveBeenCalledWith(siteId);
    expect(database.query).not.toHaveBeenCalled();
    expect(mocks.getPageStats).not.toHaveBeenCalled();
  });

  it("UT-14 should return SITE_NOT_FOUND when site does not exist", async () => {
    const { handler } = createHandler({ rows: [] });

    const response = await handler(createRequest());
    const body = await readErrorJson(response);

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
    expect(mocks.getPageStats).not.toHaveBeenCalled();
  });

  it("UT-15 should parse date range using the site's timezone", async () => {
    const { handler } = createHandler();

    await handler(createRequest());

    expect(mocks.parseDateRange).toHaveBeenCalledWith({
      range: "7d",
      start: undefined,
      end: undefined,
      timeZone: "America/Los_Angeles",
    });
  });

  it("UT-16 should pass date range and query options to Pages Service", async () => {
    const { handler } = createHandler();

    await handler(
      createRequest(
        `site_id=${siteId}&range=custom&start=2026-11-01&end=2026-11-08&page=2&page_size=5&sort_by=pv_share&sort_order=asc`,
      ),
    );

    expect(mocks.getPageStats).toHaveBeenCalledWith({
      database: expect.anything(),
      siteId,
      start: dateRange.start,
      end: dateRange.end,
      page: 2,
      pageSize: 5,
      sortBy: "pv_share",
      sortOrder: "asc",
    });
  });

  it("UT-17 should return INTERNAL_ERROR for unexpected errors", async () => {
    mocks.getPageStats.mockRejectedValue(new Error("Database unavailable"));

    const { handler } = createHandler();

    const response = await handler(createRequest());
    const body = await readErrorJson(response);

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("UT-18 should return zero total_pages when there are no results", async () => {
    mocks.getPageStats.mockResolvedValue({
      items: [],
      total: 0,
    });

    const { handler } = createHandler();

    const response = await handler(createRequest());
    const body = await readSuccessJson(response);

    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([]);
    expect(body.meta.total).toBe(0);
    expect(body.meta.total_pages).toBe(0);
  });
});

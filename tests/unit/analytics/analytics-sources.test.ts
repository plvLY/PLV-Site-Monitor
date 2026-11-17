import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";
import { createSourcesHandler } from "../../../netlify/functions/analytics-sources.mts";

const mocks = vi.hoisted(() => ({
  parseDateRange: vi.fn(),
  getSourcesStats: vi.fn(),
}));

vi.mock("../../../netlify/functions/_shared/analytics/date-range.js", () => ({
  parseDateRange: mocks.parseDateRange,
}));

vi.mock("../../../netlify/functions/_shared/analytics/sources-service.js", () => ({
  getSourcesStats: mocks.getSourcesStats,
}));

const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";

const dateRange = {
  range: "7d",
  start: new Date("2026-11-02T07:00:00.000Z"),
  end: new Date("2026-11-09T08:00:00.000Z"),
  startIso: "2026-11-02T00:00:00-07:00",
  endIso: "2026-11-09T00:00:00-08:00",
  timeZone: "America/Los_Angeles",
};

const sourcesStatsResult = {
  referrer_host: {
    items: [
      { source: null, pv: 6, uv: 3 },
      { source: "localhost", pv: 5, uv: 1 },
      { source: "google.com", pv: 2, uv: 1 },
    ],
    total: 3,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  },
  utm_source: {
    items: [
      { source: null, pv: 11, uv: 3 },
      { source: "google", pv: 2, uv: 1 },
    ],
    total: 2,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  },
  utm_medium: {
    items: [
      { source: null, pv: 11, uv: 3 },
      { source: "organic", pv: 2, uv: 1 },
    ],
    total: 2,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  },
  utm_campaign: {
    items: [
      { source: null, pv: 13, uv: 4 },
    ],
    total: 1,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  },
};

function createMockDatabase(
  rows: unknown[] = [{ id: siteId, timezone: "America/Los_Angeles" }],
) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pick<Pool, "query">;
}

function createRequest(
  query = `site_id=${siteId}`,
  method = "GET",
): Request {
  return new Request(
    `http://localhost/api/analytics/sources?${query}`,
    { method },
  );
}


type SourceDimension =
  | "referrer_host"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign";

interface SourcesSuccessBody {
  success: true;
  data: Record<
    SourceDimension,
    {
      items: unknown[];
    }
  >;
  meta: Record<
    SourceDimension,
    Record<string, unknown>
  >;
}

interface SourcesErrorBody {
  success: false;
  error: {
    code: string;
  };
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

const sourceDimensions: SourceDimension[] = [
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
];

async function readSuccessJson(
  response: Response,
): Promise<SourcesSuccessBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    !isRecord(body.meta)
  ) {
    throw new Error("Invalid sources success response");
  }

  for (const dimension of sourceDimensions) {
    const data = body.data[dimension];
    const meta = body.meta[dimension];

    if (
      !isRecord(data) ||
      !Array.isArray(data.items) ||
      !isRecord(meta)
    ) {
      throw new Error(
        `Invalid sources response dimension: ${dimension}`,
      );
    }
  }

  return {
    success: true,
    data: body.data as SourcesSuccessBody["data"],
    meta: body.meta as SourcesSuccessBody["meta"],
  };
}

async function readErrorJson(
  response: Response,
): Promise<SourcesErrorBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== false ||
    !isRecord(body.error) ||
    typeof body.error.code !== "string"
  ) {
    throw new Error("Invalid sources error response");
  }

  return {
    success: false,
    error: {
      code: body.error.code,
    },
  };
}


describe("createSourcesHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.parseDateRange.mockReturnValue(dateRange);
    mocks.getSourcesStats.mockResolvedValue(sourcesStatsResult);
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

    const handler = createSourcesHandler({
      database,
      resolveAuthorization: async () => authorization,
    });

    return {
      handler,
      database,
      authorization,
    };
  }

  it("UT-01 should return all four source dimensions", async () => {
    const { handler } = createHandler();

    const response = await handler(createRequest());
    const body = await readSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.referrer_host.items).toEqual(
      sourcesStatsResult.referrer_host.items,
    );
    expect(body.data.utm_source.items).toEqual(
      sourcesStatsResult.utm_source.items,
    );
    expect(body.data.utm_medium.items).toEqual(
      sourcesStatsResult.utm_medium.items,
    );
    expect(body.data.utm_campaign.items).toEqual(
      sourcesStatsResult.utm_campaign.items,
    );
  });

  it("UT-02 should preserve NULL source values", async () => {
    const { handler } = createHandler();

    const response = await handler(createRequest());
    const body = await readSuccessJson(response);

    expect(body.data.referrer_host.items[0]).toEqual({
      source: null,
      pv: 6,
      uv: 3,
    });

    const campaignItem = body.data.utm_campaign.items[0];

    expect(
      isRecord(campaignItem) ? campaignItem.source : undefined,
    ).toBeNull();
  });

  it("UT-03 should return independent pagination metadata", async () => {
    const { handler } = createHandler();

    const response = await handler(createRequest());
    const body = await readSuccessJson(response);

    expect(body.meta.referrer_host).toEqual({
      page: 1,
      page_size: 10,
      total: 3,
      total_pages: 1,
    });

    expect(body.meta.utm_source).toEqual({
      page: 1,
      page_size: 10,
      total: 2,
      total_pages: 1,
    });

    expect(body.meta.utm_medium).toEqual({
      page: 1,
      page_size: 10,
      total: 2,
      total_pages: 1,
    });

    expect(body.meta.utm_campaign).toEqual({
      page: 1,
      page_size: 10,
      total: 1,
      total_pages: 1,
    });
  });

  it("UT-04 should reject non-GET requests", async () => {
    const { handler } = createHandler();

    const response = await handler(createRequest("", "POST"));
    const body = await readErrorJson(response);

    expect(response.status).toBe(405);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("UT-05 should reject missing or invalid site_id", async () => {
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

  it("UT-06 should reject unknown and repeated parameters", async () => {
    const { handler } = createHandler();

    const unknownResponse = await handler(
      createRequest(`site_id=${siteId}&unknown=value`),
    );

    const duplicateResponse = await handler(
      createRequest(`site_id=${siteId}&referrer_host_page=1&referrer_host_page=2`),
    );

    expect((await readErrorJson(unknownResponse)).error.code).toBe(
      "INVALID_QUERY",
    );
    expect((await readErrorJson(duplicateResponse)).error.code).toBe(
      "INVALID_QUERY",
    );
  });

  it("UT-07 should use default pagination for all dimensions", async () => {
    const { handler } = createHandler();

    await handler(createRequest());

    expect(mocks.getSourcesStats).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId,
        pagination: {
          referrer_host: { page: 1, pageSize: 10 },
          utm_source: { page: 1, pageSize: 10 },
          utm_medium: { page: 1, pageSize: 10 },
          utm_campaign: { page: 1, pageSize: 10 },
        },
      }),
    );
  });

  it("UT-08 should parse independent pagination parameters", async () => {
    const { handler } = createHandler();

    await handler(
      createRequest(
        [
          `site_id=${siteId}`,
          "referrer_host_page=2",
          "referrer_host_page_size=20",
          "utm_source_page=3",
          "utm_source_page_size=30",
          "utm_medium_page=4",
          "utm_medium_page_size=40",
          "utm_campaign_page=5",
          "utm_campaign_page_size=50",
        ].join("&"),
      ),
    );

    expect(mocks.getSourcesStats).toHaveBeenCalledWith(
      expect.objectContaining({
        pagination: {
          referrer_host: { page: 2, pageSize: 20 },
          utm_source: { page: 3, pageSize: 30 },
          utm_medium: { page: 4, pageSize: 40 },
          utm_campaign: { page: 5, pageSize: 50 },
        },
      }),
    );
  });

  it("UT-09 should reject invalid page values", async () => {
    const { handler } = createHandler();

    const cases = ["0", "-1", "1.5", "abc", ""];

    for (const value of cases) {
      const response = await handler(
        createRequest(
          `site_id=${siteId}&utm_source_page=${encodeURIComponent(value)}`,
        ),
      );

      expect((await readErrorJson(response)).error.code).toBe("INVALID_QUERY");
    }

    expect(mocks.getSourcesStats).not.toHaveBeenCalled();
  });

  it("UT-10 should reject invalid page_size values", async () => {
    const { handler } = createHandler();

    const cases = ["0", "-1", "1.5", "abc", "101"];

    for (const value of cases) {
      const response = await handler(
        createRequest(
          `site_id=${siteId}&utm_medium_page_size=${encodeURIComponent(value)}`,
        ),
      );

      expect((await readErrorJson(response)).error.code).toBe("INVALID_QUERY");
    }

    expect(mocks.getSourcesStats).not.toHaveBeenCalled();
  });

  it("UT-11 should reject custom range without start and end", async () => {
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
    expect(mocks.getSourcesStats).not.toHaveBeenCalled();
  });

  it("UT-14 should return SITE_NOT_FOUND when site does not exist", async () => {
    const { handler } = createHandler({ rows: [] });

    const response = await handler(createRequest());
    const body = await readErrorJson(response);

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
    expect(mocks.getSourcesStats).not.toHaveBeenCalled();
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

  it("UT-16 should pass date range and pagination to Sources Service", async () => {
    const { handler } = createHandler();

    await handler(
      createRequest(
        `site_id=${siteId}&range=custom&start=2026-11-01&end=2026-11-08&referrer_host_page=2&utm_campaign_page_size=5`,
      ),
    );

    expect(mocks.getSourcesStats).toHaveBeenCalledWith({
      database: expect.anything(),
      siteId,
      start: dateRange.start,
      end: dateRange.end,
      pagination: {
        referrer_host: { page: 2, pageSize: 10 },
        utm_source: { page: 1, pageSize: 10 },
        utm_medium: { page: 1, pageSize: 10 },
        utm_campaign: { page: 1, pageSize: 5 },
      },
    });
  });

  it("UT-17 should return INTERNAL_ERROR for unexpected errors", async () => {
    mocks.getSourcesStats.mockRejectedValue(
      new Error("Database unavailable"),
    );

    const { handler } = createHandler();

    const response = await handler(createRequest());
    const body = await readErrorJson(response);

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("UT-18 should return zero total_pages for empty dimensions", async () => {
    mocks.getSourcesStats.mockResolvedValue({
      referrer_host: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      },
      utm_source: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      },
      utm_medium: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      },
      utm_campaign: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      },
    });

    const { handler } = createHandler();

    const response = await handler(createRequest());
    const body = await readSuccessJson(response);

    expect(body.success).toBe(true);

    for (const dimension of [
      "referrer_host",
      "utm_source",
      "utm_medium",
      "utm_campaign",] as const) {
      expect(body.data[dimension].items).toEqual([]);
      expect(body.meta[dimension].total).toBe(0);
      expect(body.meta[dimension].total_pages).toBe(0);
    }
  });
});
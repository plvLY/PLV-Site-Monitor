
import { describe, it, expect, vi } from "vitest";

import {
  createTrendsHandler,
} from "../../../netlify/functions/analytics-trends.mts";

import {
  Authorization,
} from "../../../netlify/functions/_shared/analytics/authorization";


interface TrendsErrorBody {
  success: false;
  error: {
    code: string;
  };
}

interface TrendsSuccessBody {
  success: true;
  data: Record<string, unknown>;
  meta: {
    site_id: string;
    timezone: string;
    range: string;
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

async function readTrendsErrorJson(
  response: Response,
): Promise<TrendsErrorBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== false ||
    !isRecord(body.error) ||
    typeof body.error.code !== "string"
  ) {
    throw new Error("Invalid trends error response");
  }

  return {
    success: false,
    error: {
      code: body.error.code,
    },
  };
}

async function readTrendsSuccessJson(
  response: Response,
): Promise<TrendsSuccessBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    !isRecord(body.meta) ||
    typeof body.meta.site_id !== "string" ||
    typeof body.meta.timezone !== "string" ||
    typeof body.meta.range !== "string"
  ) {
    throw new Error("Invalid trends success response");
  }

  return {
    success: true,
    data: body.data,
    meta: {
      site_id: body.meta.site_id,
      timezone: body.meta.timezone,
      range: body.meta.range,
    },
  };
}
function createMockDatabase(
  site: { id: string; timezone: string } | null = {
    id: "accb07ee-6504-4855-b25b-4a5bf22d8164",
    timezone: "UTC",
  },
) {
  const query = vi.fn();

  query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM sites")) {
      return {
        rows: site ? [site] : [],
      };
    }

    return {
      rows: [
        {
          bucket_start_utc: new Date("2026-11-08T00:00:00.000Z"),
          local_date: "2026-11-08T00:00:00",
          offset_minutes: 0,
          date: "2026-11-08",
          pv: "7",
          uv: "3",
        },
      ],
    };
  });

  return { query };
}

function createRequest(query = "") {
  return new Request(
    `http://localhost/api/analytics/trends${query}`,
    { method: "GET" },
  );
}

function createAllowedAuthorization() {
  return {
    requireSiteAccess: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Analytics Trends Handler", () => {
  const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";

  it("should reject unauthenticated requests with 401", async () => {
    const database = createMockDatabase();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => new Authorization(),
    });

    const response = await handler(
      createRequest(`?site_id=${siteId}&range=7d`),
    );

    const body = await readTrendsErrorJson(response);

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(database.query).not.toHaveBeenCalled();
  });

  it("should reject invalid site_id", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest("?site_id=invalid&range=7d"),
    );

    const body = await readTrendsErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(authorization.requireSiteAccess).not.toHaveBeenCalled();
  });

  it("should reject duplicate query parameters", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(`?site_id=${siteId}&site_id=${siteId}`),
    );

    const body = await readTrendsErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(database.query).not.toHaveBeenCalled();
  });

  it("should reject start and end without range=custom", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&start=2026-11-01&end=2026-11-08`,
      ),
    );

    const body = await readTrendsErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(database.query).not.toHaveBeenCalled();
  });

  it("should reject custom range without start or end", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(`?site_id=${siteId}&range=custom&start=2026-11-01`),
    );

    const body = await readTrendsErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_DATE_RANGE");
    expect(database.query).not.toHaveBeenCalled();
  });

  it("should return SITE_NOT_FOUND for a missing site", async () => {
    const database = createMockDatabase(null);
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(`?site_id=${siteId}&range=7d`),
    );

    const body = await readTrendsErrorJson(response);

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it("should return daily trend data for a 7d range", async () => {
    const database = createMockDatabase({
      id: siteId,
      timezone: "Asia/Shanghai",
    });

    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=custom&start=2026-11-01&end=2026-11-08`,
      ),
    );

    const body = await readTrendsSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.granularity).toBe("day");
    expect(body.data.items).toEqual([
      {
        date: "2026-11-08",
        pv: 7,
        uv: 3,
      },
    ]);

    expect(body.meta.site_id).toBe(siteId);
    expect(body.meta.timezone).toBe("Asia/Shanghai");
    expect(body.meta.range).toBe("custom");

    expect(authorization.requireSiteAccess).toHaveBeenCalledWith(siteId);
    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it("should use hourly granularity for custom range of exactly 48 hours", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=custom&start=2026-11-01T00:00:00Z&end=2026-11-03T00:00:00Z`,
      ),
    );

    const body = await readTrendsSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.granularity).toBe("hour");

    // Site query + hourly trend query
    expect(database.query).toHaveBeenCalledTimes(2);

    const trendQuery = database.query.mock.calls[1][0] as string;
    expect(trendQuery).toContain("generate_series");
    expect(trendQuery).toContain("AT TIME ZONE 'UTC'");
  });

  it("should use daily granularity for custom range longer than 48 hours", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=custom&start=2026-11-01T00:00:00Z&end=2026-11-03T00:00:00.001Z`,
      ),
    );

    const body = await readTrendsSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.granularity).toBe("day");

    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it("should reject unsupported HTTP methods", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      new Request("http://localhost/api/analytics/trends", {
        method: "POST",
      }),
    );

    const body = await readTrendsErrorJson(response);

    expect(response.status).toBe(405);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(database.query).not.toHaveBeenCalled();
  });

  it("should reject unknown query parameters", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createTrendsHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=7d&timezone=UTC`,
      ),
    );

    const body = await readTrendsErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(database.query).not.toHaveBeenCalled();
  });
});

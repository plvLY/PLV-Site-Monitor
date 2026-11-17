import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  createDevicesHandler,
} from "../../../netlify/functions/analytics-devices.mts";

const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";
interface DevicesSuccessBody {
  success: true;
  data: {
    browser: { items: unknown[] };
    os: { items: unknown[] };
  };
  meta: {
    browser: Record<string, unknown>;
    os: Record<string, unknown>;
    range?: string;
    timezone?: string;
  };
}

interface DevicesErrorBody {
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
): Promise<DevicesSuccessBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    !isRecord(body.data.browser) ||
    !Array.isArray(body.data.browser.items) ||
    !isRecord(body.data.os) ||
    !Array.isArray(body.data.os.items) ||
    !isRecord(body.meta) ||
    !isRecord(body.meta.browser) ||
    !isRecord(body.meta.os) ||
    (body.meta.range !== undefined && typeof body.meta.range !== "string") ||
    (body.meta.timezone !== undefined &&
      typeof body.meta.timezone !== "string")
  ) {
    throw new Error("Invalid devices success response");
  }

  return {
    success: true,
    data: {
      browser: { items: body.data.browser.items },
      os: { items: body.data.os.items },
    },
    meta: {
      browser: body.meta.browser,
      os: body.meta.os,
      ...(typeof body.meta.range === "string"
        ? { range: body.meta.range }
        : {}),
      ...(typeof body.meta.timezone === "string"
        ? { timezone: body.meta.timezone }
        : {}),
    },
  };
}

async function readErrorJson(
  response: Response,
): Promise<DevicesErrorBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    typeof body.success !== "boolean" ||
    !isRecord(body.error) ||
    typeof body.error.code !== "string"
  ) {
    throw new Error("Invalid devices error response");
  }

  return {
    success: body.success,
    error: {
      code: body.error.code,
    },
  };
}

function createRequest(query: string) {
  return new Request(
    `http://localhost/api/analytics/devices${query}`,
    { method: "GET" },
  );
}

function createDependencies() {
  const mockQuery = vi.fn(async (query: string) => {
    if (query.includes("FROM sites")) {
      return {
        rows: [{
          id: siteId,
          timezone: "UTC",
        }],
      };
    }

    if (query.includes("AS total")) {
      return {
        rows: [{ total: "1" }],
      };
    }

    if (query.includes("AS device")) {
      if (query.includes("GROUP BY browser")) {
        return {
          rows: [
            { device: "Chrome", pv: "9", uv: "1" },
          ],
        };
      }

      return {
        rows: [
          { device: "Windows", pv: "12", uv: "4" },
        ],
      };
    }

    throw new Error("Unexpected SQL");
  });

  const database = {
    query: mockQuery,
  } as unknown as Pick<Pool, "query">;
  const authorization = {
    requireSiteAccess: vi.fn(
      async (_siteId: string): Promise<void> => undefined,
    ),
  };

  return {
    database,
    mockQuery,
    authorization,
    handler: createDevicesHandler({
      database,
      resolveAuthorization: async () => authorization,
    }),
  };
}

describe("Devices Handler", () => {
  it("should return browser and OS statistics", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=7d`,
      ),
    );

    const body = await readSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.browser.items).toEqual([
      { device: "Chrome", pv: 9, uv: 1 },
    ]);

    expect(body.data.os.items).toEqual([
      { device: "Windows", pv: 12, uv: 4 },
    ]);

    expect(body.meta.browser).toMatchObject({
      page: 1,
      page_size: 10,
      total: 1,
      total_pages: 1,
    });

    expect(body.meta.os).toMatchObject({
      page: 1,
      page_size: 10,
      total: 1,
      total_pages: 1,
    });
  });

  it("should support independent pagination", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=7d&browser_page=2&browser_page_size=1&os_page=1&os_page_size=5`,
      ),
    );

    const body = await readSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.meta.browser).toMatchObject({
      page: 2,
      page_size: 1,
    });

    expect(body.meta.os).toMatchObject({
      page: 1,
      page_size: 5,
    });
  });

  it("should parse custom date range", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=custom&start=2026-11-05&end=2026-11-09`,
      ),
    );

    const body = await readSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.meta.range).toBe("custom");
    expect(body.meta.timezone).toBe("UTC");
  });

  it("should reject invalid site_id", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      createRequest("?site_id=invalid&range=7d"),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("should reject unknown query parameters", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      createRequest(`?site_id=${siteId}&range=7d&unknown=1`),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("should reject repeated query parameters", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&site_id=${siteId}&range=7d`,
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("should reject page_size greater than 100", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=7d&browser_page_size=101`,
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("should reject custom range without start and end", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=custom`,
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_DATE_RANGE");
  });

  it("should return SITE_NOT_FOUND", async () => {
    const { handler } = createDependencies();

    const dependencies = createDependencies();
    dependencies.mockQuery.mockResolvedValueOnce({
      rows: [],
    });

    const response = await dependencies.handler(
      createRequest(
        `?site_id=${siteId}&range=7d`,
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
  });

  it("should reject unauthorized requests before querying site data", async () => {
    const { handler, authorization, database } = createDependencies();

    authorization.requireSiteAccess.mockRejectedValueOnce(
      new Error("Unauthorized"),
    );

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=7d`,
      ),
    );

    const body = await readErrorJson(response);

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");

    expect(database.query).not.toHaveBeenCalled();
  });

  it("should reject non-GET requests", async () => {
    const { handler } = createDependencies();

    const response = await handler(
      new Request(
        `http://localhost/api/analytics/devices?site_id=${siteId}`,
        { method: "POST" },
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(405);
    expect(body.error.code).toBe("INVALID_QUERY");
  });
});

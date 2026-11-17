import { describe, it, expect, vi } from "vitest";
import {
  createOverviewHandler,
} from "../../../netlify/functions/analytics-overview.mts";
import {
  Authorization,
} from "../../../netlify/functions/_shared/analytics/authorization";
import {
  AnalyticsError,
} from "../../../netlify/functions/_shared/analytics/errors";


interface OverviewErrorBody {
  success: false;
  error: {
    code: string;
  };
}

interface OverviewSuccessBody {
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

async function readOverviewErrorJson(
  response: Response,
): Promise<OverviewErrorBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== false ||
    !isRecord(body.error) ||
    typeof body.error.code !== "string"
  ) {
    throw new Error("Invalid overview error response");
  }

  return {
    success: false,
    error: {
      code: body.error.code,
    },
  };
}

async function readOverviewSuccessJson(
  response: Response,
): Promise<OverviewSuccessBody> {
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
    throw new Error("Invalid overview success response");
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
      return { rows: site ? [site] : [] };
    }

    return {
      rows: [
        {
          pv: "13",
          uv: "4",
          sessions: "5",
          bounce_sessions: "2",
        },
      ],
    };
  });

  return {
    query,
  };
}

function createRequest(query = "") {
  return new Request(
    `http://localhost/api/analytics/overview${query}`,
    { method: "GET" },
  );
}

function createAllowedAuthorization() {
  return {
    requireSiteAccess: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Analytics Overview Handler", () => {
  const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";

  it("should reject unauthenticated requests with 401", async () => {
    const database = createMockDatabase();
    const handler = createOverviewHandler({
      database: database as never,
      resolveAuthorization: async () => new Authorization(),
    });

    const response = await handler(
      createRequest(`?site_id=${siteId}&range=7d`),
    );

    const body = await readOverviewErrorJson(response);

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(database.query).not.toHaveBeenCalled();
  });

  it("should reject invalid site_id", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createOverviewHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest("?site_id=invalid&range=7d"),
    );

    const body = await readOverviewErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(authorization.requireSiteAccess).not.toHaveBeenCalled();
  });

  it("should reject duplicate query parameters", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createOverviewHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(`?site_id=${siteId}&site_id=${siteId}`),
    );

    const body = await readOverviewErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("should reject start and end without range=custom", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createOverviewHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&start=2026-11-01&end=2026-11-08`,
      ),
    );

    const body = await readOverviewErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("should return SITE_NOT_FOUND for a missing site", async () => {
    const database = createMockDatabase(null);
    const authorization = createAllowedAuthorization();

    const handler = createOverviewHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(`?site_id=${siteId}&range=7d`),
    );

    const body = await readOverviewErrorJson(response);

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it("should return overview data and site timezone metadata", async () => {
    const database = createMockDatabase({
      id: siteId,
      timezone: "Asia/Shanghai",
    });

    const authorization = createAllowedAuthorization();

    const handler = createOverviewHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(
        `?site_id=${siteId}&range=custom&start=2026-11-01&end=2026-11-08`,
      ),
    );

    const body = await readOverviewSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data).toEqual({
      pv: 13,
      uv: 4,
      sessions: 5,
      bounce_sessions: 2,
      bounce_rate: 40,
    });

    expect(body.meta.site_id).toBe(siteId);
    expect(body.meta.timezone).toBe("Asia/Shanghai");
    expect(body.meta.range).toBe("custom");

    expect(authorization.requireSiteAccess).toHaveBeenCalledWith(siteId);
    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it("should reject unsupported HTTP methods", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createOverviewHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      new Request("http://localhost/api/analytics/overview", {
        method: "POST",
      }),
    );

    const body = await readOverviewErrorJson(response);

    expect(response.status).toBe(405);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(database.query).not.toHaveBeenCalled();
  });

  it("should reject unknown query parameters", async () => {
    const database = createMockDatabase();
    const authorization = createAllowedAuthorization();

    const handler = createOverviewHandler({
      database: database as never,
      resolveAuthorization: async () => authorization,
    });

    const response = await handler(
      createRequest(`?site_id=${siteId}&range=7d&timezone=UTC`),
    );

    const body = await readOverviewErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
  });
});
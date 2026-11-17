import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";

import { pool } from "../../db/client";

import {
  createOverviewHandler,
} from "../../netlify/functions/analytics-overview.mts";

import {
  createTrendsHandler,
} from "../../netlify/functions/analytics-trends.mts";

import {
  createPagesHandler,
} from "../../netlify/functions/analytics-pages.mts";

import {
  createLocationsHandler,
} from "../../netlify/functions/analytics-locations.mts";

import {
  createSourcesHandler,
} from "../../netlify/functions/analytics-sources.mts";

import {
  createDevicesHandler,
} from "../../netlify/functions/analytics-devices.mts";

const siteA = "accb07ee-6504-4855-b25b-4a5bf22d8164";
const siteB = "c77de8cc-d44f-475c-b68c-32975934b0d1";

const start = "2026-11-05";
const end = "2026-11-09";

const authorization = {
  requireSiteAccess: vi.fn(
    async (_siteId: string): Promise<void> => undefined,
  ),
};

// 六个 Handler 全部使用真实 PostgreSQL 连接池。
const handlers = {
  "/api/analytics/overview": createOverviewHandler({
    database: pool,
    resolveAuthorization: async () => authorization,
  }),

  "/api/analytics/trends": createTrendsHandler({
    database: pool,
    resolveAuthorization: async () => authorization,
  }),

  "/api/analytics/pages": createPagesHandler({
    database: pool,
    resolveAuthorization: async () => authorization,
  }),

  "/api/analytics/locations": createLocationsHandler({
    database: pool,
    resolveAuthorization: async () => authorization,
  }),

  "/api/analytics/sources": createSourcesHandler({
    database: pool,
    resolveAuthorization: async () => authorization,
  }),

  "/api/analytics/devices": createDevicesHandler({
    database: pool,
    resolveAuthorization: async () => authorization,
  }),
};

let server: Server;
let baseUrl: string;

async function startHttpServer(): Promise<void> {
  server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(
        incoming.url ?? "/",
        "http://localhost",
      );

      const handler = handlers[url.pathname as keyof typeof handlers];

      if (!handler) {
        outgoing.writeHead(404, {
          "Content-Type": "application/json",
        });

        outgoing.end(
          JSON.stringify({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: "Route not found.",
            },
          }),
        );

        return;
      }

      const request = new Request(url, {
        method: incoming.method ?? "GET",
      });

      const response = await handler(request);

      outgoing.writeHead(response.status, {
        "Content-Type":
          response.headers.get("content-type") ??
          "application/json",
      });

      outgoing.end(
        new Uint8Array(await response.arrayBuffer()),
      );
    } catch (error) {
      console.error("[analytics-http-test]", error);

      if (!outgoing.headersSent) {
        outgoing.writeHead(500, {
          "Content-Type": "application/json",
        });
      }

      outgoing.end(
        JSON.stringify({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
          },
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to obtain HTTP server address.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
}

interface AnalyticsDimensionData {
  items: unknown[];
}

interface AnalyticsHttpData {
  [key: string]: unknown;
  pv?: number;
  uv?: number;
  granularity?: string;
  items?: unknown[];
  referrer_host?: AnalyticsDimensionData;
  utm_source?: AnalyticsDimensionData;
  utm_medium?: AnalyticsDimensionData;
  utm_campaign?: AnalyticsDimensionData;
  browser?: AnalyticsDimensionData;
  os?: AnalyticsDimensionData;
}

interface AnalyticsHttpBody {
  success: boolean;
  data: AnalyticsHttpData;
  meta: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDimensionData(value: unknown): value is AnalyticsDimensionData {
  return isRecord(value) && Array.isArray(value.items);
}

function readAnalyticsData(value: unknown): AnalyticsHttpData {
  if (!isRecord(value)) {
    throw new Error("Invalid analytics response data");
  }

  if (
    (value.pv !== undefined && typeof value.pv !== "number") ||
    (value.uv !== undefined && typeof value.uv !== "number") ||
    (value.granularity !== undefined &&
      typeof value.granularity !== "string") ||
    (value.items !== undefined && !Array.isArray(value.items)) ||
    (value.referrer_host !== undefined &&
      !isDimensionData(value.referrer_host)) ||
    (value.utm_source !== undefined &&
      !isDimensionData(value.utm_source)) ||
    (value.utm_medium !== undefined &&
      !isDimensionData(value.utm_medium)) ||
    (value.utm_campaign !== undefined &&
      !isDimensionData(value.utm_campaign)) ||
    (value.browser !== undefined && !isDimensionData(value.browser)) ||
    (value.os !== undefined && !isDimensionData(value.os))
  ) {
    throw new Error("Invalid analytics response data fields");
  }

  return { ...value };
}

async function getJson(path: string): Promise<{
  response: Response;
  body: AnalyticsHttpBody;
}> {
  const response = await fetch(`${baseUrl}${path}`);
  const rawBody: unknown = await response.json();

  if (!isRecord(rawBody) || typeof rawBody.success !== "boolean") {
    throw new Error("Invalid analytics API response");
  }

  if (rawBody.success) {
    if (!isRecord(rawBody.meta)) {
      throw new Error("Invalid analytics API metadata");
    }

    return {
      response,
      body: {
        success: true,
        data: readAnalyticsData(rawBody.data),
        meta: rawBody.meta,
      },
    };
  }

  if (
    !isRecord(rawBody.error) ||
    typeof rawBody.error.code !== "string" ||
    typeof rawBody.error.message !== "string"
  ) {
    throw new Error("Invalid analytics API error response");
  }

  return {
    response,
    body: {
      success: false,
      data: {},
      meta: {},
      error: {
        code: rawBody.error.code,
        message: rawBody.error.message,
      },
    },
  };
}

function customRange(siteId: string): string {
  return `site_id=${siteId}&range=custom&start=${start}&end=${end}`;
}

describe("Statistics API - HTTP integration", () => {
  beforeAll(async () => {
    await startHttpServer();
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }

    await pool.end();
  });

  it("should return Overview statistics through HTTP", async () => {
    const { response, body } = await getJson(
      `/api/analytics/overview?${customRange(siteA)}`,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data).toEqual({
      pv: 13,
      uv: 4,
      sessions: 5,
      bounce_sessions: 2,
      bounce_rate: 40,
    });

    expect(body.meta).toMatchObject({
      site_id: siteA,
      range: "custom",
      timezone: "UTC",
    });
  });

  it("should return Trends statistics through HTTP", async () => {
    const { response, body } = await getJson(
      `/api/analytics/trends?${customRange(siteA)}`,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.granularity).toBe("day");
    expect(body.data.items).toHaveLength(4);

    expect(body.meta).toMatchObject({
      site_id: siteA,
      range: "custom",
      timezone: "UTC",
    });
  });

  it("should return Pages statistics through HTTP", async () => {
  const { response, body } = await getJson(
    `/api/analytics/pages?${customRange(siteA)}`,
  );

  expect(response.status).toBe(200);
  expect(body.success).toBe(true);

  expect(body.data.items).toHaveLength(3);

  expect(body.meta).toMatchObject({
    site_id: siteA,
    range: "custom",
    timezone: "UTC",
    total: 3,
    page: 1,
    page_size: 10,
    total_pages: 1,
  });
});

  it("should return Locations statistics through HTTP", async () => {
  const { response, body } = await getJson(
    `/api/analytics/locations?${customRange(siteA)}`,
  );

  expect(response.status).toBe(200);
  expect(body.success).toBe(true);

  expect(Array.isArray(body.data.items)).toBe(true);

  expect(body.meta).toMatchObject({
    site_id: siteA,
    range: "custom",
    timezone: "UTC",
    page: 1,
    page_size: 10,
  });

  expect(typeof body.meta.total).toBe("number");
});

  it("should return Sources statistics through HTTP", async () => {
    const { response, body } = await getJson(
      `/api/analytics/sources?${customRange(siteA)}`,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.referrer_host?.items).toBeDefined();
    expect(body.data.utm_source?.items).toBeDefined();
    expect(body.data.utm_medium?.items).toBeDefined();
    expect(body.data.utm_campaign?.items).toBeDefined();

    expect(body.meta).toMatchObject({
      site_id: siteA,
      range: "custom",
      timezone: "UTC",
    });
  });

  it("should return Devices statistics through HTTP", async () => {
    const { response, body } = await getJson(
      `/api/analytics/devices?${customRange(siteA)}`,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.browser?.items).toBeDefined();
    expect(body.data.os?.items).toBeDefined();

    expect(body.meta).toMatchObject({
      site_id: siteA,
      range: "custom",
      timezone: "UTC",
    });
  });

  it("should isolate Site A and Site B through HTTP", async () => {
    const resultA = await getJson(
      `/api/analytics/overview?${customRange(siteA)}`,
    );

    const resultB = await getJson(
      `/api/analytics/overview?${customRange(siteB)}`,
    );

    expect(resultA.response.status).toBe(200);
    expect(resultB.response.status).toBe(200);

    expect(resultA.body.data.pv).toBe(13);
    expect(resultB.body.data.pv).toBe(1);

    expect(resultA.body.data.uv).toBe(4);
    expect(resultB.body.data.uv).toBe(1);
  });

  it("should reject invalid query parameters through HTTP", async () => {
    const { response, body } = await getJson(
      `/api/analytics/overview?site_id=${siteA}&unknown=value`,
    );

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("INVALID_QUERY");
  });

  it("should reject duplicate query parameters through HTTP", async () => {
    const { response, body } = await getJson(
      `/api/analytics/overview?site_id=${siteA}&site_id=${siteA}`,
    );

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("INVALID_QUERY");
  });
});





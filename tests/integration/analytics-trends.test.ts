
import { afterAll, describe, expect, it, vi  } from "vitest";
import { pool } from "../../db/client";
import {
  getTrendStats,
} from "../../netlify/functions/_shared/analytics/trends-service";

import {
  createTrendsHandler,
} from "../../netlify/functions/analytics-trends.mts";

import {
  getPageStats,
} from "../../netlify/functions/_shared/analytics/pages-service";


import {
  createPagesHandler,
} from "../../netlify/functions/analytics-pages.mts";

import {
  getLocationStats,
} from "../../netlify/functions/_shared/analytics/locations-service";

import {
  createLocationsHandler,
} from "../../netlify/functions/analytics-locations.mts";

import {
  getSourcesStats,
} from "../../netlify/functions/_shared/analytics/sources-service";

import {
  createSourcesHandler,
} from "../../netlify/functions/analytics-sources.mts";

import {
  getDevicesStats,
} from "../../netlify/functions/_shared/analytics/devices-service";

import {
  createDevicesHandler,
} from "../../netlify/functions/analytics-devices.mts";

import {
  AnalyticsError,
} from "../../netlify/functions/_shared/analytics/errors";


import type { TrendItem } from "../../netlify/functions/_shared/analytics/trends-service";
import type { PageStatsItem } from "../../netlify/functions/_shared/analytics/pages-service";
import type { LocationStatsItem } from "../../netlify/functions/_shared/analytics/locations-service";
import type { SourceStatsItem } from "../../netlify/functions/_shared/analytics/sources-service";
import type { DeviceStatsItem } from "../../netlify/functions/_shared/analytics/devices-service";

interface BaseApiMeta {
  site_id: string;
  range: string;
  start: string;
  end: string;
  timezone: string;
}

interface PagedApiMeta extends BaseApiMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  sort_by: string;
  sort_order: string;
}

interface DimensionApiMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

interface TrendsApiData {
  granularity: "hour" | "day";
  items: TrendItem[];
}

interface PagesApiData {
  items: PageStatsItem[];
}

interface LocationsApiData {
  items: LocationStatsItem[];
}

interface SourcesApiData {
  referrer_host: { items: SourceStatsItem[] };
  utm_source: { items: SourceStatsItem[] };
  utm_medium: { items: SourceStatsItem[] };
  utm_campaign: { items: SourceStatsItem[] };
}

interface DevicesApiData {
  browser: { items: DeviceStatsItem[] };
  os: { items: DeviceStatsItem[] };
}

interface SourcesApiMeta extends BaseApiMeta {
  referrer_host: DimensionApiMeta;
  utm_source: DimensionApiMeta;
  utm_medium: DimensionApiMeta;
  utm_campaign: DimensionApiMeta;
}

interface DevicesApiMeta extends BaseApiMeta {
  browser: DimensionApiMeta;
  os: DimensionApiMeta;
}

interface ApiSuccess<TData, TMeta> {
  success: true;
  data: TData;
  meta: TMeta;
}

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBaseApiMeta(value: unknown): value is BaseApiMeta {
  return (
    isRecord(value) &&
    isString(value.site_id) &&
    isString(value.range) &&
    isString(value.start) &&
    isString(value.end) &&
    isString(value.timezone)
  );
}

function isDimensionApiMeta(value: unknown): value is DimensionApiMeta {
  return (
    isRecord(value) &&
    isNumber(value.page) &&
    isNumber(value.page_size) &&
    isNumber(value.total) &&
    isNumber(value.total_pages)
  );
}

function isPagedApiMeta(value: unknown): value is PagedApiMeta {
  return (
    isBaseApiMeta(value) &&
    isRecord(value) &&
    isNumber(value.page) &&
    isNumber(value.page_size) &&
    isNumber(value.total) &&
    isNumber(value.total_pages) &&
    isString(value.sort_by) &&
    isString(value.sort_order)
  );
}

function isTrendItem(value: unknown): value is TrendItem {
  if (
    !isRecord(value) ||
    !isString(value.date) ||
    !isNumber(value.pv) ||
    !isNumber(value.uv)
  ) {
    return false;
  }

  if ("bucket_start_utc" in value) {
    return (
      isString(value.bucket_start_utc) &&
      isNumber(value.offset_minutes)
    );
  }

  return true;
}

function isPageStatsItem(value: unknown): value is PageStatsItem {
  return (
    isRecord(value) &&
    isString(value.page_path) &&
    isNumber(value.pv) &&
    isNumber(value.uv) &&
    isNumber(value.pv_share)
  );
}

function isLocationStatsItem(value: unknown): value is LocationStatsItem {
  return (
    isRecord(value) &&
    (value.country_code === null || isString(value.country_code)) &&
    (value.region === null || isString(value.region)) &&
    (value.city === null || isString(value.city)) &&
    isNumber(value.pv) &&
    isNumber(value.uv)
  );
}

function isSourceStatsItem(value: unknown): value is SourceStatsItem {
  return (
    isRecord(value) &&
    (value.source === null || isString(value.source)) &&
    isNumber(value.pv) &&
    isNumber(value.uv)
  );
}

function isDeviceStatsItem(value: unknown): value is DeviceStatsItem {
  return (
    isRecord(value) &&
    (value.device === null || isString(value.device)) &&
    isNumber(value.pv) &&
    isNumber(value.uv)
  );
}

function isItemCollection<T>(
  value: unknown,
  isItem: (item: unknown) => item is T,
): value is { items: T[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isItem)
  );
}

function isTrendsApiData(value: unknown): value is TrendsApiData {
  return (
    isRecord(value) &&
    (value.granularity === "hour" || value.granularity === "day") &&
    Array.isArray(value.items) &&
    value.items.every(isTrendItem)
  );
}

function isPagesApiData(value: unknown): value is PagesApiData {
  return isItemCollection(value, isPageStatsItem);
}

function isLocationsApiData(value: unknown): value is LocationsApiData {
  return isItemCollection(value, isLocationStatsItem);
}

function isSourcesApiData(value: unknown): value is SourcesApiData {
  return (
    isRecord(value) &&
    isItemCollection(value.referrer_host, isSourceStatsItem) &&
    isItemCollection(value.utm_source, isSourceStatsItem) &&
    isItemCollection(value.utm_medium, isSourceStatsItem) &&
    isItemCollection(value.utm_campaign, isSourceStatsItem)
  );
}

function isDevicesApiData(value: unknown): value is DevicesApiData {
  return (
    isRecord(value) &&
    isItemCollection(value.browser, isDeviceStatsItem) &&
    isItemCollection(value.os, isDeviceStatsItem)
  );
}

function isTrendsApiMeta(value: unknown): value is BaseApiMeta {
  return isBaseApiMeta(value);
}

function isPagesApiMeta(value: unknown): value is PagedApiMeta {
  return isPagedApiMeta(value);
}

function isLocationsApiMeta(value: unknown): value is PagedApiMeta {
  return isPagedApiMeta(value);
}

function isSourcesApiMeta(value: unknown): value is SourcesApiMeta {
  return (
    isBaseApiMeta(value) &&
    isRecord(value) &&
    isDimensionApiMeta(value.referrer_host) &&
    isDimensionApiMeta(value.utm_source) &&
    isDimensionApiMeta(value.utm_medium) &&
    isDimensionApiMeta(value.utm_campaign)
  );
}

function isDevicesApiMeta(value: unknown): value is DevicesApiMeta {
  return (
    isBaseApiMeta(value) &&
    isRecord(value) &&
    isDimensionApiMeta(value.browser) &&
    isDimensionApiMeta(value.os)
  );
}

function isApiError(value: unknown): value is ApiError {
  return (
    isRecord(value) &&
    value.success === false &&
    isRecord(value.error) &&
    isString(value.error.code) &&
    isString(value.error.message)
  );
}

async function readSuccessJson<TData, TMeta>(
  response: Response,
  isData: (value: unknown) => value is TData,
  isMeta: (value: unknown) => value is TMeta,
): Promise<ApiSuccess<TData, TMeta>> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isData(body.data) ||
    !isMeta(body.meta)
  ) {
    throw new Error("Invalid API success response structure.");
  }

  return {
    success: true,
    data: body.data,
    meta: body.meta,
  };
}

async function readErrorJson(response: Response): Promise<ApiError> {
  const body: unknown = await response.json();

  if (!isApiError(body)) {
    throw new Error("Invalid API error response structure.");
  }

  return body;
}
const siteA = "accb07ee-6504-4855-b25b-4a5bf22d8164";
const siteB = "c77de8cc-d44f-475c-b68c-32975934b0d1";

const authorization = {
  requireSiteAccess: vi.fn().mockResolvedValue(undefined),
};

const resolveAuthorization = async () => authorization;

const handler = createTrendsHandler({
  database: pool,
  resolveAuthorization,
});

const pagesHandler = createPagesHandler({
  database: pool,
  resolveAuthorization,
});

const locationsHandler = createLocationsHandler({
  database: pool,
  resolveAuthorization,
});

const devicesHandler = createDevicesHandler({
  database: pool,
  resolveAuthorization,
});

const sourcesHandler = createSourcesHandler({
  database: pool,
  resolveAuthorization,
});

function createSourcesRequest(query: string) {
  return new Request(
    `http://localhost/api/analytics/sources${query}`,
    { method: "GET" },
  );
}

function createDevicesRequest(query: string) {
  return new Request(
    `http://localhost/api/analytics/devices${query}`,
    { method: "GET" },
  );
}

function createPagesRequest(query: string) {
  return new Request(
    `http://localhost/api/analytics/pages${query}`,
    { method: "GET" },
  );
}

function createLocationsRequest(query: string) {
  return new Request(
    `http://localhost/api/analytics/locations${query}`,
    { method: "GET" },
  );
}

function createRequest(query: string) {
  return new Request(
    `http://localhost/api/analytics/trends${query}`,
    { method: "GET" },
  );
}

describe("Trends statistics - PostgreSQL integration", () => {

  it("should include an event exactly at the start boundary", async () => {
  const eventTime = new Date("2026-11-08T11:51:44.830Z");

  const result = await getTrendStats(
    pool,
    siteB,
    eventTime,
    new Date("2026-11-08T12:00:00.000Z"),
    "UTC",
    "hour",
  );

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    bucket_start_utc: "2026-11-08T11:00:00.000Z",
    pv: 1,
    uv: 1,
  });
});

it("should exclude an event exactly at the end boundary", async () => {
  const eventTime = new Date("2026-11-08T11:51:44.830Z");

  const result = await getTrendStats(
    pool,
    siteB,
    new Date("2026-11-08T11:00:00.000Z"),
    eventTime,
    "UTC",
    "hour",
  );

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    bucket_start_utc: "2026-11-08T11:00:00.000Z",
    pv: 0,
    uv: 0,
  });
});


  it("should calculate PV, UV and PV share for each page", async () => {
    const result = await getPageStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-05T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(3);

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
      {
        page_path: "/about",
        pv: 2,
        uv: 1,
        pv_share: 15.38,
      },
    ]);
  });

  it("should calculate total PV share as 100 percent", async () => {
    const result = await getPageStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-05T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      page: 1,
      pageSize: 10,
    });

    const totalShare = result.items.reduce(
      (total, item) => total + item.pv_share,
      0,
    );

    expect(totalShare).toBeCloseTo(100, 1);
  });

  it("should calculate UV independently for each page", async () => {
    const result = await getPageStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-05T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      page: 1,
      pageSize: 10,
    });

    const homePage = result.items.find(
      (item) => item.page_path === "/",
    );

    const productPage = result.items.find(
      (item) => item.page_path === "/products",
    );

    expect(homePage?.uv).toBe(3);
    expect(productPage?.uv).toBe(2);
  });

  it("should return correct pagination and total group count", async () => {
    const result = await getPageStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-05T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      page: 1,
      pageSize: 2,
    });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);

    const secondPage = await getPageStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-05T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      page: 2,
      pageSize: 2,
    });

    expect(secondPage.total).toBe(3);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].page_path).toBe("/about");
  });

  it("should support sorting by UV ascending", async () => {
    const result = await getPageStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-05T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      page: 1,
      pageSize: 10,
      sortBy: "uv",
      sortOrder: "asc",
    });

    expect(result.items.map((item) => item.page_path)).toEqual([
      "/about",
      "/products",
      "/",
    ]);
  });

  it("should support sorting by page path ascending", async () => {
    const result = await getPageStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-05T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      page: 1,
      pageSize: 10,
      sortBy: "page_path",
      sortOrder: "asc",
    });

    expect(result.items.map((item) => item.page_path)).toEqual([
      "/",
      "/about",
      "/products",
    ]);
  });

  it("should isolate page statistics by site", async () => {
    const result = await getPageStats({
      database: pool,
      siteId: siteB,
      start: new Date("2026-11-07T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].pv).toBe(1);
    expect(result.items[0].uv).toBe(1);
  });

  it("should return empty results for a range without events", async () => {
    const result = await getPageStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-20T00:00:00.000Z"),
      end: new Date("2026-11-21T00:00:00.000Z"),
      page: 1,
      pageSize: 10,
    });

    expect(result).toEqual({
      items: [],
      total: 0,
    });
  });

    describe("Sources statistics - PostgreSQL integration", () => {
    const start = new Date("2026-11-05T00:00:00.000Z");
    const end = new Date("2026-11-09T00:00:00.000Z");

    const pagination = {
      referrer_host: { page: 1, pageSize: 10 },
      utm_source: { page: 1, pageSize: 10 },
      utm_medium: { page: 1, pageSize: 10 },
      utm_campaign: { page: 1, pageSize: 10 },
    };

    it("should calculate statistics for all four source dimensions", async () => {
      const result = await getSourcesStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        pagination,
      });

      expect(result.referrer_host.total).toBe(3);
      expect(result.referrer_host.items).toEqual([
        { source: null, pv: 6, uv: 3 },
        { source: "localhost", pv: 5, uv: 1 },
        { source: "google.com", pv: 2, uv: 1 },
      ]);

      expect(result.utm_source.total).toBe(2);
      expect(result.utm_source.items).toEqual([
        { source: null, pv: 11, uv: 3 },
        { source: "google", pv: 2, uv: 1 },
      ]);

      expect(result.utm_medium.total).toBe(2);
      expect(result.utm_medium.items).toEqual([
        { source: null, pv: 11, uv: 3 },
        { source: "organic", pv: 2, uv: 1 },
      ]);

      expect(result.utm_campaign.total).toBe(1);
      expect(result.utm_campaign.items).toEqual([
        { source: null, pv: 13, uv: 4 },
      ]);
    });

    it("should preserve NULL source groups", async () => {
      const result = await getSourcesStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        pagination,
      });

      expect(result.referrer_host.items.some(
        (item) => item.source === null,
      )).toBe(true);

      expect(result.utm_source.items.some(
        (item) => item.source === null,
      )).toBe(true);

      expect(result.utm_medium.items.some(
        (item) => item.source === null,
      )).toBe(true);

      expect(result.utm_campaign.items).toEqual([
        { source: null, pv: 13, uv: 4 },
      ]);
    });

    it("should calculate UV independently for each source group", async () => {
      const result = await getSourcesStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        pagination,
      });

      expect(result.referrer_host.items).toEqual(
        expect.arrayContaining([
          { source: null, pv: 6, uv: 3 },
          { source: "localhost", pv: 5, uv: 1 },
          { source: "google.com", pv: 2, uv: 1 },
        ]),
      );
    });

    it("should support independent pagination for each dimension", async () => {
      const result = await getSourcesStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        pagination: {
          referrer_host: { page: 1, pageSize: 1 },
          utm_source: { page: 2, pageSize: 1 },
          utm_medium: { page: 1, pageSize: 10 },
          utm_campaign: { page: 1, pageSize: 1 },
        },
      });

      expect(result.referrer_host.total).toBe(3);
      expect(result.referrer_host.items).toHaveLength(1);
      expect(result.referrer_host.page).toBe(1);
      expect(result.referrer_host.pageSize).toBe(1);

      expect(result.utm_source.total).toBe(2);
      expect(result.utm_source.items).toEqual([
        { source: "google", pv: 2, uv: 1 },
      ]);
      expect(result.utm_source.page).toBe(2);

      expect(result.utm_medium.items).toHaveLength(2);
      expect(result.utm_medium.pageSize).toBe(10);

      expect(result.utm_campaign.total).toBe(1);
      expect(result.utm_campaign.items).toHaveLength(1);
    });

    it("should use PV descending as the default source ordering", async () => {
      const result = await getSourcesStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        pagination,
      });

      expect(result.referrer_host.items.map(
        (item) => item.source,
      )).toEqual([
        null,
        "localhost",
        "google.com",
      ]);

      expect(result.utm_source.items.map(
        (item) => item.source,
      )).toEqual([
        null,
        "google",
      ]);
    });

    it("should include an event exactly at the start boundary", async () => {
      const eventTime = new Date("2026-11-08T11:51:44.830Z");

      const result = await getSourcesStats({
        database: pool,
        siteId: siteB,
        start: eventTime,
        end: new Date("2026-11-08T12:00:00.000Z"),
        pagination,
      });

      expect(result.referrer_host.total).toBe(1);
      expect(result.referrer_host.items).toEqual([
        { source: null, pv: 1, uv: 1 },
      ]);
    });

    it("should exclude an event exactly at the end boundary", async () => {
      const eventTime = new Date("2026-11-08T11:51:44.830Z");

      const result = await getSourcesStats({
        database: pool,
        siteId: siteB,
        start: new Date("2026-11-08T11:00:00.000Z"),
        end: eventTime,
        pagination,
      });

      expect(result.referrer_host.items).toEqual([]);
      expect(result.referrer_host.total).toBe(0);
    });

    it("should isolate source statistics by site", async () => {
      const result = await getSourcesStats({
        database: pool,
        siteId: siteB,
        start: new Date("2026-11-07T00:00:00.000Z"),
        end: new Date("2026-11-09T00:00:00.000Z"),
        pagination,
      });

      expect(result.referrer_host.total).toBe(1);
      expect(result.referrer_host.items).toEqual([
        { source: null, pv: 1, uv: 1 },
      ]);

      expect(result.utm_source.items).toEqual([
        { source: null, pv: 1, uv: 1 },
      ]);

      expect(result.utm_medium.items).toEqual([
        { source: null, pv: 1, uv: 1 },
      ]);

      expect(result.utm_campaign.items).toEqual([
        { source: null, pv: 1, uv: 1 },
      ]);
    });

    it("should return empty results for a range without events", async () => {
      const result = await getSourcesStats({
        database: pool,
        siteId: siteA,
        start: new Date("2026-11-20T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        pagination,
      });

      for (const dimension of [
        "referrer_host",
        "utm_source",
        "utm_medium",
        "utm_campaign",
      ] as const) {
        expect(result[dimension]).toMatchObject({
          items: [],
          total: 0,
          totalPages: 0,
        });
      }
    });

    it("should return all four dimensions through Sources API", async () => {
      const response = await sourcesHandler(
        createSourcesRequest(
          `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09`,
        ),
      );

      const body = await readSuccessJson(
        response,
        isSourcesApiData,
        isSourcesApiMeta,
      );

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      expect(body.data.referrer_host.items).toEqual([
        { source: null, pv: 6, uv: 3 },
        { source: "localhost", pv: 5, uv: 1 },
        { source: "google.com", pv: 2, uv: 1 },
      ]);

      expect(body.data.utm_source.items).toEqual([
        { source: null, pv: 11, uv: 3 },
        { source: "google", pv: 2, uv: 1 },
      ]);

      expect(body.data.utm_medium.items).toEqual([
        { source: null, pv: 11, uv: 3 },
        { source: "organic", pv: 2, uv: 1 },
      ]);

      expect(body.data.utm_campaign.items).toEqual([
        { source: null, pv: 13, uv: 4 },
      ]);

      expect(body.meta).toMatchObject({
        site_id: siteA,
        range: "custom",
        timezone: "UTC",
        referrer_host: {
          page: 1,
          page_size: 10,
          total: 3,
          total_pages: 1,
        },
        utm_source: {
          page: 1,
          page_size: 10,
          total: 2,
          total_pages: 1,
        },
        utm_medium: {
          page: 1,
          page_size: 10,
          total: 2,
          total_pages: 1,
        },
        utm_campaign: {
          page: 1,
          page_size: 10,
          total: 1,
          total_pages: 1,
        },
      });
    });

    it("should support independent pagination through Sources API", async () => {
      const response = await sourcesHandler(
        createSourcesRequest(
          `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09&referrer_host_page_size=1&utm_source_page=2&utm_source_page_size=1`,
        ),
      );

      const body = await readSuccessJson(
        response,
        isSourcesApiData,
        isSourcesApiMeta,
      );

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      expect(body.data.referrer_host.items).toHaveLength(1);
      expect(body.meta.referrer_host.page_size).toBe(1);
      expect(body.meta.referrer_host.total).toBe(3);

      expect(body.data.utm_source.items).toEqual([
        { source: "google", pv: 2, uv: 1 },
      ]);
      expect(body.meta.utm_source.page).toBe(2);
      expect(body.meta.utm_source.total_pages).toBe(2);

      expect(body.data.utm_medium.items).toHaveLength(2);
      expect(body.meta.utm_medium.page_size).toBe(10);
    });

    it("should return empty results through Sources API", async () => {
      const response = await sourcesHandler(
        createSourcesRequest(
          `?site_id=${siteA}&range=custom&start=2026-11-20&end=2026-11-21`,
        ),
      );

      const body = await readSuccessJson(
        response,
        isSourcesApiData,
        isSourcesApiMeta,
      );

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      for (const dimension of [
        "referrer_host",
        "utm_source",
        "utm_medium",
        "utm_campaign",
      ] as const) {
        expect(body.data[dimension].items).toEqual([]);
        expect(body.meta[dimension].total).toBe(0);
        expect(body.meta[dimension].total_pages).toBe(0);
      }
    });

    it("should reject invalid dimension page_size through Sources API", async () => {
      const response = await sourcesHandler(
        createSourcesRequest(
          `?site_id=${siteA}&range=7d&utm_source_page_size=101`,
        ),
      );

      const body = await readErrorJson(response);

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INVALID_QUERY");
    });

    it("should return SITE_NOT_FOUND through Sources API", async () => {
      const nonexistentSite = "99999999-9999-4999-8999-999999999999";

      const response = await sourcesHandler(
        createSourcesRequest(
          `?site_id=${nonexistentSite}&range=7d`,
        ),
      );

      const body = await readErrorJson(response);

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("SITE_NOT_FOUND");
    });

    it("should reject unauthorized Sources API requests before querying site data", async () => {
      authorization.requireSiteAccess.mockRejectedValueOnce(
        new AnalyticsError(
          "SITE_ACCESS_DENIED",
          "Access to the specified site is denied.",
        ),
      );

      const querySpy = vi.spyOn(pool, "query");

      try {
        const response = await sourcesHandler(
          createSourcesRequest(`?site_id=${siteA}&range=7d`),
        );

        const body = await readErrorJson(response);

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe("SITE_ACCESS_DENIED");
        expect(querySpy).not.toHaveBeenCalled();
      } finally {
        querySpy.mockRestore();
      }
    });
  });


  afterAll(async () => {
    await pool.end();
  });

  it("should preserve both repeated 01:00 buckets during Los Angeles DST fallback", async () => {
    const result = await getTrendStats(
      pool,
      siteA,
      new Date("2026-11-01T08:00:00.000Z"),
      new Date("2026-11-01T10:00:00.000Z"),
      "America/Los_Angeles",
      "hour",
    );

    expect(result).toHaveLength(2);

    expect(result).toEqual([
      {
        bucket_start_utc: "2026-11-01T08:00:00.000Z",
        date: "2026-11-01T01:00:00",
        offset_minutes: -420,
        pv: 0,
        uv: 0,
      },
      {
        bucket_start_utc: "2026-11-01T09:00:00.000Z",
        date: "2026-11-01T01:00:00",
        offset_minutes: -480,
        pv: 0,
        uv: 0,
      },
    ]);
  });

  it("should skip nonexistent 02:00 during Los Angeles DST spring transition", async () => {
    const result = await getTrendStats(
      pool,
      siteA,
      new Date("2026-03-08T08:00:00.000Z"),
      new Date("2026-03-08T12:00:00.000Z"),
      "America/Los_Angeles",
      "hour",
    );

    expect(result).toHaveLength(4);

    expect(result.map((item) => item.date)).toEqual([
      "2026-03-08T00:00:00",
      "2026-03-08T01:00:00",
      "2026-03-08T03:00:00",
      "2026-03-08T04:00:00",
    ]);

    expect(
      result.map((item) =>
        "offset_minutes" in item ? item.offset_minutes : undefined,
      ),
    ).toEqual([
      -480,
      -480,
      -420,
      -420,
    ]);
  });

  it("should return 23-hour local day across spring DST transition", async () => {
    const result = await getTrendStats(
      pool,
      siteA,
      new Date("2026-03-08T08:00:00.000Z"),
      new Date("2026-03-09T07:00:00.000Z"),
      "America/Los_Angeles",
      "day",
    );

    expect(result).toEqual([
      {
        date: "2026-03-08",
        pv: 0,
        uv: 0,
      },
    ]);
  });

  it("should return 25-hour local day across autumn DST transition", async () => {
    const result = await getTrendStats(
      pool,
      siteA,
      new Date("2026-11-01T07:00:00.000Z"),
      new Date("2026-11-02T08:00:00.000Z"),
      "America/Los_Angeles",
      "day",
    );

    expect(result).toEqual([
      {
        date: "2026-11-01",
        pv: 0,
        uv: 0,
      },
    ]);
  });

  it("should calculate daily statistics using Asia/Shanghai local date", async () => {
  const result = await getTrendStats(
    pool,
    siteB,
    new Date("2026-11-07T16:00:00.000Z"),
    new Date("2026-11-08T16:00:00.000Z"),
    "Asia/Shanghai",
    "day",
  );

  expect(result).toEqual([
    {
      date: "2026-11-08",
      pv: 1,
      uv: 1,
    },
  ]);
});

  it("should zero-fill empty hourly buckets", async () => {
    const result = await getTrendStats(
      pool,
      siteA,
      new Date("2026-11-08T00:00:00.000Z"),
      new Date("2026-11-08T04:00:00.000Z"),
      "UTC",
      "hour",
    );

    expect(result).toHaveLength(4);

    for (const item of result) {
      expect(item.pv).toBe(0);
      expect(item.uv).toBe(0);
    }
  });

  it("should zero-fill empty daily buckets", async () => {
    const result = await getTrendStats(
      pool,
      siteA,
      new Date("2026-11-09T00:00:00.000Z"),
      new Date("2026-11-12T00:00:00.000Z"),
      "UTC",
      "day",
    );

    expect(result).toEqual([
      { date: "2026-11-09", pv: 0, uv: 0 },
      { date: "2026-11-10", pv: 0, uv: 0 },
      { date: "2026-11-11", pv: 0, uv: 0 },
    ]);
  });

  it("should return daily trends using the site's Asia/Shanghai timezone", async () => {
    const response = await handler(
      createRequest(
        `?site_id=${siteB}&range=custom&start=2026-11-08&end=2026-11-11`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isTrendsApiData,
      isTrendsApiMeta,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.granularity).toBe("day");
    expect(body.data.items).toEqual([
      {
        date: "2026-11-08",
        pv: 1,
        uv: 1,
      },
      {
        date: "2026-11-09",
        pv: 0,
        uv: 0,
      },
      {
        date: "2026-11-10",
        pv: 0,
        uv: 0,
      },
    ]);

    expect(body.meta.site_id).toBe(siteB);
    expect(body.meta.timezone).toBe("Asia/Shanghai");
    expect(body.meta.range).toBe("custom");
    expect(body.meta.start).toBe("2026-11-07T16:00:00.000Z");
    expect(body.meta.end).toBe("2026-11-10T16:00:00.000Z");
  });

  it("should return hourly trends for a custom range shorter than 48 hours", async () => {
    const response = await handler(
      createRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-08T11:00:00Z&end=2026-11-08T12:00:00Z`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isTrendsApiData,
      isTrendsApiMeta,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.granularity).toBe("hour");
    expect(body.data.items).toHaveLength(1);

    expect(body.data.items[0]).toMatchObject({
      date: "2026-11-08T11:00:00",
      offset_minutes: 0,
      pv: 6,
      uv: 2,
    });

    expect(body.meta.timezone).toBe("UTC");
  });

  it("should return daily trends for a custom range longer than 48 hours", async () => {
    const response = await handler(
      createRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isTrendsApiData,
      isTrendsApiMeta,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.granularity).toBe("day");
    expect(body.data.items).toHaveLength(4);

    expect(body.data.items.reduce(
      (total: number, item: { pv: number }) => total + item.pv,
      0,
    )).toBe(13);

    expect(body.meta.timezone).toBe("UTC");
  });

  it("should use hourly granularity for exactly 48 hours", async () => {
    const response = await handler(
      createRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-06T00:00:00Z&end=2026-11-08T00:00:00Z`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isTrendsApiData,
      isTrendsApiMeta,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.granularity).toBe("hour");
    expect(body.data.items).toHaveLength(48);
  });

  it("should return zero-filled daily buckets for an empty range", async () => {
    const response = await handler(
      createRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-09&end=2026-11-12`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isTrendsApiData,
      isTrendsApiMeta,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.granularity).toBe("day");

    expect(body.data.items).toEqual([
      { date: "2026-11-09", pv: 0, uv: 0 },
      { date: "2026-11-10", pv: 0, uv: 0 },
      { date: "2026-11-11", pv: 0, uv: 0 },
    ]);
  });

  it("should return SITE_NOT_FOUND for a nonexistent site", async () => {
    const nonexistentSite = "99999999-9999-4999-8999-999999999999";

    const response = await handler(
      createRequest(
        `?site_id=${nonexistentSite}&range=7d`,
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
  });

  
  it("should return correct page statistics through Pages API", async () => {
    const response = await pagesHandler(
      createPagesRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isPagesApiData,
      isPagesApiMeta,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.items).toEqual([
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
      {
        page_path: "/about",
        pv: 2,
        uv: 1,
        pv_share: 15.38,
      },
    ]);

    expect(body.meta).toMatchObject({
      site_id: siteA,
      range: "custom",
      timezone: "UTC",
      page: 1,
      page_size: 10,
      total: 3,
      total_pages: 1,
      sort_by: "pv",
      sort_order: "desc",
    });
  });

  it("should return correct pagination through Pages API", async () => {
    const firstResponse = await pagesHandler(
      createPagesRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09&page=1&page_size=2`,
      ),
    );

    const firstBody = await readSuccessJson(
      firstResponse,
      isPagesApiData,
      isPagesApiMeta,
    );

    expect(firstResponse.status).toBe(200);
    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.meta.total).toBe(3);
    expect(firstBody.meta.total_pages).toBe(2);

    const secondResponse = await pagesHandler(
      createPagesRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09&page=2&page_size=2`,
      ),
    );

    const secondBody = await readSuccessJson(
      secondResponse,
      isPagesApiData,
      isPagesApiMeta,
    );

    expect(secondResponse.status).toBe(200);
    expect(secondBody.data.items).toHaveLength(1);
    expect(secondBody.data.items[0].page_path).toBe("/about");
    expect(secondBody.meta.total).toBe(3);
    expect(secondBody.meta.total_pages).toBe(2);
  });

  it("should support sorting by UV ascending through Pages API", async () => {
    const response = await pagesHandler(
      createPagesRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09&sort_by=uv&sort_order=asc`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isPagesApiData,
      isPagesApiMeta,
    );

    expect(response.status).toBe(200);

    expect(
      body.data.items.map((item: { page_path: string }) => item.page_path),
    ).toEqual([
      "/about",
      "/products",
      "/",
    ]);
  });

  it("should isolate page statistics by site through Pages API", async () => {
    const response = await pagesHandler(
      createPagesRequest(
        `?site_id=${siteB}&range=custom&start=2026-11-07T00:00:00Z&end=2026-11-09T00:00:00Z`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isPagesApiData,
      isPagesApiMeta,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      pv: 1,
      uv: 1,
    });

    expect(body.meta).toMatchObject({
      site_id: siteB,
      total: 1,
      timezone: "Asia/Shanghai",
    });
  });

  it("should return empty results through Pages API", async () => {
    const response = await pagesHandler(
      createPagesRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-20&end=2026-11-21`,
      ),
    );

    const body = await readSuccessJson(
      response,
      isPagesApiData,
      isPagesApiMeta,
    );

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([]);
    expect(body.meta.total).toBe(0);
    expect(body.meta.total_pages).toBe(0);
  });

  it("should reject invalid page_size through Pages API", async () => {
    const response = await pagesHandler(
      createPagesRequest(
        `?site_id=${siteA}&range=7d&page_size=101`,
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  it("should return SITE_NOT_FOUND through Pages API", async () => {
    const nonexistentSite = "99999999-9999-4999-8999-999999999999";

    const response = await pagesHandler(
      createPagesRequest(
        `?site_id=${nonexistentSite}&range=7d`,
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
  });

  it("should reject unauthorized Pages API requests before querying site data", async () => {
    authorization.requireSiteAccess.mockRejectedValueOnce(
      new AnalyticsError(
          "SITE_ACCESS_DENIED",
          "Access to the specified site is denied.",
        ),
    );

    const querySpy = vi.spyOn(pool, "query");

    try {
      const response = await pagesHandler(
        createPagesRequest(`?site_id=${siteA}&range=7d`),
      );

      const body = await readErrorJson(response);

      expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe("SITE_ACCESS_DENIED");
        expect(querySpy).not.toHaveBeenCalled();
    } finally {
      querySpy.mockRestore();
    }
  });

  describe("Locations statistics - PostgreSQL integration", () => {
    const start = new Date("2026-11-05T00:00:00.000Z");
    const end = new Date("2026-11-09T00:00:00.000Z");

    it("should group statistics by country, region and city", async () => {
      const result = await getLocationStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        page: 1,
        pageSize: 10,
      });

      expect(result.total).toBe(1);

      expect(result.items).toEqual([
        {
          country_code: "US",
          region: null,
          city: null,
          pv: 13,
          uv: 4,
        },
      ]);
    });

    it("should preserve NULL region and city values", async () => {
      const result = await getLocationStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        page: 1,
        pageSize: 10,
      });

      expect(result.items).toHaveLength(1);

      expect(result.items[0]).toMatchObject({
        country_code: "US",
        region: null,
        city: null,
      });
    });

    it("should return correct pagination and total group count", async () => {
      const result = await getLocationStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        page: 1,
        pageSize: 1,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);

      const secondPage = await getLocationStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        page: 2,
        pageSize: 1,
      });

      expect(secondPage.total).toBe(1);
      expect(secondPage.items).toHaveLength(0);
    });

    it("should support sorting by PV ascending", async () => {
      const result = await getLocationStats({
        database: pool,
        siteId: siteA,
        start,
        end,
        page: 1,
        pageSize: 10,
        sortBy: "pv",
        sortOrder: "asc",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].pv).toBe(13);
    });

    it("should isolate location statistics by site", async () => {
      const result = await getLocationStats({
        database: pool,
        siteId: siteB,
        start: new Date("2026-11-07T00:00:00.000Z"),
        end: new Date("2026-11-09T00:00:00.000Z"),
        page: 1,
        pageSize: 10,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);

      expect(result.items[0]).toMatchObject({
        pv: 1,
        uv: 1,
      });
    });

    it("should return empty results for a range without events", async () => {
      const result = await getLocationStats({
        database: pool,
        siteId: siteA,
        start: new Date("2026-11-20T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        page: 1,
        pageSize: 10,
      });

      expect(result).toEqual({
        items: [],
        total: 0,
      });
    });

    it("should return correct location statistics through Locations API", async () => {
      const response = await locationsHandler(
        createLocationsRequest(
          `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09`,
        ),
      );

      const body = await readSuccessJson(response, isLocationsApiData, isLocationsApiMeta);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      expect(body.data.items).toEqual([
        {
          country_code: "US",
          region: null,
          city: null,
          pv: 13,
          uv: 4,
        },
      ]);

      expect(body.meta).toMatchObject({
        site_id: siteA,
        range: "custom",
        timezone: "UTC",
        page: 1,
        page_size: 10,
        total: 1,
        total_pages: 1,
        sort_by: "pv",
        sort_order: "desc",
      });
    });

    it("should return correct pagination through Locations API", async () => {
      const response = await locationsHandler(
        createLocationsRequest(
          `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09&page=1&page_size=1`,
        ),
      );

      const body = await readSuccessJson(response, isLocationsApiData, isLocationsApiMeta);

      expect(response.status).toBe(200);
      expect(body.data.items).toHaveLength(1);
      expect(body.meta.total).toBe(1);
      expect(body.meta.total_pages).toBe(1);
    });

    it("should isolate location statistics by site through Locations API", async () => {
      const response = await locationsHandler(
        createLocationsRequest(
          `?site_id=${siteB}&range=custom&start=2026-11-07T00:00:00Z&end=2026-11-09T00:00:00Z`,
        ),
      );

      const body = await readSuccessJson(response, isLocationsApiData, isLocationsApiMeta);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]).toMatchObject({
        pv: 1,
        uv: 1,
      });

      expect(body.meta).toMatchObject({
        site_id: siteB,
        total: 1,
        timezone: "Asia/Shanghai",
      });
    });

    it("should return empty results through Locations API", async () => {
      const response = await locationsHandler(
        createLocationsRequest(
          `?site_id=${siteA}&range=custom&start=2026-11-20&end=2026-11-21`,
        ),
      );

      const body = await readSuccessJson(response, isLocationsApiData, isLocationsApiMeta);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.items).toEqual([]);
      expect(body.meta.total).toBe(0);
      expect(body.meta.total_pages).toBe(0);
    });

    it("should reject invalid page_size through Locations API", async () => {
      const response = await locationsHandler(
        createLocationsRequest(
          `?site_id=${siteA}&range=7d&page_size=101`,
        ),
      );

      const body = await readErrorJson(response);

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INVALID_QUERY");
    });

    it("should return SITE_NOT_FOUND through Locations API", async () => {
      const nonexistentSite = "99999999-9999-4999-8999-999999999999";

      const response = await locationsHandler(
        createLocationsRequest(
          `?site_id=${nonexistentSite}&range=7d`,
        ),
      );

      const body = await readErrorJson(response);

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("SITE_NOT_FOUND");
    });

    it("should reject unauthorized Locations API requests before querying site data", async () => {
      authorization.requireSiteAccess.mockRejectedValueOnce(
        new AnalyticsError(
          "SITE_ACCESS_DENIED",
          "Access to the specified site is denied.",
        ),
      );

      const querySpy = vi.spyOn(pool, "query");

      try {
        const response = await locationsHandler(
          createLocationsRequest(
            `?site_id=${siteA}&range=7d`,
          ),
        );

        const body = await readErrorJson(response);

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe("SITE_ACCESS_DENIED");
        expect(querySpy).not.toHaveBeenCalled();
      } finally {
        querySpy.mockRestore();
      }
    });
  });

  describe("Devices statistics - PostgreSQL integration", () => {
  const start = new Date("2026-11-05T00:00:00.000Z");
  const end = new Date("2026-11-09T00:00:00.000Z");

  const defaultPagination = {
    browser: { page: 1, pageSize: 10 },
    os: { page: 1, pageSize: 10 },
  };

  it("should calculate browser PV and UV correctly", async () => {
    const result = await getDevicesStats({
      database: pool,
      siteId: siteA,
      start,
      end,
      pagination: defaultPagination,
    });

    expect(result.browser.items).toEqual([
      { device: "Chrome", pv: 9, uv: 1 },
      { device: "Mozilla", pv: 3, uv: 3 },
      { device: "", pv: 1, uv: 1 },
    ]);
  });

  it("should calculate OS PV and UV correctly", async () => {
    const result = await getDevicesStats({
      database: pool,
      siteId: siteA,
      start,
      end,
      pagination: defaultPagination,
    });

    expect(result.os.items).toEqual([
      { device: "Windows", pv: 12, uv: 4 },
      { device: null, pv: 1, uv: 1 },
    ]);
  });

  it("should preserve NULL browser and OS groups", async () => {
    const result = await getDevicesStats({
      database: pool,
      siteId: siteA,
      start,
      end,
      pagination: defaultPagination,
    });

    expect(result.browser.items.some(
      (item) => item.device === "",
    )).toBe(true);

    expect(result.os.items.some(
      (item) => item.device === null,
    )).toBe(true);
  });

  it("should paginate browser and OS dimensions independently", async () => {
    const result = await getDevicesStats({
      database: pool,
      siteId: siteA,
      start,
      end,
      pagination: {
        browser: { page: 1, pageSize: 1 },
        os: { page: 1, pageSize: 2 },
      },
    });

    expect(result.browser.items).toHaveLength(1);
    expect(result.browser.total).toBe(3);
    expect(result.browser.totalPages).toBe(3);

    expect(result.os.items).toHaveLength(2);
    expect(result.os.total).toBe(2);
    expect(result.os.totalPages).toBe(1);
  });

  it("should return the second browser page independently", async () => {
    const result = await getDevicesStats({
      database: pool,
      siteId: siteA,
      start,
      end,
      pagination: {
        browser: { page: 2, pageSize: 1 },
        os: { page: 1, pageSize: 10 },
      },
    });

    expect(result.browser.items).toHaveLength(1);
    expect(result.browser.items[0].device).toBe("Mozilla");

    expect(result.os.items).toHaveLength(2);
  });

  it("should isolate device statistics by site", async () => {
    const result = await getDevicesStats({
      database: pool,
      siteId: siteB,
      start: new Date("2026-11-07T00:00:00.000Z"),
      end: new Date("2026-11-09T00:00:00.000Z"),
      pagination: defaultPagination,
    });

    expect(result.browser.total).toBe(1);
    expect(result.browser.items).toEqual([
      { device: "Mozilla", pv: 1, uv: 1 },
    ]);

    expect(result.os.total).toBe(1);
    expect(result.os.items).toEqual([
      { device: "Windows", pv: 1, uv: 1 },
    ]);
  });

  it("should return empty results for a range without events", async () => {
    const result = await getDevicesStats({
      database: pool,
      siteId: siteA,
      start: new Date("2026-11-20T00:00:00.000Z"),
      end: new Date("2026-11-21T00:00:00.000Z"),
      pagination: defaultPagination,
    });

    expect(result.browser).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });

    expect(result.os).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
  });

  it("should include an event exactly at the start boundary", async () => {
    const eventTime = new Date("2026-11-08T11:51:44.830Z");

    const result = await getDevicesStats({
      database: pool,
      siteId: siteB,
      start: eventTime,
      end: new Date("2026-11-08T12:00:00.000Z"),
      pagination: defaultPagination,
    });

    expect(result.browser.items).toEqual([
      { device: "Mozilla", pv: 1, uv: 1 },
    ]);
  });

  it("should exclude an event exactly at the end boundary", async () => {
    const eventTime = new Date("2026-11-08T11:51:44.830Z");

    const result = await getDevicesStats({
      database: pool,
      siteId: siteB,
      start: new Date("2026-11-08T11:00:00.000Z"),
      end: eventTime,
      pagination: defaultPagination,
    });

    expect(result.browser.items).toEqual([]);
    expect(result.browser.total).toBe(0);
  });

  it("should return correct device statistics through Devices API", async () => {
    const response = await devicesHandler(
      createDevicesRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09`,
      ),
    );

    const body = await readSuccessJson(response, isDevicesApiData, isDevicesApiMeta);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.browser.items).toEqual([
      { device: "Chrome", pv: 9, uv: 1 },
      { device: "Mozilla", pv: 3, uv: 3 },
      { device: "", pv: 1, uv: 1 },
    ]);

    expect(body.data.os.items).toEqual([
      { device: "Windows", pv: 12, uv: 4 },
      { device: null, pv: 1, uv: 1 },
    ]);

    expect(body.meta).toMatchObject({
      site_id: siteA,
      range: "custom",
      timezone: "UTC",
      browser: {
        page: 1,
        page_size: 10,
        total: 3,
        total_pages: 1,
      },
      os: {
        page: 1,
        page_size: 10,
        total: 2,
        total_pages: 1,
      },
    });
  });

  it("should support independent pagination through Devices API", async () => {
    const response = await devicesHandler(
      createDevicesRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-05&end=2026-11-09&browser_page=2&browser_page_size=1&os_page=1&os_page_size=2`,
      ),
    );

    const body = await readSuccessJson(response, isDevicesApiData, isDevicesApiMeta);

    expect(response.status).toBe(200);

    expect(body.data.browser.items).toHaveLength(1);
    expect(body.meta.browser).toMatchObject({
      page: 2,
      page_size: 1,
      total: 3,
      total_pages: 3,
    });

    expect(body.data.os.items).toHaveLength(2);
    expect(body.meta.os).toMatchObject({
      page: 1,
      page_size: 2,
      total: 2,
      total_pages: 1,
    });
  });

  it("should return empty results through Devices API", async () => {
    const response = await devicesHandler(
      createDevicesRequest(
        `?site_id=${siteA}&range=custom&start=2026-11-20&end=2026-11-21`,
      ),
    );

    const body = await readSuccessJson(response, isDevicesApiData, isDevicesApiMeta);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(body.data.browser.items).toEqual([]);
    expect(body.data.os.items).toEqual([]);

    expect(body.meta.browser.total).toBe(0);
    expect(body.meta.browser.total_pages).toBe(0);

    expect(body.meta.os.total).toBe(0);
    expect(body.meta.os.total_pages).toBe(0);
  });

  it("should return SITE_NOT_FOUND through Devices API", async () => {
    const nonexistentSite =
      "99999999-9999-4999-8999-999999999999";

    const response = await devicesHandler(
      createDevicesRequest(
        `?site_id=${nonexistentSite}&range=7d`,
      ),
    );

    const body = await readErrorJson(response);

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
  });

  it("should reject unauthorized Devices API requests before querying site data", async () => {
    authorization.requireSiteAccess.mockRejectedValueOnce(
      new AnalyticsError(
          "SITE_ACCESS_DENIED",
          "Access to the specified site is denied.",
        ),
    );

    const querySpy = vi.spyOn(pool, "query");

    try {
      const response = await devicesHandler(
        createDevicesRequest(
          `?site_id=${siteA}&range=7d`,
        ),
      );

      const body = await readErrorJson(response);

      expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe("SITE_ACCESS_DENIED");
        expect(querySpy).not.toHaveBeenCalled();
    } finally {
      querySpy.mockRestore();
    }
  });
});
  
  
});









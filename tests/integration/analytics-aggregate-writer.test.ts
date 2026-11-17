
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const LOCAL_DATABASE_URL =
  "postgresql://plv_dev:plv_local_dev_2026@localhost:5433/plv_site_monitor_dev";

type AggregateInput = {
  statDate: string;
  timezone: string;
  visitorKey: string;
  visitorKeyVersion: number;
  sessionKey: string;
  sessionKeyVersion: number;
  pagePath: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
};

let db: typeof import("../../db/client").db;
let pool: typeof import("../../db/client").pool;
let sites: typeof import("../../db/schema").sites;
let overview: typeof import("../../db/analytics-schema").analyticsDailyOverview;
let pages: typeof import("../../db/analytics-schema").analyticsDailyPages;
let sources: typeof import("../../db/analytics-schema").analyticsDailySources;
let devices: typeof import("../../db/analytics-schema").analyticsDailyDevices;
let locations: typeof import("../../db/analytics-schema").analyticsDailyLocations;
let memberships: typeof import("../../db/analytics-schema").analyticsDailyMemberships;
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;

let writePageViewAggregates: typeof import(
  "../../netlify/functions/_shared/analytics/aggregate-writer"
)["writePageViewAggregates"];

let siteId: string;

const baseInput: AggregateInput = {
  statDate: "2026-11-11",
  timezone: "UTC",
  visitorKey: "a".repeat(64),
  visitorKeyVersion: 1,
  sessionKey: "s".repeat(64),
  sessionKeyVersion: 1,
  pagePath: "/",
  referrerHost: "google.com",
  utmSource: "google",
  utmMedium: "organic",
  utmCampaign: "launch",
  browser: "Chrome",
  os: "Windows",
  deviceType: "desktop",
  countryCode: "US",
  region: "California",
  city: "San Jose",
};

describe("Analytics Aggregate Writer", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ||= LOCAL_DATABASE_URL;

    const databaseUrl = process.env.DATABASE_URL;

    if (databaseUrl !== LOCAL_DATABASE_URL) {
      throw new Error(
        "Unsafe database target. Only local plv_site_monitor_dev is allowed.",
      );
    }

    const parsed = new URL(databaseUrl);

    if (
      !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
      parsed.port !== "5433" ||
      parsed.pathname !== "/plv_site_monitor_dev"
    ) {
      throw new Error(
        "Unsafe database target. Only local plv_site_monitor_dev is allowed.",
      );
    }

    const [
      clientModule,
      schemaModule,
      analyticsModule,
      drizzleModule,
      writerModule,
    ] = await Promise.all([
      import("../../db/client"),
      import("../../db/schema"),
      import("../../db/analytics-schema"),
      import("drizzle-orm"),
      import("../../netlify/functions/_shared/analytics/aggregate-writer"),
    ]);

    db = clientModule.db;
    pool = clientModule.pool;
    sites = schemaModule.sites;

    overview = analyticsModule.analyticsDailyOverview;
    pages = analyticsModule.analyticsDailyPages;
    sources = analyticsModule.analyticsDailySources;
    devices = analyticsModule.analyticsDailyDevices;
    locations = analyticsModule.analyticsDailyLocations;
    memberships = analyticsModule.analyticsDailyMemberships;

    eq = drizzleModule.eq;
    and = drizzleModule.and;

    writePageViewAggregates = writerModule.writePageViewAggregates;

    siteId = randomUUID();

    await db.insert(sites).values({
      id: siteId,
      name: "Analytics Aggregate Writer Test",
      status: "active",
      timezone: "UTC",
    });
  });

  async function cleanup() {
    await db.delete(memberships).where(eq(memberships.siteId, siteId));
    await db.delete(locations).where(eq(locations.siteId, siteId));
    await db.delete(devices).where(eq(devices.siteId, siteId));
    await db.delete(sources).where(eq(sources.siteId, siteId));
    await db.delete(pages).where(eq(pages.siteId, siteId));
    await db.delete(overview).where(eq(overview.siteId, siteId));
  }

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    if (db && siteId) {
      await cleanup();
      await db.delete(sites).where(eq(sites.id, siteId));
    }

    if (pool) {
      await pool.end();
    }
  });

  async function write(input: Partial<AggregateInput> = {}) {
    return db.transaction((tx) =>
      writePageViewAggregates(tx, {
        siteId,
        ...baseInput,
        ...input,
      }),
    );
  }

  async function getOverview() {
    const rows = await db
      .select()
      .from(overview)
      .where(eq(overview.siteId, siteId));

    return rows[0];
  }

  async function getRows(table: any) {
    return db.select().from(table).where(eq(table.siteId, siteId));
  }

  it("AN-AGG-01：首次 Page View 创建 Overview 统计", async () => {
    await write();

    const row = await getOverview();

    expect(row).toBeDefined();
    expect(row!.pageViews).toBe(1n);
    expect(row!.visitors).toBe(1n);
    expect(row!.sessions).toBe(1n);
  });

  it("AN-AGG-02：同一 Visitor 再次访问，PV 增加但 UV 不增加", async () => {
    await write();
    await write();

    const row = await getOverview();

    expect(row!.pageViews).toBe(2n);
    expect(row!.visitors).toBe(1n);
  });

  it("AN-AGG-03：不同 Visitor 访问，UV 增加", async () => {
    await write();
    await write({ visitorKey: "b".repeat(64) });

    const row = await getOverview();

    expect(row!.pageViews).toBe(2n);
    expect(row!.visitors).toBe(2n);
  });

  it("AN-AGG-04：同一 Session 多次访问，Sessions 只计一次", async () => {
    await write();
    await write({
      pagePath: "/about",
      visitorKey: "b".repeat(64),
    });

    const row = await getOverview();

    expect(row!.sessions).toBe(1n);
  });

  it("AN-AGG-05：不同 Page Path 分别统计", async () => {
    await write({ pagePath: "/" });
    await write({ pagePath: "/about" });

    const rows = await getRows(pages);

    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.pageViews, 0n)).toBe(2n);
  });

  it("AN-AGG-06：Source 和 UTM 维度分别统计", async () => {
    await write();

    const rows = await getRows(sources);

    expect(rows.length).toBeGreaterThanOrEqual(4);

    expect(
      rows.some(
        (row) =>
          row.dimension === "referrer_host" &&
          row.dimensionValue === "google.com",
      ),
    ).toBe(true);

    expect(
      rows.some(
        (row) =>
          row.dimension === "utm_source" &&
          row.dimensionValue === "google",
      ),
    ).toBe(true);

    expect(
      rows.some(
        (row) =>
          row.dimension === "utm_medium" &&
          row.dimensionValue === "organic",
      ),
    ).toBe(true);

    expect(
      rows.some(
        (row) =>
          row.dimension === "utm_campaign" &&
          row.dimensionValue === "launch",
      ),
    ).toBe(true);
  });

  it("AN-AGG-07：Browser、OS、Device Type 分别统计", async () => {
    await write();

    const rows = await getRows(devices);

    expect(
      rows.some(
        (row) =>
          row.dimension === "browser" &&
          row.dimensionValue === "Chrome",
      ),
    ).toBe(true);

    expect(
      rows.some(
        (row) => row.dimension === "os" && row.dimensionValue === "Windows",
      ),
    ).toBe(true);

    expect(
      rows.some(
        (row) =>
          row.dimension === "device_type" &&
          row.dimensionValue === "desktop",
      ),
    ).toBe(true);
  });

  it("AN-AGG-08：Location 组合维度分别统计", async () => {
    await write();

    const rows = await getRows(locations);

    expect(rows).toHaveLength(1);
    expect(rows[0].countryCode).toBe("US");
    expect(rows[0].region).toBe("California");
    expect(rows[0].city).toBe("San Jose");
  });

  it("AN-AGG-09：NULL 与空字符串维度正确区分", async () => {
    await write({ referrerHost: null });
    await write({
      referrerHost: "",
      visitorKey: "b".repeat(64),
      sessionKey: "t".repeat(64),
    });

    const rows = await getRows(sources).then((items) =>
      items.filter((row) => row.dimension === "referrer_host"),
    );

    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.dimensionValue === null)).toBe(true);
    expect(rows.some((row) => row.dimensionValue === "")).toBe(true);
  });

  it("AN-AGG-10：不同日期和 Timezone 分别统计", async () => {
    await write();

    await write({
      statDate: "2026-11-12",
      visitorKey: "b".repeat(64),
      sessionKey: "t".repeat(64),
    });

    await write({
      timezone: "Asia/Shanghai",
      visitorKey: "c".repeat(64),
      sessionKey: "u".repeat(64),
    });

    const rows = await getRows(overview);

    expect(rows).toHaveLength(3);
  });

  it("AN-AGG-11：并发写入同一 Visitor，UV 只增加一次", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        write({
          pagePath: `/page-${index}`,
          sessionKey: "s".repeat(64),
        }),
      ),
    );

    const row = await getOverview();

    expect(row!.pageViews).toBe(10n);
    expect(row!.visitors).toBe(1n);
    expect(row!.sessions).toBe(1n);
  });

  it("AN-AGG-12：事务失败时 Aggregate 和 Membership 一起回滚", async () => {
    await expect(
      db.transaction(async (tx) => {
        await writePageViewAggregates(tx, {
          siteId,
          ...baseInput,
        });

        throw new Error("FORCE_ROLLBACK");
      }),
    ).rejects.toThrow("FORCE_ROLLBACK");

    expect(await getRows(overview)).toHaveLength(0);
    expect(await getRows(memberships)).toHaveLength(0);
  });
});

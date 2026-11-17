
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

let db: typeof import("../../db/client").db;
let pool: typeof import("../../db/client").pool;
let sites: typeof import("../../db/schema").sites;
let memberships:
  typeof import("../../db/analytics-schema").analyticsDailyMemberships;
let eq: typeof import("drizzle-orm").eq;

let insertDailyMembership: typeof import(
  "../../netlify/functions/_shared/analytics/membership"
)["insertDailyMembership"];

let siteId: string;

type MembershipInput = {
  statDate: string;
  timezone: string;
  dimension:
    | "overview"
    | "page"
    | "referrer_host"
    | "utm_source"
    | "utm_medium"
    | "utm_campaign"
    | "browser"
    | "os"
    | "device_type"
    | "location";
  dimensionKey: string;
  subjectType: "visitor" | "session";
  subjectKey: string;
  subjectKeyVersion: number;
};

const baseInput: MembershipInput = {
  statDate: "2026-11-11",
  timezone: "UTC",
  dimension: "overview",
  dimensionKey: "all",
  subjectType: "visitor",
  subjectKey: "a".repeat(64),
  subjectKeyVersion: 1,
};

describe("Analytics Daily Membership", () => {
  beforeEach(async () => {
    await db.delete(memberships).where(eq(memberships.siteId, siteId));
  });

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
      membershipModule,
    ] = await Promise.all([
      import("../../db/client"),
      import("../../db/schema"),
      import("../../db/analytics-schema"),
      import("drizzle-orm"),
      import("../../netlify/functions/_shared/analytics/membership"),
    ]);

    db = clientModule.db;
    pool = clientModule.pool;
    sites = schemaModule.sites;
    memberships = analyticsModule.analyticsDailyMemberships;
    eq = drizzleModule.eq;
    insertDailyMembership = membershipModule.insertDailyMembership;

    siteId = randomUUID();

    await db.insert(sites).values({
      id: siteId,
      name: "Analytics Membership Test",
      status: "active",
      timezone: "UTC",
    });
  });

  afterAll(async () => {
    if (db && siteId) {
      await db
        .delete(memberships)
        .where(eq(memberships.siteId, siteId));

      await db.delete(sites).where(eq(sites.id, siteId));
    }

    if (pool) {
      await pool.end();
    }
  });

  async function insert(input: Partial<typeof baseInput> = {}) {
    return db.transaction((tx) =>
      insertDailyMembership(tx, {
        siteId,
        ...baseInput,
        ...input,
      }),
    );
  }

  async function getMemberships() {
    return db
      .select()
      .from(memberships)
      .where(eq(memberships.siteId, siteId));
  }

  it("AN-MEMBER-01：首次 Visitor 应成功插入", async () => {
    const inserted = await insert();

    expect(inserted).toBe(true);
    expect(await getMemberships()).toHaveLength(1);
  });

  it("AN-MEMBER-02：同一 Visitor 重复插入应被忽略", async () => {
    const first = await insert();
    const second = await insert();

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await getMemberships()).toHaveLength(1);
  });

  it("AN-MEMBER-03：不同 Visitor 应分别插入", async () => {
    await insert();

    const second = await insert({
      subjectKey: "b".repeat(64),
    });

    expect(second).toBe(true);
    expect(await getMemberships()).toHaveLength(2);
  });

  it("AN-MEMBER-04：不同日期应分别计数", async () => {
    await insert();

    const second = await insert({
      statDate: "2026-11-12",
    });

    expect(second).toBe(true);
    expect(await getMemberships()).toHaveLength(2);
  });

  it("AN-MEMBER-05：不同维度应分别计数", async () => {
    await insert();

    const second = await insert({
      dimension: "page",
      dimensionKey: "page-home",
    });

    expect(second).toBe(true);
    expect(await getMemberships()).toHaveLength(2);
  });

  it("AN-MEMBER-06：不同 Key Version 应分别计数", async () => {
    await insert();

    const second = await insert({
      subjectKeyVersion: 2,
    });

    expect(second).toBe(true);
    expect(await getMemberships()).toHaveLength(2);
  });

  it("AN-MEMBER-07：不同 Subject Type 应分别计数", async () => {
    await insert();

    const second = await insert({
      subjectType: "session",
    });

    expect(second).toBe(true);
    expect(await getMemberships()).toHaveLength(2);
  });

  it("AN-MEMBER-08：并发插入同一 Visitor 只能成功一次", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => insert()),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => !value)).toHaveLength(9);
    expect(await getMemberships()).toHaveLength(1);
  });
});

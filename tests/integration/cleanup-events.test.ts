
import {
  afterAll,
  beforeAll,
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
let pageEvents: typeof import("../../db/schema").pageEvents;

let analyticsEventFacts: typeof import(
  "../../db/analytics-schema"
).analyticsEventFacts;

let analyticsSessionFacts: typeof import(
  "../../db/analytics-schema"
).analyticsSessionFacts;

let analyticsDailyOverview: typeof import(
  "../../db/analytics-schema"
).analyticsDailyOverview;

let analyticsDailyPages: typeof import(
  "../../db/analytics-schema"
).analyticsDailyPages;

let analyticsDailySources: typeof import(
  "../../db/analytics-schema"
).analyticsDailySources;

let analyticsDailyDevices: typeof import(
  "../../db/analytics-schema"
).analyticsDailyDevices;

let analyticsDailyLocations: typeof import(
  "../../db/analytics-schema"
).analyticsDailyLocations;

let analyticsDailyMemberships: typeof import(
  "../../db/analytics-schema"
).analyticsDailyMemberships;

let eq: typeof import("drizzle-orm").eq;

let cleanupExpiredEvents: typeof import(
  "../../netlify/functions/_shared/event-retention"
)["cleanupExpiredEvents"];

describe("Event Retention Integration", () => {
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
      analyticsSchemaModule,
      drizzleModule,
      retentionModule,
    ] = await Promise.all([
      import("../../db/client"),
      import("../../db/schema"),
      import("../../db/analytics-schema"),
      import("drizzle-orm"),
      import("../../netlify/functions/_shared/event-retention"),
    ]);

    db = clientModule.db;
    pool = clientModule.pool;

    sites = schemaModule.sites;
    pageEvents = schemaModule.pageEvents;

    analyticsEventFacts =
      analyticsSchemaModule.analyticsEventFacts;

    analyticsSessionFacts =
      analyticsSchemaModule.analyticsSessionFacts;

    analyticsDailyOverview =
      analyticsSchemaModule.analyticsDailyOverview;

    analyticsDailyPages =
      analyticsSchemaModule.analyticsDailyPages;

    analyticsDailySources =
      analyticsSchemaModule.analyticsDailySources;

    analyticsDailyDevices =
      analyticsSchemaModule.analyticsDailyDevices;

    analyticsDailyLocations =
      analyticsSchemaModule.analyticsDailyLocations;

    analyticsDailyMemberships =
      analyticsSchemaModule.analyticsDailyMemberships;

    eq = drizzleModule.eq;

    cleanupExpiredEvents =
      retentionModule.cleanupExpiredEvents;
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("should delete expired raw events and preserve cutoff boundary and Analytics data", async () => {
    const siteId = randomUUID();

    const expiredEventId = randomUUID();
    const cutoffEventId = randomUUID();
    const recentEventId = randomUUID();

    const now = new Date("2026-11-12T12:00:00.000Z");

    const retentionDays = 30;

    const cutoff = new Date(
      now.getTime() -
        retentionDays * 24 * 60 * 60 * 1000,
    );

    const expiredReceivedAt = new Date(
      cutoff.getTime() - 1,
    );

    const recentReceivedAt = new Date(
      cutoff.getTime() + 1,
    );

    const rollbackSignal = new Error(
      "ROLLBACK_EVENT_RETENTION_TEST",
    );

    try {
      await db.transaction(async (tx) => {
        await tx.insert(sites).values({
          id: siteId,
          name: "Event Retention Integration Test",
          status: "active",
          timezone: "UTC",
        });

        // 创建三条原始事件：
        // 1. cutoff 之前：应该删除
        // 2. 恰好 cutoff：应该保留
        // 3. cutoff 之后：应该保留
        await tx.insert(pageEvents).values([
          {
            siteId,
            eventId: expiredEventId,
            visitorId: randomUUID(),
            sessionId: randomUUID(),
            pageUrl: "https://event-retention-test.example/expired",
            pagePath: "/expired",
            occurredAt: expiredReceivedAt,
            receivedAt: expiredReceivedAt,
          },
          {
            siteId,
            eventId: cutoffEventId,
            visitorId: randomUUID(),
            sessionId: randomUUID(),
            pageUrl: "https://event-retention-test.example/cutoff",
            pagePath: "/cutoff",
            occurredAt: cutoff,
            receivedAt: cutoff,
          },
          {
            siteId,
            eventId: recentEventId,
            visitorId: randomUUID(),
            sessionId: randomUUID(),
            pageUrl: "https://event-retention-test.example/recent",
            pagePath: "/recent",
            occurredAt: recentReceivedAt,
            receivedAt: recentReceivedAt,
          },
        ]);

        // 为已过期的原始事件创建长期 Analytics 事实。
        // 即使 page_events 被删除，这些事实也必须保留。
        await tx.insert(analyticsEventFacts).values({
          siteId,
          eventId: expiredEventId,
          receivedAt: expiredReceivedAt,
          occurredAt: expiredReceivedAt,
          statDate: "2026-10-13",
          timezone: "UTC",
          visitorKey: "event-retention-visitor",
          visitorKeyVersion: 1,
          sessionKey: "event-retention-session",
          sessionKeyVersion: 1,
          pagePath: "/expired",
        });

        await tx.insert(analyticsSessionFacts).values({
          siteId,
          sessionKey: "event-retention-session",
          sessionKeyVersion: 1,
          visitorKey: "event-retention-visitor",
          visitorKeyVersion: 1,
          sessionModelVersion: 2,
          startedAt: expiredReceivedAt,
          lastActivityAt: expiredReceivedAt,
          endedAt: expiredReceivedAt,
          timezone: "UTC",
          statDate: "2026-10-13",
          entryPage: "/expired",
          exitPage: "/expired",
          pageViewCount: 1,
          status: "completed",
        });

        // Daily Overview
        await tx.insert(analyticsDailyOverview).values({
          siteId,
          statDate: "2026-10-13",
          timezone: "UTC",
          pageViews: 1n,
          visitors: 1n,
          sessions: 1n,
        });

        // Daily Pages
        await tx.insert(analyticsDailyPages).values({
          siteId,
          statDate: "2026-10-13",
          timezone: "UTC",
          pagePath: "/expired",
          pageViews: 1n,
          uniqueVisitors: 1n,
        });

        // Daily Sources
        await tx.insert(analyticsDailySources).values({
          siteId,
          statDate: "2026-10-13",
          timezone: "UTC",
          dimension: "referrer_host",
          dimensionKey: "example.com",
          dimensionValue: "example.com",
          pageViews: 1n,
          uniqueVisitors: 1n,
        });

        // Daily Devices
        await tx.insert(analyticsDailyDevices).values({
          siteId,
          statDate: "2026-10-13",
          timezone: "UTC",
          dimension: "browser",
          dimensionKey: "chrome",
          dimensionValue: "Chrome",
          pageViews: 1n,
          uniqueVisitors: 1n,
        });

        // Daily Locations
        await tx.insert(analyticsDailyLocations).values({
          siteId,
          statDate: "2026-10-13",
          timezone: "UTC",
          countryCode: "US",
          region: "California",
          city: "San Jose",
          dimensionKey: "US-California-San Jose",
          pageViews: 1n,
          uniqueVisitors: 1n,
        });

        // Daily Memberships
        await tx.insert(analyticsDailyMemberships).values({
          siteId,
          statDate: "2026-10-13",
          timezone: "UTC",
          dimension: "overview",
          dimensionKey: "overview",
          subjectType: "visitor",
          subjectKey: "event-retention-visitor",
          subjectKeyVersion: 1,
        });

        // 在事务内执行真实 PostgreSQL 清理。
        // 服务没有 siteId 过滤条件，因此清理结果在事务回滚后不会持久化。
        const result = await cleanupExpiredEvents(
          tx as unknown as typeof db,
          retentionDays,
          now,
        );

        expect(result.cutoff.toISOString()).toBe(
          cutoff.toISOString(),
        );

        expect(result.deletedCount).toBeGreaterThanOrEqual(1);

        // 验证过期原始事件已删除。
        const expiredEvents = await tx
          .select()
          .from(pageEvents)
          .where(eq(pageEvents.eventId, expiredEventId));

        expect(expiredEvents).toHaveLength(0);

        // 验证 cutoff 边界事件仍然存在。
        const cutoffEvents = await tx
          .select()
          .from(pageEvents)
          .where(eq(pageEvents.eventId, cutoffEventId));

        expect(cutoffEvents).toHaveLength(1);
        expect(cutoffEvents[0].receivedAt.getTime()).toBe(
          cutoff.getTime(),
        );

        // 验证 cutoff 之后的事件仍然存在。
        const recentEvents = await tx
          .select()
          .from(pageEvents)
          .where(eq(pageEvents.eventId, recentEventId));

        expect(recentEvents).toHaveLength(1);

        // 验证 Analytics Event Facts 不受影响。
        const eventFacts = await tx
          .select()
          .from(analyticsEventFacts)
          .where(eq(analyticsEventFacts.siteId, siteId));

        expect(eventFacts).toHaveLength(1);
        expect(eventFacts[0].eventId).toBe(expiredEventId);

        // 验证 Analytics Session Facts 不受影响。
        const sessionFacts = await tx
          .select()
          .from(analyticsSessionFacts)
          .where(eq(analyticsSessionFacts.siteId, siteId));

        expect(sessionFacts).toHaveLength(1);

        // 验证六张 Daily Aggregates / Membership 表不受影响。
        const dailyOverview = await tx
          .select()
          .from(analyticsDailyOverview)
          .where(eq(analyticsDailyOverview.siteId, siteId));

        const dailyPages = await tx
          .select()
          .from(analyticsDailyPages)
          .where(eq(analyticsDailyPages.siteId, siteId));

        const dailySources = await tx
          .select()
          .from(analyticsDailySources)
          .where(eq(analyticsDailySources.siteId, siteId));

        const dailyDevices = await tx
          .select()
          .from(analyticsDailyDevices)
          .where(eq(analyticsDailyDevices.siteId, siteId));

        const dailyLocations = await tx
          .select()
          .from(analyticsDailyLocations)
          .where(eq(analyticsDailyLocations.siteId, siteId));

        const dailyMemberships = await tx
          .select()
          .from(analyticsDailyMemberships)
          .where(eq(analyticsDailyMemberships.siteId, siteId));

        expect(dailyOverview).toHaveLength(1);
        expect(dailyPages).toHaveLength(1);
        expect(dailySources).toHaveLength(1);
        expect(dailyDevices).toHaveLength(1);
        expect(dailyLocations).toHaveLength(1);
        expect(dailyMemberships).toHaveLength(1);

        // 主动抛出标记异常，让 PostgreSQL 回滚整个事务。
        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) {
        throw error;
      }
    }

    // 验证事务回滚后，测试站点及所有测试数据均未留下。
    const remainingSites = await db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId));

    const remainingEvents = await db
      .select()
      .from(pageEvents)
      .where(eq(pageEvents.siteId, siteId));

    const remainingEventFacts = await db
      .select()
      .from(analyticsEventFacts)
      .where(eq(analyticsEventFacts.siteId, siteId));

    const remainingSessionFacts = await db
      .select()
      .from(analyticsSessionFacts)
      .where(eq(analyticsSessionFacts.siteId, siteId));

    expect(remainingSites).toHaveLength(0);
    expect(remainingEvents).toHaveLength(0);
    expect(remainingEventFacts).toHaveLength(0);
    expect(remainingSessionFacts).toHaveLength(0);
  });
});

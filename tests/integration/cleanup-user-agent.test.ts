
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

import { drizzle } from "drizzle-orm/node-postgres";
import { getOverviewStats } from "../../netlify/functions/_shared/analytics/overview-service";

dotenv.config();

const LOCAL_DATABASE_URL =
  "postgresql://plv_dev:plv_local_dev_2026@localhost:5433/plv_site_monitor_dev";

let db: typeof import("../../db/client").db;
let pool: typeof import("../../db/client").pool;
let sites: typeof import("../../db/schema").sites;
let pageEvents: typeof import("../../db/schema").pageEvents;
let eq: typeof import("drizzle-orm").eq;

let cleanupExpiredUserAgents: typeof import(
  "../../netlify/functions/_shared/user-agent-retention"
)["cleanupExpiredUserAgents"];

let cleanupExpiredIpAddresses: typeof import(
  "../../netlify/functions/_shared/ip-retention"
)["cleanupExpiredIpAddresses"];

describe("User-Agent Retention Integration", () => {
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
      drizzleModule,
      retentionModule,
      ipRetentionModule,
    ] = await Promise.all([
      import("../../db/client"),
      import("../../db/schema"),
      import("drizzle-orm"),
      import("../../netlify/functions/_shared/user-agent-retention"),
      import("../../netlify/functions/_shared/ip-retention"),
    ]);

    db = clientModule.db;
    pool = clientModule.pool;
    sites = schemaModule.sites;
    pageEvents = schemaModule.pageEvents;
    eq = drizzleModule.eq;

    cleanupExpiredUserAgents = retentionModule.cleanupExpiredUserAgents;
    cleanupExpiredIpAddresses = ipRetentionModule.cleanupExpiredIpAddresses;
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("should clear expired User-Agent values and preserve recent events", async () => {
    const siteId = randomUUID();
    const expiredEventId = randomUUID();
    const recentEventId = randomUUID();

    const now = new Date();
    const expiredReceivedAt = new Date(
      now.getTime() - 31 * 24 * 60 * 60 * 1000,
    );

    const rollbackSignal = new Error(
      "ROLLBACK_USER_AGENT_RETENTION_TEST",
    );

    try {
      await db.transaction(async (tx) => {
        await tx.insert(sites).values({
          id: siteId,
          name: "User-Agent Retention Integration Test",
          status: "active",
          timezone: "UTC",
        });

        await tx.insert(pageEvents).values([
          {
            siteId,
            eventId: expiredEventId,
            visitorId: randomUUID(),
            sessionId: randomUUID(),
            pageUrl: "https://ua-retention-test.example/expired",
            pagePath: "/expired",
            occurredAt: expiredReceivedAt,
            receivedAt: expiredReceivedAt,
            userAgent: "Expired-Test-User-Agent",
            ipAddress: "203.0.113.10",
          },
          {
            siteId,
            eventId: recentEventId,
            visitorId: randomUUID(),
            sessionId: randomUUID(),
            pageUrl: "https://ua-retention-test.example/recent",
            pagePath: "/recent",
            occurredAt: now,
            receivedAt: now,
            userAgent: "Recent-Test-User-Agent",
            ipAddress: "198.51.100.20",
          },
        ]);

        // 清理服务当前没有 siteId 过滤条件。
        // 在事务中执行全局清理，最后整体回滚，避免持久化修改。
        const cleanedCount = await cleanupExpiredUserAgents(
          tx as unknown as typeof db,
          30,
          now,
        );

        expect(cleanedCount).toBeGreaterThanOrEqual(1);

        const [expiredEvent] = await tx
          .select()
          .from(pageEvents)
          .where(eq(pageEvents.eventId, expiredEventId))
          .limit(1);

        const [recentEvent] = await tx
          .select()
          .from(pageEvents)
          .where(eq(pageEvents.eventId, recentEventId))
          .limit(1);

        expect(expiredEvent).toBeDefined();
        expect(expiredEvent.userAgent).toBeNull();
        expect(expiredEvent.ipAddress).not.toBeNull();
        expect(expiredEvent.pagePath).toBe("/expired");

        expect(recentEvent).toBeDefined();
        expect(recentEvent.userAgent).toBe("Recent-Test-User-Agent");
        expect(recentEvent.ipAddress).not.toBeNull();
        expect(recentEvent.pagePath).toBe("/recent");

        // 主动抛出标记异常，让 PostgreSQL 回滚整个事务。
        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) {
        throw error;
      }
    }

    // 确认事务回滚后，测试站点和事件均未留下。
    const remainingSites = await db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId));

    const remainingEvents = await db
      .select()
      .from(pageEvents)
      .where(eq(pageEvents.siteId, siteId));

    expect(remainingSites).toHaveLength(0);
    expect(remainingEvents).toHaveLength(0);
  });


it("should preserve IP and User-Agent independence during consecutive cleanup", async () => {
  const siteId = randomUUID();

  const now = new Date("2026-11-13T12:00:00.000Z");

  const events = [
    { daysAgo: 31, name: "both-expired" },
    { daysAgo: 25, name: "ua-expired-25" },
    { daysAgo: 21, name: "ua-expired-21" },
    { daysAgo: 10, name: "both-retained" },
  ].map((item) => ({
    eventId: randomUUID(),
    name: item.name,
    receivedAt: new Date(
      now.getTime() - item.daysAgo * 24 * 60 * 60 * 1000,
    ),
  }));

  const rollbackSignal = new Error(
    "ROLLBACK_IP_UA_INDEPENDENCE_TEST",
  );

  try {
    await db.transaction(async (tx) => {
      await tx.insert(sites).values({
        id: siteId,
        name: "IP UA Independence Integration Test",
        status: "active",
        timezone: "UTC",
      });

      await tx.insert(pageEvents).values(
        events.map((event) => ({
          siteId,
          eventId: event.eventId,
          visitorId: randomUUID(),
          sessionId: randomUUID(),
          pageUrl: `https://retention-test.example/${event.name}`,
          pagePath: `/${event.name}`,
          occurredAt: event.receivedAt,
          receivedAt: event.receivedAt,
          userAgent: `Test-UA-${event.name}`,
          ipAddress: "203.0.113.10",
          countryCode: "US",
          region: "California",
          city: "San Jose",
        })),
      );

      // 第一步：执行 IP 清理，保留 30 天。
      const ipCleanedCount = await cleanupExpiredIpAddresses(
        tx as unknown as typeof db,
        30,
        now,
      );

      expect(ipCleanedCount).toBe(1);

      const afterIpCleanup = await tx
        .select()
        .from(pageEvents)
        .where(eq(pageEvents.siteId, siteId));

      expect(afterIpCleanup).toHaveLength(4);

      for (const event of events) {
        const record = afterIpCleanup.find(
          (item) => item.eventId === event.eventId,
        );

        expect(record).toBeDefined();

        if (event.name === "both-expired") {
          expect(record!.ipAddress).toBeNull();
        } else {
          expect(record!.ipAddress).toBe("203.0.113.10");
        }

        // IP 清理不得修改 UA。
        expect(record!.userAgent).toBe(`Test-UA-${event.name}`);
      }

      // 第二步：执行 UA 清理，保留 20 天。
      await cleanupExpiredUserAgents(
        tx as unknown as typeof db,
        20,
        now,
      );

      const afterBothCleanup = await tx
        .select()
        .from(pageEvents)
        .where(eq(pageEvents.siteId, siteId));

      expect(afterBothCleanup).toHaveLength(4);

      for (const event of events) {
        const record = afterBothCleanup.find(
          (item) => item.eventId === event.eventId,
        );

        expect(record).toBeDefined();

        const bothExpired = event.name === "both-expired";
        const uaExpired =
          event.name === "ua-expired-25" ||
          event.name === "ua-expired-21";

        // UA 清理只清理符合 UA 保留期限的记录。
        expect(record!.userAgent).toBe(
          bothExpired || uaExpired
            ? null
            : `Test-UA-${event.name}`,
        );

        // 清理不应影响其他事件字段。
        expect(record!.pagePath).toBe(`/${event.name}`);
        expect(record!.countryCode).toBe("US");
        expect(record!.region).toBe("California");
        expect(record!.city).toBe("San Jose");
      }

      // 主动抛出标记异常，回滚整个测试事务。
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) {
      throw error;
    }
  }

  // 确认事务回滚，没有留下测试数据。
  const remainingSites = await db
    .select()
    .from(sites)
    .where(eq(sites.id, siteId));

  const remainingEvents = await db
    .select()
    .from(pageEvents)
    .where(eq(pageEvents.siteId, siteId));

  expect(remainingSites).toHaveLength(0);
  expect(remainingEvents).toHaveLength(0);
});

it("should preserve Overview statistics after User-Agent cleanup", async () => {
  const siteId = randomUUID();

  const now = new Date("2026-11-13T12:00:00.000Z");
  // 覆盖 31 天前的过期事件，同时包含当前事件。
  const start = new Date(
    now.getTime() - 32 * 24 * 60 * 60 * 1000,
  );

  const end = new Date(
    now.getTime() + 24 * 60 * 60 * 1000,
  );

  const expiredReceivedAt = new Date(
    now.getTime() - 31 * 24 * 60 * 60 * 1000,
  );

  const events = [
    {
      visitorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionId: "accb07ee-6504-4855-b25b-4a5bf22d8164",
      userAgent: "Test-UA-A",
      pagePath: "/overview-a",
      receivedAt: expiredReceivedAt,
      ipAddress: "203.0.113.10",
    },
    {
      visitorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionId: "accb07ee-6504-4855-b25b-4a5bf22d8164",
      userAgent: "Test-UA-B",
      pagePath: "/overview-b",
      receivedAt: expiredReceivedAt,
      ipAddress: "203.0.113.11",
    },
    {
      visitorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sessionId: "22222222-2222-4222-8222-222222222222",
      userAgent: "Test-UA-C",
      pagePath: "/overview-c",
      receivedAt: expiredReceivedAt,
      ipAddress: "203.0.113.12",
    },
    {
      visitorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sessionId: "33333333-3333-4333-8333-333333333333",
      userAgent: "Test-UA-D",
      pagePath: "/overview-d",
      receivedAt: now,
      ipAddress: "203.0.113.13",
    },
  ];

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Drizzle 和 Overview 查询共用同一个 PostgreSQL Client。
    const transactionDb = drizzle({ client });

    await transactionDb.insert(sites).values({
      id: siteId,
      name: "UA Overview Consistency Integration Test",
      status: "active",
      timezone: "UTC",
    });

    await transactionDb.insert(pageEvents).values(
      events.map((event) => ({
        siteId,
        eventId: randomUUID(),
        visitorId: event.visitorId,
        sessionId: event.sessionId,
        pageUrl: `https://ua-overview-test.example${event.pagePath}`,
        pagePath: event.pagePath,
        occurredAt: event.receivedAt,
        receivedAt: event.receivedAt,
        userAgent: event.userAgent,
        ipAddress: event.ipAddress,
      })),
    );

    // 第一步：清理前，调用真实 Overview 查询服务。
    const beforeCleanup = await getOverviewStats(
      client,
      siteId,
      start,
      end,
    );

    expect(beforeCleanup).toEqual({
      pv: 4,
      uv: 3,
      sessions: 3,
      bounce_sessions: 2,
      bounce_rate: 66.67,
    });

    // 第二步：执行真实 UA 清理。
    const cleanedCount = await cleanupExpiredUserAgents(
      transactionDb as unknown as typeof db,
      30,
      now,
    );

    // 清理服务执行全局清理，至少应包含本测试的 3 条过期事件。
    expect(cleanedCount).toBeGreaterThanOrEqual(3);

    // 第三步：检查原始事件。
    const remainingEvents = await transactionDb
      .select()
      .from(pageEvents)
      .where(eq(pageEvents.siteId, siteId));

    expect(remainingEvents).toHaveLength(4);

    for (const event of events) {
      const record = remainingEvents.find(
        (item) =>
          item.visitorId === event.visitorId &&
          item.pagePath === event.pagePath,
      );

      expect(record).toBeDefined();

      if (event.pagePath === "/overview-d") {
        expect(record!.userAgent).toBe("Test-UA-D");
      } else {
        expect(record!.userAgent).toBeNull();
      }

      expect(record!.ipAddress).toBe(event.ipAddress);
      expect(record!.sessionId).toBe(event.sessionId);
      expect(record!.visitorId).toBe(event.visitorId);
      expect(record!.pagePath).toBe(event.pagePath);
    }

    // 第四步：清理后，再次调用真实 Overview 查询服务。
    const afterCleanup = await getOverviewStats(
      client,
      siteId,
      start,
      end,
    );

    expect(afterCleanup).toEqual(beforeCleanup);

    // 第五步：明确验证五项指标。
    expect(afterCleanup).toEqual({
      pv: 4,
      uv: 3,
      sessions: 3,
      bounce_sessions: 2,
      bounce_rate: 66.67,
    });
  } finally {
    // 无论断言是否通过，都回滚测试数据。
    await client.query("ROLLBACK");
    client.release();
  }

  // 确认测试站点和事件没有持久化。
  const remainingSites = await db
    .select()
    .from(sites)
    .where(eq(sites.id, siteId));

  const remainingTestEvents = await db
    .select()
    .from(pageEvents)
    .where(eq(pageEvents.siteId, siteId));

  expect(remainingSites).toHaveLength(0);
  expect(remainingTestEvents).toHaveLength(0);
});

});

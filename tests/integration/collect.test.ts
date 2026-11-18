
import { randomUUID } from "node:crypto";
import type { Context } from "@netlify/functions";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 仅允许连接本地开发数据库，防止误操作正式数据库。
const LOCAL_DATABASE_URL =
  "postgresql://plv_dev:plv_local_dev_2026@localhost:5433/plv_site_monitor_dev";

let db: typeof import("../../db/client").db;
let pool: typeof import("../../db/client").pool;
let sites: typeof import("../../db/schema").sites;
let siteDomains: typeof import("../../db/schema").siteDomains;
let pageEvents: typeof import("../../db/schema").pageEvents;
let analyticsSchema: typeof import("../../db/analytics-schema");
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;
let cleanupExpiredIpAddresses:
  typeof import("../../netlify/functions/_shared/ip-retention").cleanupExpiredIpAddresses;
let collectHandler: (
  request: Request,
  context: Context,
) => Promise<Response>;

let systemSettings: typeof import("../../db/system-settings-schema").systemSettings;

let getSystemSettings: typeof import("../../netlify/functions/_shared/settings/settings-service").getSystemSettings;

const siteId = randomUUID();
const eventId = randomUUID();
const visitorId = randomUUID();
const sessionId = randomUUID();
const domain = `it-${randomUUID()}.example.test`;

const payload = {
  site_id: siteId,
  event_id: eventId,
  event_type: "page_view",
  visitor_id: visitorId,
  session_id: sessionId,
  page_url: `https://${domain}/products?utm_source=integration`,
  page_path: "/this-path-should-be-ignored",
  page_title: "Integration Test Page",
  referrer: "https://google.com/search",
  occurred_at: "2026-11-05T10:00:00.000Z",
  utm_source: "integration",
  utm_medium: "test",
  utm_campaign: "it-01",
  utm_term: null,
  utm_content: null,
};

const context = {
  ip: "203.0.113.10",
  geo: {
    country: { code: "US" },
    subdivision: { name: "California" },
    city: "San Jose",
  },
} as unknown as Context;

function createRequest(body: unknown): Request {
  return new Request("http://localhost:8888/api/collect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `https://${domain}`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(body),
  });
}

function createRawRequest(
  body: string,
  options: {
    origin?: string;
    contentType?: string;
    method?: string;
  } = {},
): Request {
  const headers = new Headers();

  if (options.origin !== undefined) {
    headers.set("Origin", options.origin);
  }

  if (options.contentType !== undefined) {
    headers.set("Content-Type", options.contentType);
  }

  return new Request("http://localhost:8888/api/collect", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "OPTIONS" ? undefined : body,
  });
}
interface CollectSuccessBody {
  success: true;
  data: {
    event_id: string;
    received_at: string;
  };
}

interface CollectErrorBody {
  error: {
    code: string;
  };
}

interface DuplicateEventBody {
  code: string;
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

async function readCollectSuccessJson(
  response: Response,
): Promise<CollectSuccessBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    typeof body.data.event_id !== "string" ||
    typeof body.data.received_at !== "string"
  ) {
    throw new Error("Invalid collect success response");
  }

  return {
    success: true,
    data: {
      event_id: body.data.event_id,
      received_at: body.data.received_at,
    },
  };
}

async function readCollectErrorJson(
  response: Response,
): Promise<CollectErrorBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    !isRecord(body.error) ||
    typeof body.error.code !== "string"
  ) {
    throw new Error("Invalid collect error response");
  }

  return {
    error: {
      code: body.error.code,
    },
  };
}

async function readDuplicateEventJson(
  response: Response,
): Promise<DuplicateEventBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    typeof body.code !== "string"
  ) {
    throw new Error("Invalid duplicate event response");
  }

  return {
    code: body.code,
  };
}

async function readJsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();

  if (!isRecord(body)) {
    throw new Error("Invalid JSON object response");
  }

  return body;
}

function isDuplicateEventBody(
  value: Record<string, unknown>,
): value is Record<string, unknown> & DuplicateEventBody {
  return value.code === "DUPLICATE_EVENT";
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);

  const result = await readCollectErrorJson(response);

  expect(result.error.code).toBe(code);
}

async function getSiteEventCount(): Promise<number> {
  const rows = await db
    .select()
    .from(pageEvents)
    .where(eq(pageEvents.siteId, siteId));

  return rows.length;
}

describe("POST /api/collect integration", () => {
  beforeAll(async () => {
    // 设置环境变量必须早于数据库模块导入。
    process.env.DATABASE_URL ||= LOCAL_DATABASE_URL;

    const databaseUrl = new URL(process.env.DATABASE_URL);

    if (
      !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
      databaseUrl.port !== "5433" ||
      databaseUrl.pathname !== "/plv_site_monitor_dev"
    ) {
      throw new Error(
        "Integration tests are restricted to localhost:5433/plv_site_monitor_dev",
      );
    }

    const clientModule = await import("../../db/client");
    const schemaModule = await import("../../db/schema");
    const analyticsSchemaModule = await import(
      "../../db/analytics-schema"
    );
    const drizzleModule = await import("drizzle-orm");
    const retentionModule = await import(
      "../../netlify/functions/_shared/ip-retention"
    );
    const functionModule = await import(
      "../../netlify/functions/collect.mts"
    );

    const settingsSchemaModule = await import(
      "../../db/system-settings-schema"
    );

    const settingsServiceModule = await import(
      "../../netlify/functions/_shared/settings/settings-service"
    );

    systemSettings = settingsSchemaModule.systemSettings;
    getSystemSettings = settingsServiceModule.getSystemSettings;

    db = clientModule.db;
    pool = clientModule.pool;

    sites = schemaModule.sites;
    siteDomains = schemaModule.siteDomains;
    pageEvents = schemaModule.pageEvents;
    analyticsSchema = analyticsSchemaModule;

    eq = drizzleModule.eq;
    and = drizzleModule.and;
    cleanupExpiredIpAddresses =
      retentionModule.cleanupExpiredIpAddresses;

    collectHandler = functionModule.default;

    // 创建本次测试专属站点和域名。
    await db.insert(sites).values({
      id: siteId,
      name: "Integration Test Site",
      status: "active",
      timezone: "UTC",
    });

    await db.insert(siteDomains).values({
      siteId,
      domain,
      isPrimary: true,
    });
  });
  
  afterAll(async () => {
    if (db) {
      // 检查 Analytics 表是否已经通过 Migration 创建。
      if (analyticsSchema && pool) {
        const result = await pool.query(
          `
            SELECT
              to_regclass($1) AS event_facts,
              to_regclass($2) AS session_facts,
              to_regclass($3) AS daily_overview,
              to_regclass($4) AS daily_pages,
              to_regclass($5) AS daily_sources,
              to_regclass($6) AS daily_devices,
              to_regclass($7) AS daily_locations,
              to_regclass($8) AS daily_memberships
          `,
          [
            "public.analytics_event_facts",
            "public.analytics_session_facts",
            "public.analytics_daily_overview",
            "public.analytics_daily_pages",
            "public.analytics_daily_sources",
            "public.analytics_daily_devices",
            "public.analytics_daily_locations",
            "public.analytics_daily_memberships",
          ],
        );

        const tableStates = Object.values(result.rows[0]);
        const existingCount = tableStates.filter(
          (table) => table !== null,
        ).length;

        if (existingCount === tableStates.length) {
          // 八张 Analytics 表全部存在，按外键依赖顺序清理。
          await db
            .delete(analyticsSchema.analyticsDailyMemberships)
            .where(
              eq(
                analyticsSchema.analyticsDailyMemberships.siteId,
                siteId,
              ),
            );

          await db
            .delete(analyticsSchema.analyticsDailyLocations)
            .where(
              eq(
                analyticsSchema.analyticsDailyLocations.siteId,
                siteId,
              ),
            );

          await db
            .delete(analyticsSchema.analyticsDailyDevices)
            .where(
              eq(
                analyticsSchema.analyticsDailyDevices.siteId,
                siteId,
              ),
            );

          await db
            .delete(analyticsSchema.analyticsDailySources)
            .where(
              eq(
                analyticsSchema.analyticsDailySources.siteId,
                siteId,
              ),
            );

          await db
            .delete(analyticsSchema.analyticsDailyPages)
            .where(
              eq(
                analyticsSchema.analyticsDailyPages.siteId,
                siteId,
              ),
            );

          await db
            .delete(analyticsSchema.analyticsDailyOverview)
            .where(
              eq(
                analyticsSchema.analyticsDailyOverview.siteId,
                siteId,
              ),
            );

          await db
            .delete(analyticsSchema.analyticsSessionFacts)
            .where(
              eq(
                analyticsSchema.analyticsSessionFacts.siteId,
                siteId,
              ),
            );

          await db
            .delete(analyticsSchema.analyticsEventFacts)
            .where(
              eq(
                analyticsSchema.analyticsEventFacts.siteId,
                siteId,
              ),
            );
        } else if (existingCount === 0) {
          // 当前数据库尚未执行 Analytics Migration。
          console.info(
            "[collect.test] Analytics tables do not exist. Skipping Analytics cleanup.",
          );
        } else {
          throw new Error(
            `[collect.test] Incomplete Analytics schema: ${existingCount}/8 tables exist. Check database migrations.`,
          );
        }
      }

      // 原始事件及站点关联数据。
      await db
        .delete(pageEvents)
        .where(eq(pageEvents.siteId, siteId));

      await db
        .delete(siteDomains)
        .where(eq(siteDomains.siteId, siteId));

      await db
        .delete(sites)
        .where(eq(sites.id, siteId));
    }

    if (pool) {
      await pool.end();
    }
  });

  it("IT-01：应该成功接收并写入页面访问事件", async () => {
    const response = await collectHandler(
      createRequest(payload),
      context,
    );

    expect(response.status).toBe(202);

    const result = await readCollectSuccessJson(response);

    expect(result.success).toBe(true);
    expect(result.data.event_id).toBe(eventId);
    expect(result.data.received_at).toBeTruthy();
    expect(
      new Date(result.data.received_at).getTime(),
    ).not.toBeNaN();
  });

  it("AN-IT-01：首次 Page View 应创建一条 Analytics Event Fact", async () => {
    // 使用全新的 event_id，避免与 IT-01 的事件冲突。
    const analyticsEventId = randomUUID();

    const analyticsPayload = {
      ...payload,
      event_id: analyticsEventId,
      visitor_id: randomUUID(),
      session_id: randomUUID(),
    };

    // 获取当前 UTC 统计日期。
const statDate = new Date().toISOString().slice(0, 10);

// 记录请求前的 Daily Overview。
const beforeOverview = await db
  .select()
  .from(analyticsSchema.analyticsDailyOverview)
  .where(
    and(
      eq(analyticsSchema.analyticsDailyOverview.siteId, siteId),
      eq(analyticsSchema.analyticsDailyOverview.statDate, statDate),
      eq(analyticsSchema.analyticsDailyOverview.timezone, "UTC"),
    ),
  );

const baseline = beforeOverview[0] ?? {
  pageViews: 0n,
  visitors: 0n,
  sessions: 0n,
};

    // 发送首次 Page View。
    const response = await collectHandler(
      createRequest(analyticsPayload),
      context,
    );

    const result = await readCollectSuccessJson(response);

    // 1. 验证采集接口响应。
    expect(response.status).toBe(202);
    expect(result.success).toBe(true);
    expect(result.data.event_id).toBe(analyticsEventId);

    // 2. 查询 Analytics Event Facts。
    const facts = await db
      .select()
      .from(analyticsSchema.analyticsEventFacts)
      .where(
        and(
          eq(analyticsSchema.analyticsEventFacts.siteId, siteId),
          eq(analyticsSchema.analyticsEventFacts.eventId, analyticsEventId),
        ),
      );

    // 3. 验证只创建一条记录。
    expect(facts).toHaveLength(1);

    // 4. 验证关键字段映射。
    expect(facts[0].siteId).toBe(siteId);
    expect(facts[0].eventId).toBe(analyticsEventId);
    expect(facts[0].visitorKey).toBeTruthy();
    expect(facts[0].sessionKey).toBeTruthy();
    expect(facts[0].pagePath).toBeTruthy();
    expect(facts[0].receivedAt).toBeInstanceOf(Date);


        // 5. 验证 Session Fact。
    const sessions = await db
      .select()
      .from(analyticsSchema.analyticsSessionFacts)
      .where(
        and(
          eq(analyticsSchema.analyticsSessionFacts.siteId, siteId),
          eq(
            analyticsSchema.analyticsSessionFacts.visitorKey,
            facts[0].visitorKey,
          ),
        ),
      );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].pageViewCount).toBe(1);

    // 6. 验证 Daily Overview。
    const overview = await db
      .select()
      .from(analyticsSchema.analyticsDailyOverview)
      .where(
        and(
          eq(analyticsSchema.analyticsDailyOverview.siteId, siteId),
          eq(
            analyticsSchema.analyticsDailyOverview.statDate,
            facts[0].statDate,
          ),
          eq(
            analyticsSchema.analyticsDailyOverview.timezone,
            facts[0].timezone,
          ),
        ),
      );

    expect(overview).toHaveLength(1);

    // 本次 Page View 应使 PV 增加 1。
    expect(overview[0].pageViews).toBe(baseline.pageViews + 1n);

    // 使用独立 Visitor ID，应使 UV 增加 1。
    expect(overview[0].visitors).toBe(baseline.visitors + 1n);

    // 使用独立 Session，应使 Sessions 增加 1。
    expect(overview[0].sessions).toBe(baseline.sessions + 1n);
  });

  it("AN-IT-03：同一 Visitor 连续访问两个页面应复用 Session", async () => {
  const testVisitorId = randomUUID();
  const testSessionId = randomUUID();
  const firstEventId = randomUUID();
  const secondEventId = randomUUID();

  const firstPayload = {
    ...payload,
    event_id: firstEventId,
    visitor_id: testVisitorId,
    session_id: testSessionId,
    page_url: `https://${domain}/session-test/first`,
  };

  const secondPayload = {
    ...payload,
    event_id: secondEventId,
    visitor_id: testVisitorId,
    session_id: testSessionId,
    page_url: `https://${domain}/session-test/second`,
  };

  // 记录本次测试日期的 Overview 基准值。
const statDate = new Date().toISOString().slice(0, 10);

const beforeOverview = await db
  .select()
  .from(analyticsSchema.analyticsDailyOverview)
  .where(
    and(
      eq(analyticsSchema.analyticsDailyOverview.siteId, siteId),
      eq(analyticsSchema.analyticsDailyOverview.statDate, statDate),
      eq(analyticsSchema.analyticsDailyOverview.timezone, "UTC"),
    ),
  );

const baseline = beforeOverview[0] ?? {
  pageViews: 0n,
  visitors: 0n,
  sessions: 0n,
};

  // 1. 提交第一次 Page View。
  const firstResponse = await collectHandler(
    createRequest(firstPayload),
    context,
  );

  expect(firstResponse.status).toBe(202);

  // 2. 提交第二次 Page View。
  // 使用相同 Visitor ID，但使用不同 Event ID。
  const secondResponse = await collectHandler(
    createRequest(secondPayload),
    context,
  );

  expect(secondResponse.status).toBe(202);

  // 3. 查询两条 Event Facts。
  const facts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsEventFacts.siteId, siteId),
        eq(analyticsSchema.analyticsEventFacts.eventId, firstEventId),
      ),
    );

  const secondFacts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsEventFacts.siteId, siteId),
        eq(analyticsSchema.analyticsEventFacts.eventId, secondEventId),
      ),
    );

  expect(facts).toHaveLength(1);
  expect(secondFacts).toHaveLength(1);

  // 4. 两次访问必须使用相同的 Visitor Key 和 Session Key。
  expect(secondFacts[0].visitorKey).toBe(facts[0].visitorKey);
  expect(secondFacts[0].sessionKey).toBe(facts[0].sessionKey);

  // 5. 查询 Session Fact。
  const sessions = await db
    .select()
    .from(analyticsSchema.analyticsSessionFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsSessionFacts.siteId, siteId),
        eq(
          analyticsSchema.analyticsSessionFacts.visitorKey,
          facts[0].visitorKey,
        ),
      ),
    );

  expect(sessions).toHaveLength(1);
  expect(Number(sessions[0].pageViewCount)).toBe(2);
  expect(sessions[0].status).toBe("active");

  // 6. 查询 Daily Overview。
  const overview = await db
    .select()
    .from(analyticsSchema.analyticsDailyOverview)
    .where(
      and(
        eq(analyticsSchema.analyticsDailyOverview.siteId, siteId),
        eq(
          analyticsSchema.analyticsDailyOverview.statDate,
          facts[0].statDate,
        ),
        eq(
          analyticsSchema.analyticsDailyOverview.timezone,
          facts[0].timezone,
        ),
      ),
    );

  expect(overview).toHaveLength(1);

  // 两次 Page View，PV 增加 2。
  expect(overview[0].pageViews).toBe(
    baseline.pageViews + 2n,
  );

  // 同一 Visitor，UV 只增加 1。
  expect(overview[0].visitors).toBe(
    baseline.visitors + 1n,
  );

  // 同一 Session，Sessions 只增加 1。
  expect(overview[0].sessions).toBe(
    baseline.sessions + 1n,
  );
});

it("AN-IT-04：验证 Analytics Session 30 分钟超时边界", async () => {
  const baseTime = new Date("2026-11-12T10:00:00.000Z");

  async function runScenario(
    intervalMs: number,
    shouldReuseSession: boolean,
  ) {
    const testVisitorId = randomUUID();
    const firstEventId = randomUUID();
    const secondEventId = randomUUID();
    const testSessionId = randomUUID();

    const firstPayload = {
      ...payload,
      event_id: firstEventId,
      visitor_id: testVisitorId,
      session_id: testSessionId,
      page_url: `https://${domain}/timeout-test/first`,
    };

    const secondPayload = {
      ...payload,
      event_id: secondEventId,
      visitor_id: testVisitorId,
      session_id: testSessionId,
      page_url: `https://${domain}/timeout-test/second`,
    };

    vi.setSystemTime(baseTime);

    const firstResponse = await collectHandler(
      createRequest(firstPayload),
      context,
    );

    expect(firstResponse.status).toBe(202);

    vi.setSystemTime(
      new Date(baseTime.getTime() + intervalMs),
    );

    const secondResponse = await collectHandler(
      createRequest(secondPayload),
      context,
    );

    expect(secondResponse.status).toBe(202);

    const eventIds: string[] = [firstEventId, secondEventId];

    const facts = await db
      .select()
      .from(analyticsSchema.analyticsEventFacts)
      .where(
        and(
          eq(analyticsSchema.analyticsEventFacts.siteId, siteId),
        ),
      );

    const scenarioFacts = facts.filter((fact) =>
      eventIds.includes(fact.eventId),
    );

    expect(scenarioFacts).toHaveLength(2);

    expect(scenarioFacts[0].visitorKey).toBe(
      scenarioFacts[1].visitorKey,
    );

    const sessions = await db
      .select()
      .from(analyticsSchema.analyticsSessionFacts)
      .where(
        and(
          eq(
            analyticsSchema.analyticsSessionFacts.siteId,
            siteId,
          ),
          eq(
            analyticsSchema.analyticsSessionFacts.visitorKey,
            scenarioFacts[0].visitorKey,
          ),
        ),
      );

    const expectedSessionCount = shouldReuseSession ? 1 : 2;

    expect(sessions).toHaveLength(expectedSessionCount);

    if (shouldReuseSession) {
      // 小于 30 分钟：复用同一个 Session。
      expect(scenarioFacts[0].sessionKey).toBe(
        scenarioFacts[1].sessionKey,
      );

      expect(Number(sessions[0].pageViewCount)).toBe(2);
      expect(sessions[0].status).toBe("active");
      expect(sessions[0].endedAt).toBeNull();
    } else {
      // 大于或等于 30 分钟：创建新的 Session。
      expect(scenarioFacts[0].sessionKey).not.toBe(
        scenarioFacts[1].sessionKey,
      );

      const orderedSessions = [...sessions].sort(
        (a, b) =>
          a.startedAt.getTime() - b.startedAt.getTime(),
      );

      expect(orderedSessions[0].status).toBe("completed");
      expect(orderedSessions[0].endedAt).toEqual(
        new Date(baseTime.getTime() + 30 * 60 * 1000),
      );
      expect(Number(orderedSessions[0].pageViewCount)).toBe(1);

      expect(orderedSessions[1].status).toBe("active");
      expect(orderedSessions[1].endedAt).toBeNull();
      expect(Number(orderedSessions[1].pageViewCount)).toBe(1);
    }
  }

  try {
    vi.useFakeTimers({
      toFake: ["Date"],
    });
    // 29 分 59 秒：复用 Session。
    await runScenario(
      29 * 60 * 1000 + 59 * 1000,
      true,
    );

    // 恰好 30 分钟：创建新 Session。
    await runScenario(
      30 * 60 * 1000,
      false,
    );

    // 30 分 01 秒：创建新 Session。
    await runScenario(
      30 * 60 * 1000 + 1000,
      false,
    );
  } finally {
    vi.useRealTimers();
  }
});


it("AN-IT-05：Analytics 写入中途异常时应完整回滚事务", async () => {
  const testVisitorId = randomUUID();
  const testEventId = randomUUID();
  const testSessionId = randomUUID();

  const testPayload = {
    ...payload,
    event_id: testEventId,
    visitor_id: testVisitorId,
    session_id: testSessionId,
    page_url: `https://${domain}/rollback-test`,
  };

  // 记录异常发生前，各表当前站点的数据数量。
  async function getSnapshot() {
    const tables = [
      analyticsSchema.analyticsEventFacts,
      analyticsSchema.analyticsSessionFacts,
      analyticsSchema.analyticsDailyOverview,
      analyticsSchema.analyticsDailyPages,
      analyticsSchema.analyticsDailySources,
      analyticsSchema.analyticsDailyDevices,
      analyticsSchema.analyticsDailyLocations,
      analyticsSchema.analyticsDailyMemberships,
      pageEvents,
    ];

    const counts = await Promise.all(
      tables.map(async (table) => {
        const rows = await db
          .select()
          .from(table)
          .where(eq(table.siteId, siteId));

        return rows.length;
      }),
    );

    return counts;
  }

  const before = await getSnapshot();

  // 获取真正的 Aggregate Writer 实现。
  const aggregateWriter = await import(
    "../../netlify/functions/_shared/analytics/aggregate-writer"
  );

  const originalWriter = aggregateWriter.writePageViewAggregates;

  // 先执行完整的 Aggregate Writer，再主动抛出异常。
  // 此时事务内的 Session、Event、原始事件和统计数据均已写入。
  const writerSpy = vi
    .spyOn(aggregateWriter, "writePageViewAggregates")
    .mockImplementationOnce(
      (async (tx: Parameters<typeof originalWriter>[0], input: Parameters<typeof originalWriter>[1]) => {
        await originalWriter(tx, input);

        throw new Error("AN-IT-05: Simulated aggregate write failure");
      }) as never,
    );

  try {
    const response = await collectHandler(
      createRequest(testPayload),
      context,
    );

    expect(response.status).toBe(500);

    const result = await readCollectErrorJson(response);
    expect(result.error.code).toBe("INTERNAL_SERVER_ERROR");

    // 验证事务回滚后，各表数据数量与之前完全一致。
    const after = await getSnapshot();

    expect(after).toEqual(before);
    expect(writerSpy).toHaveBeenCalledOnce();
  } finally {
    writerSpy.mockRestore();
  }
});


it("AN-IT-06：原始事件删除后仍应通过 Event Fact 防止重复统计", async () => {
  const testVisitorId = randomUUID();
  const testEventId = randomUUID();
  const testSessionId = randomUUID();

  const testPayload = {
    ...payload,
    event_id: testEventId,
    visitor_id: testVisitorId,
    session_id: testSessionId,
    page_url: `https://${domain}/dedup-after-cleanup`,
  };

  // 第一次提交，正常收集。
  const firstResponse = await collectHandler(
    createRequest(testPayload),
    context,
  );

  expect(firstResponse.status).toBe(202);

  // 保存长期事实及统计数据快照。
  const beforeFacts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(eq(analyticsSchema.analyticsEventFacts.eventId, testEventId));

  const beforeSessions = await db
    .select()
    .from(analyticsSchema.analyticsSessionFacts)
    .where(eq(analyticsSchema.analyticsSessionFacts.siteId, siteId));

  const beforeOverview = await db
    .select()
    .from(analyticsSchema.analyticsDailyOverview)
    .where(eq(analyticsSchema.analyticsDailyOverview.siteId, siteId));

  const beforeMemberships = await db
    .select()
    .from(analyticsSchema.analyticsDailyMemberships)
    .where(eq(analyticsSchema.analyticsDailyMemberships.siteId, siteId));

  expect(beforeFacts).toHaveLength(1);

  // 模拟原始事件保留期清理，只删除当前测试事件。
  const deletedRows = await db
    .delete(pageEvents)
    .where(
      and(
        eq(pageEvents.siteId, siteId),
        eq(pageEvents.eventId, testEventId),
      ),
    )
    .returning({
      eventId: pageEvents.eventId,
    });

  expect(deletedRows).toHaveLength(1);

  // 再次提交相同 event_id。
  const duplicateResponse = await collectHandler(
    createRequest(testPayload),
    context,
  );

  expect(duplicateResponse.status).toBe(200);

  const duplicateResult = await readDuplicateEventJson(duplicateResponse);

  expect(duplicateResult.code).toBe("DUPLICATE_EVENT");

  // Event Fact 必须仍然只有一条。
  const afterFacts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(eq(analyticsSchema.analyticsEventFacts.eventId, testEventId));

  expect(afterFacts).toHaveLength(1);

  // 原始事件保持已删除状态。
  const afterRawEvents = await db
    .select()
    .from(pageEvents)
    .where(
      and(
        eq(pageEvents.siteId, siteId),
        eq(pageEvents.eventId, testEventId),
      ),
    );

  expect(afterRawEvents).toHaveLength(0);

  // Session 和统计数据不能因重复提交发生变化。
  const afterSessions = await db
    .select()
    .from(analyticsSchema.analyticsSessionFacts)
    .where(eq(analyticsSchema.analyticsSessionFacts.siteId, siteId));

  const afterOverview = await db
    .select()
    .from(analyticsSchema.analyticsDailyOverview)
    .where(eq(analyticsSchema.analyticsDailyOverview.siteId, siteId));

  const afterMemberships = await db
    .select()
    .from(analyticsSchema.analyticsDailyMemberships)
    .where(eq(analyticsSchema.analyticsDailyMemberships.siteId, siteId));

  expect(afterSessions).toEqual(beforeSessions);
  expect(afterOverview).toEqual(beforeOverview);
  expect(afterMemberships).toEqual(beforeMemberships);
});


it("AN-IT-07：同一 Visitor 并发 Page View 应复用同一 Session", async () => {
  const testVisitorId = randomUUID();
  const testSessionId = randomUUID();

  const eventIdA = randomUUID();
  const eventIdB = randomUUID();

  const payloadA = {
    ...payload,
    event_id: eventIdA,
    visitor_id: testVisitorId,
    session_id: testSessionId,
    page_url: `https://${domain}/concurrent/page-a`,
  };

  const payloadB = {
    ...payload,
    event_id: eventIdB,
    visitor_id: testVisitorId,
    session_id: testSessionId,
    page_url: `https://${domain}/concurrent/page-b`,
  };

  // 同时提交两个不同的 Page View。
  const [responseA, responseB] = await Promise.all([
    collectHandler(createRequest(payloadA), context),
    collectHandler(createRequest(payloadB), context),
  ]);

  expect(responseA.status).toBe(202);
  expect(responseB.status).toBe(202);

  const eventIds: string[] = [eventIdA, eventIdB];

  const allFacts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(eq(analyticsSchema.analyticsEventFacts.siteId, siteId));

  const scenarioFacts = allFacts.filter(
    (fact) => eventIds.includes(fact.eventId),
  );

  expect(scenarioFacts).toHaveLength(2);

  // 两个事件必须属于同一个 Visitor。
  expect(scenarioFacts[0].visitorKey).toBe(
    scenarioFacts[1].visitorKey,
  );

  // 两个事件必须属于同一个 Analytics Session。
  expect(scenarioFacts[0].sessionKey).toBe(
    scenarioFacts[1].sessionKey,
  );

  const allSessions = await db
    .select()
    .from(analyticsSchema.analyticsSessionFacts)
    .where(
      eq(
        analyticsSchema.analyticsSessionFacts.siteId,
        siteId,
      ),
    );

  const scenarioSessions = allSessions.filter(
    (session) =>
      session.visitorKey === scenarioFacts[0].visitorKey,
  );

  expect(scenarioSessions).toHaveLength(1);
  expect(Number(scenarioSessions[0].pageViewCount)).toBe(2);
  expect(scenarioSessions[0].status).toBe("active");
  expect(scenarioSessions[0].endedAt).toBeNull();

  // 两条原始事件也都应成功写入。
  const rawEvents = await db
    .select()
    .from(pageEvents)
    .where(eq(pageEvents.siteId, siteId));

  expect(
    rawEvents.filter((event) => eventIds.includes(event.eventId)),
  ).toHaveLength(2);
});

it("AN-IT-08：同一事件并发重复提交应保持幂等", async () => {
  const testVisitorId = randomUUID();
  const testEventId = randomUUID();
  const testSessionId = randomUUID();

  const testPayload = {
    ...payload,
    event_id: testEventId,
    visitor_id: testVisitorId,
    session_id: testSessionId,
    page_url: `https://${domain}/concurrent-duplicate`,
  };

  // 同一事件同时提交两次。
  const [responseA, responseB] = await Promise.all([
    collectHandler(createRequest(testPayload), context),
    collectHandler(createRequest(testPayload), context),
  ]);

  // 一次成功，一次识别为重复事件。
  expect(
    [responseA.status, responseB.status].sort((a, b) => a - b),
  ).toEqual([200, 202]);

  const responses = await Promise.all([
    readJsonObject(responseA.clone()),
    readJsonObject(responseB.clone()),
  ]);

  expect(
    responses.filter(isDuplicateEventBody),
  ).toHaveLength(1);

  // Event Fact 只能存在一条。
  const facts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsEventFacts.siteId, siteId),
        eq(analyticsSchema.analyticsEventFacts.eventId, testEventId),
      ),
    );

  expect(facts).toHaveLength(1);

  // Session 只能创建一条，且只统计一次 Page View。
  const sessions = await db
    .select()
    .from(analyticsSchema.analyticsSessionFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsSessionFacts.siteId, siteId),
        eq(analyticsSchema.analyticsSessionFacts.visitorKey, facts[0].visitorKey),
      ),
    );

  expect(sessions).toHaveLength(1);
  expect(Number(sessions[0].pageViewCount)).toBe(1);
  expect(sessions[0].status).toBe("active");

  // 原始事件也只能有一条。
  const rawEvents = await db
    .select()
    .from(pageEvents)
    .where(
      and(
        eq(pageEvents.siteId, siteId),
        eq(pageEvents.eventId, testEventId),
      ),
    );

  expect(rawEvents).toHaveLength(1);
});


it("AN-IT-09：不同 Visitor 并发访问应创建独立 Session", async () => {
  const visitorIdA = randomUUID();
  const visitorIdB = randomUUID();

  const eventIdA = randomUUID();
  const eventIdB = randomUUID();

  const sessionIdA = randomUUID();
  const sessionIdB = randomUUID();

  const payloadA = {
    ...payload,
    event_id: eventIdA,
    visitor_id: visitorIdA,
    session_id: sessionIdA,
    page_url: `https://${domain}/concurrent-visitor/a`,
  };

  const payloadB = {
    ...payload,
    event_id: eventIdB,
    visitor_id: visitorIdB,
    session_id: sessionIdB,
    page_url: `https://${domain}/concurrent-visitor/b`,
  };

  // 两个不同 Visitor 同时提交 Page View。
  const [responseA, responseB] = await Promise.all([
    collectHandler(createRequest(payloadA), context),
    collectHandler(createRequest(payloadB), context),
  ]);

  expect(responseA.status).toBe(202);
  expect(responseB.status).toBe(202);

  const eventIds: string[] = [eventIdA, eventIdB];

  const allFacts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(eq(analyticsSchema.analyticsEventFacts.siteId, siteId));

  const scenarioFacts = allFacts.filter(
    (fact) => eventIds.includes(fact.eventId),
  );

  expect(scenarioFacts).toHaveLength(2);

  const factA = scenarioFacts.find(
    (fact) => fact.eventId === eventIdA,
  );

  const factB = scenarioFacts.find(
    (fact) => fact.eventId === eventIdB,
  );

  expect(factA).toBeDefined();
  expect(factB).toBeDefined();

  // 不同 Visitor 必须生成不同 Visitor Key。
  expect(factA!.visitorKey).not.toBe(factB!.visitorKey);

  // 不同 Visitor 必须拥有不同 Analytics Session。
  expect(factA!.sessionKey).not.toBe(factB!.sessionKey);

  const allSessions = await db
    .select()
    .from(analyticsSchema.analyticsSessionFacts)
    .where(eq(analyticsSchema.analyticsSessionFacts.siteId, siteId));

  const sessionA = allSessions.filter(
    (session) => session.visitorKey === factA!.visitorKey,
  );

  const sessionB = allSessions.filter(
    (session) => session.visitorKey === factB!.visitorKey,
  );

  expect(sessionA).toHaveLength(1);
  expect(sessionB).toHaveLength(1);

  expect(Number(sessionA[0].pageViewCount)).toBe(1);
  expect(Number(sessionB[0].pageViewCount)).toBe(1);

  expect(sessionA[0].status).toBe("active");
  expect(sessionB[0].status).toBe("active");

  expect(sessionA[0].endedAt).toBeNull();
  expect(sessionB[0].endedAt).toBeNull();
});


  it("IT-02：数据库字段映射应该正确", async () => {
    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, eventId),
        ),
      );

    expect(rows).toHaveLength(1);

    const event = rows[0];

    expect(event.eventType).toBe("page_view");
    expect(event.visitorId).toBe(visitorId);
    expect(event.sessionId).toBe(sessionId);

    expect(event.pageUrl).toBe(
      `https://${domain}/products?utm_source=integration`,
    );

    // 服务端根据 URL 生成 page_path，不信任客户端传入值。
    expect(event.pagePath).toBe("/products");

    expect(event.pageTitle).toBe("Integration Test Page");
    expect(event.referrerHost).toBe("google.com");

    expect(event.utmSource).toBe("integration");
    expect(event.utmMedium).toBe("test");
    expect(event.utmCampaign).toBe("it-01");

    expect(event.countryCode).toBe("US");
    expect(event.city).toBe("San Jose");
    expect(event.deviceType).toBe("desktop");
    expect(event.browser).toBeTruthy();
    expect(event.os).toBeTruthy();

    expect(event.receivedAt).toBeInstanceOf(Date);
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

it("IT-03：重复提交相同事件应该进行幂等处理", async () => {
  // 1. 获取首次提交时已经创建的 Analytics Event Fact。
  const beforeFacts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsEventFacts.siteId, siteId),
        eq(analyticsSchema.analyticsEventFacts.eventId, eventId),
      ),
    );

  expect(beforeFacts).toHaveLength(1);

  const fact = beforeFacts[0];

  // 2. 记录重复提交前的 Session Fact。
  const beforeSessions = await db
    .select()
    .from(analyticsSchema.analyticsSessionFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsSessionFacts.siteId, siteId),
        eq(
          analyticsSchema.analyticsSessionFacts.visitorKey,
          fact.visitorKey,
        ),
      ),
    );

  // 3. 记录重复提交前的 Daily Overview。
  const beforeOverview = await db
    .select()
    .from(analyticsSchema.analyticsDailyOverview)
    .where(
      and(
        eq(analyticsSchema.analyticsDailyOverview.siteId, siteId),
        eq(
          analyticsSchema.analyticsDailyOverview.statDate,
          fact.statDate,
        ),
        eq(
          analyticsSchema.analyticsDailyOverview.timezone,
          fact.timezone,
        ),
      ),
    );

  // 4. 记录重复提交前的 Overview Membership。
  const beforeMemberships = await db
    .select()
    .from(analyticsSchema.analyticsDailyMemberships)
    .where(
      and(
        eq(analyticsSchema.analyticsDailyMemberships.siteId, siteId),
        eq(
          analyticsSchema.analyticsDailyMemberships.statDate,
          fact.statDate,
        ),
        eq(
          analyticsSchema.analyticsDailyMemberships.timezone,
          fact.timezone,
        ),
        eq(
          analyticsSchema.analyticsDailyMemberships.dimension,
          "overview",
        ),
      ),
    );

  // 5. 再次提交完全相同的事件。
  const response = await collectHandler(
    createRequest(payload),
    context,
  );

  expect(response.status).toBe(200);

  const result = await readDuplicateEventJson(response);

  expect(result.code).toBe("DUPLICATE_EVENT");

  // 6. Event Fact 不得重复创建。
  const afterFacts = await db
    .select()
    .from(analyticsSchema.analyticsEventFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsEventFacts.siteId, siteId),
        eq(analyticsSchema.analyticsEventFacts.eventId, eventId),
      ),
    );

  expect(afterFacts).toHaveLength(1);

  // 7. Session Fact 不得重复增加 Page View。
  const afterSessions = await db
    .select()
    .from(analyticsSchema.analyticsSessionFacts)
    .where(
      and(
        eq(analyticsSchema.analyticsSessionFacts.siteId, siteId),
        eq(
          analyticsSchema.analyticsSessionFacts.visitorKey,
          fact.visitorKey,
        ),
      ),
    );

  expect(afterSessions).toEqual(beforeSessions);

  // 8. Daily Overview 不得发生任何变化。
  const afterOverview = await db
    .select()
    .from(analyticsSchema.analyticsDailyOverview)
    .where(
      and(
        eq(analyticsSchema.analyticsDailyOverview.siteId, siteId),
        eq(
          analyticsSchema.analyticsDailyOverview.statDate,
          fact.statDate,
        ),
        eq(
          analyticsSchema.analyticsDailyOverview.timezone,
          fact.timezone,
        ),
      ),
    );

  expect(afterOverview).toEqual(beforeOverview);

  // 9. Overview Membership 不得重复插入。
  const afterMemberships = await db
    .select()
    .from(analyticsSchema.analyticsDailyMemberships)
    .where(
      and(
        eq(analyticsSchema.analyticsDailyMemberships.siteId, siteId),
        eq(
          analyticsSchema.analyticsDailyMemberships.statDate,
          fact.statDate,
        ),
        eq(
          analyticsSchema.analyticsDailyMemberships.timezone,
          fact.timezone,
        ),
        eq(
          analyticsSchema.analyticsDailyMemberships.dimension,
          "overview",
        ),
      ),
    );

  expect(afterMemberships).toEqual(beforeMemberships);

  // 10. 原始事件仍然只能有一条。
  const rows = await db
    .select()
    .from(pageEvents)
    .where(
      and(
        eq(pageEvents.siteId, siteId),
        eq(pageEvents.eventId, eventId),
      ),
    );

  expect(rows).toHaveLength(1);
});

it("IT-04：不存在的站点应该返回 404", async () => {
    const response = await collectHandler(
      createRequest({
        ...payload,
        site_id: randomUUID(),
      }),
      context,
    );

    expect(response.status).toBe(404);

    const result = await readCollectErrorJson(response);
    expect(result.error.code).toBe("SITE_NOT_FOUND");
  });

  it("IT-05：已禁用站点应该返回 404", async () => {
    await db
      .update(sites)
      .set({ status: "disabled" })
      .where(eq(sites.id, siteId));

    try {
      const response = await collectHandler(
        createRequest(payload),
        context,
      );

      expect(response.status).toBe(404);

      const result = await readCollectErrorJson(response);
      expect(result.error.code).toBe("SITE_INACTIVE");
    } finally {
      // 恢复站点状态，避免影响后续测试。
      await db
        .update(sites)
        .set({ status: "active" })
        .where(eq(sites.id, siteId));
    }
  });

  it("IT-06：未授权域名应该返回 403", async () => {
    const unauthorizedDomain =
      `unauthorized-${randomUUID()}.example.test`;

    const request = new Request(
      "http://localhost:8888/api/collect",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: `https://${unauthorizedDomain}`,
        },
        body: JSON.stringify(payload),
      },
    );

    const response = await collectHandler(request, context);

    expect(response.status).toBe(403);

    const result = await readCollectErrorJson(response);
    expect(result.error.code).toBe("DOMAIN_NOT_ALLOWED");
  });

  it("IT-07：不支持的事件类型应该返回 400", async () => {
    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: randomUUID(),
        event_type: "click",
      }),
      context,
    );

    expect(response.status).toBe(400);

    const result = await readCollectErrorJson(response);
    expect(result.error.code).toBe("UNSUPPORTED_EVENT_TYPE");
  });

  it("IT-08：超过 16KB 的请求体应该返回 413", async () => {
    const response = await collectHandler(
      createRequest({
        ...payload,
        padding: "x".repeat(17000),
      }),
      context,
    );

    expect(response.status).toBe(413);

    const result = await readCollectErrorJson(response);
    expect(result.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("IT-09：合法域名的 OPTIONS 预检应该返回 204", async () => {
    const request = new Request(
      "http://localhost:8888/api/collect",
      {
        method: "OPTIONS",
        headers: {
          Origin: `https://${domain}`,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type",
        },
      },
    );

    const response = await collectHandler(request, context);

    expect(response.status).toBe(204);
    expect(
      response.headers.get("Access-Control-Allow-Origin"),
    ).toBe(`https://${domain}`);

    expect(
      response.headers.get("Access-Control-Allow-Methods"),
    ).toContain("POST");
  });

  it("IT-10：数据库查询异常应该返回 500", async () => {
    const { vi } = await import("vitest");

    const selectSpy = vi
      .spyOn(db, "select")
      .mockImplementationOnce(
        (() => {
          throw new Error("Simulated database failure");
        }) as never,
      );

    try {
      const response = await collectHandler(
        createRequest(payload),
        context,
      );

      expect(response.status).toBe(500);

      const result = await readCollectErrorJson(response);
      expect(result.error.code).toBe("INTERNAL_SERVER_ERROR");
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("IT-11：缺少 Origin 应返回 403", async () => {
    const response = await collectHandler(
      createRawRequest(JSON.stringify(payload), {
        contentType: "application/json",
      }),
      context,
    );

    await expectError(response, 403, "INVALID_ORIGIN");
  });

  it("IT-12：非法 Origin 应返回 403", async () => {
    const response = await collectHandler(
      createRawRequest(JSON.stringify(payload), {
        origin: "null",
        contentType: "application/json",
      }),
      context,
    );

    await expectError(response, 403, "INVALID_ORIGIN");
  });

  it("IT-13：缺少 Content-Type 应返回 415", async () => {
    const response = await collectHandler(
      createRawRequest(JSON.stringify(payload), {
        origin: `https://${domain}`,
      }),
      context,
    );

    await expectError(response, 415, "INVALID_CONTENT_TYPE");
  });

  it("IT-14：application/jsonp 应返回 415", async () => {
    const response = await collectHandler(
      createRawRequest(JSON.stringify(payload), {
        origin: `https://${domain}`,
        contentType: "application/jsonp",
      }),
      context,
    );

    await expectError(response, 415, "INVALID_CONTENT_TYPE");
  });

  it("IT-15：非法 JSON 应返回 400", async () => {
    const response = await collectHandler(
      createRawRequest("{invalid-json", {
        origin: `https://${domain}`,
        contentType: "application/json",
      }),
      context,
    );

    await expectError(response, 400, "INVALID_JSON");
  });

  it("IT-16：JSON 数组不应被当作事件对象", async () => {
    const response = await collectHandler(
      createRawRequest("[]", {
        origin: `https://${domain}`,
        contentType: "application/json",
      }),
      context,
    );

    await expectError(response, 400, "INVALID_JSON");
  });

  it("IT-17：缺少 site_id 应返回 400", async () => {
    const { site_id, ...invalidPayload } = payload;

    const response = await collectHandler(
      createRequest(invalidPayload),
      context,
    );

    await expectError(response, 400, "INVALID_SITE_ID");
  });

  it("IT-18：非法 site_id 应返回 400", async () => {
    const response = await collectHandler(
      createRequest({
        ...payload,
        site_id: "invalid-uuid",
      }),
      context,
    );

    await expectError(response, 400, "INVALID_SITE_ID");
  });

  it("IT-19：缺少 event_id 应返回 400", async () => {
    const { event_id, ...invalidPayload } = payload;

    const response = await collectHandler(
      createRequest(invalidPayload),
      context,
    );

    await expectError(response, 400, "INVALID_EVENT_ID");
  });

  it("IT-20：非法 page_url 应返回 400", async () => {
    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: randomUUID(),
        page_url: "javascript:alert(1)",
      }),
      context,
    );

    await expectError(response, 400, "INVALID_PAGE_URL");
  });

  it("IT-21：page_url 域名与 Origin 不一致应返回 400", async () => {
    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: randomUUID(),
        page_url: "https://other.example.test/products",
      }),
      context,
    );

    await expectError(response, 400, "PAGE_URL_DOMAIN_MISMATCH");
  });

  it("IT-22：非法 visitor_id 应返回 400", async () => {
    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: randomUUID(),
        visitor_id: "invalid",
      }),
      context,
    );

    await expectError(response, 400, "INVALID_VISITOR_ID");
  });

  it("IT-23：非法 session_id 应返回 400", async () => {
    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: randomUUID(),
        session_id: "invalid",
      }),
      context,
    );

    await expectError(response, 400, "INVALID_SESSION_ID");
  });

  it("IT-24：非法 Origin 的 OPTIONS 应返回 403", async () => {
    const response = await collectHandler(
      createRawRequest("", {
        origin: "null",
        method: "OPTIONS",
      }),
      context,
    );

    await expectError(response, 403, "INVALID_ORIGIN");
  });

  it("IT-25：未注册域名的 OPTIONS 应返回 403", async () => {
    const response = await collectHandler(
      createRawRequest("", {
        origin: `https://unknown-${randomUUID()}.example.test`,
        method: "OPTIONS",
      }),
      context,
    );

    await expectError(response, 403, "ORIGIN_NOT_ALLOWED");
  });

  it("IT-26：刚好 16 KB 的合法 JSON 应被接受", async () => {
    const basePayload = {
      ...payload,
      event_id: randomUUID(),
      padding: "",
    };

    const baseBody = JSON.stringify(basePayload);
    const paddingLength = 16 * 1024 - Buffer.byteLength(baseBody);

    expect(paddingLength).toBeGreaterThanOrEqual(0);

    const exactBody = JSON.stringify({
      ...basePayload,
      padding: "x".repeat(paddingLength),
    });

    expect(Buffer.byteLength(exactBody)).toBe(16 * 1024);

    const response = await collectHandler(
      createRawRequest(exactBody, {
        origin: `https://${domain}`,
        contentType: "application/json",
      }),
      context,
    );

    expect(response.status).toBe(202);
  });

  
  // SEC-DB-01：数据库不得保存 page_url 中的敏感参数
  it("SEC-DB-01：page_url 敏感参数应在写入数据库前清理", async () => {
    const testEventId = randomUUID();

    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: testEventId,
        page_url:
          `https://${domain}/products?token=abc&email=test@example.com&id=100`,
      }),
      context,
    );

    expect(response.status).toBe(202);

    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, testEventId),
        ),
      );

    expect(rows).toHaveLength(1);

    const savedUrl = new URL(rows[0].pageUrl);

    expect(savedUrl.searchParams.has("token")).toBe(false);
    expect(savedUrl.searchParams.has("email")).toBe(false);
    expect(savedUrl.searchParams.get("id")).toBe("100");
  });

  // SEC-DB-02：重复敏感参数全部清理
  it("SEC-DB-02：重复敏感参数不得写入数据库", async () => {
    const testEventId = randomUUID();

    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: testEventId,
        page_url:
          `https://${domain}/products?token=a&token=b&email=a@test.com&email=b@test.com`,
      }),
      context,
    );

    expect(response.status).toBe(202);

    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, testEventId),
        ),
      );

    expect(rows).toHaveLength(1);

    const savedUrl = new URL(rows[0].pageUrl);

    expect(savedUrl.searchParams.getAll("token")).toHaveLength(0);
    expect(savedUrl.searchParams.getAll("email")).toHaveLength(0);
  });

  // SEC-DB-03：Fragment 不得写入数据库
  it("SEC-DB-03：page_url Fragment 应在写入数据库前清理", async () => {
    const testEventId = randomUUID();

    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: testEventId,
        page_url:
          `https://${domain}/products/detail?id=100#access_token=secret`,
      }),
      context,
    );

    expect(response.status).toBe(202);

    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, testEventId),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].pageUrl).not.toContain("#");
    expect(rows[0].pagePath).toBe("/products/detail");

    const savedUrl = new URL(rows[0].pageUrl);
    expect(savedUrl.searchParams.get("id")).toBe("100");
  });

  // SEC-DB-04：合法 UTM 字段应正常保留
  it("SEC-DB-04：五个 UTM 字段应正确写入数据库", async () => {
    const testEventId = randomUUID();

    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: testEventId,
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "privacy-test",
        utm_term: "coffee",
        utm_content: "banner",
      }),
      context,
    );

    expect(response.status).toBe(202);

    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, testEventId),
        ),
      );

    expect(rows).toHaveLength(1);

    const event = rows[0];

    expect(event.utmSource).toBe("google");
    expect(event.utmMedium).toBe("cpc");
    expect(event.utmCampaign).toBe("privacy-test");
    expect(event.utmTerm).toBe("coffee");
    expect(event.utmContent).toBe("banner");
  });

  // SEC-DB-05：Referrer 敏感参数和 Fragment 清理
  it("SEC-DB-05：referrer 敏感信息不得写入数据库", async () => {
    const testEventId = randomUUID();

    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: testEventId,
        referrer:
          "https://google.com/search?email=test@example.com&token=secret&source=google#access_token=abc",
      }),
      context,
    );

    expect(response.status).toBe(202);

    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, testEventId),
        ),
      );

    expect(rows).toHaveLength(1);

    const event = rows[0];

    expect(event.referrer).not.toContain("#");
    expect(event.referrer).not.toContain("email");
    expect(event.referrer).not.toContain("token");
    expect(event.referrerHost).toBe("google.com");

    const savedReferrer = new URL(event.referrer!);

    expect(savedReferrer.searchParams.has("email")).toBe(false);
    expect(savedReferrer.searchParams.has("token")).toBe(false);
    expect(savedReferrer.searchParams.get("source")).toBe("google");
  });


  // SEC-04-01：数据库 IP 必须来自服务端 Context
  it("SEC-04-01：数据库 IP 应来自服务端 Context", async () => {
    const testEventId = randomUUID();

    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: testEventId,
      }),
      context,
    );

    expect(response.status).toBe(202);

    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, testEventId),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].ipAddress).toBe("203.0.113.10");
    expect(rows[0].countryCode).toBe("US");
    expect(rows[0].region).toBe("California");
    expect(rows[0].city).toBe("San Jose");
  });

  // SEC-04-02：客户端伪造 IP 和 Geo 不得覆盖服务端数据
  it("SEC-04-02：客户端伪造 IP 和 Geo 字段应被忽略", async () => {
    const testEventId = randomUUID();

    const response = await collectHandler(
      createRequest({
        ...payload,
        event_id: testEventId,

        // 模拟恶意客户端伪造服务端字段
        ip_address: "8.8.8.8",
        ip_hash: "forged-hash",
        country_code: "CN",
        region: "Beijing",
        city: "Beijing",
      }),
      context,
    );

    expect(response.status).toBe(202);

    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, testEventId),
        ),
      );

    expect(rows).toHaveLength(1);

    const event = rows[0];

    expect(event.ipAddress).toBe("203.0.113.10");
    expect(event.countryCode).toBe("US");
    expect(event.region).toBe("California");
    expect(event.city).toBe("San Jose");
  });

  // SEC-04-03：伪造代理请求头不得覆盖 Context IP
  it("SEC-04-03：X-Forwarded-For 不得覆盖服务端 IP", async () => {
    const testEventId = randomUUID();

    const request = new Request(
      "http://localhost:8888/api/collect",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: `https://${domain}`,
          "X-Forwarded-For": "8.8.8.8",
          "X-Real-IP": "1.1.1.1",
        },
        body: JSON.stringify({
          ...payload,
          event_id: testEventId,
        }),
      },
    );

    const response = await collectHandler(request, context);

    expect(response.status).toBe(202);

    const rows = await db
      .select()
      .from(pageEvents)
      .where(
        and(
          eq(pageEvents.siteId, siteId),
          eq(pageEvents.eventId, testEventId),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].ipAddress).toBe("203.0.113.10");
  });

  it("SEC-04-04：原始 IP 隐私开关应控制新事件 IP 存储且不影响历史记录", async () => {
    // 确保 singleton 设置记录存在。
    const originalSettings = await getSystemSettings(db);
    const originalStoreRawIp = originalSettings.privacy.store_raw_ip;

    const historicalEventId = randomUUID();
    const disabledEventId = randomUUID();
    const reEnabledEventId = randomUUID();

    const findEvent = async (eventId: string) => {
      const rows = await db
        .select()
        .from(pageEvents)
        .where(
          and(
            eq(pageEvents.siteId, siteId),
            eq(pageEvents.eventId, eventId),
          ),
        );

      return rows[0];
    };

    try {
      // 第一步：开启 IP 存储，创建历史事件。
      await db
        .update(systemSettings)
        .set({ storeRawIp: true });

      const historicalResponse = await collectHandler(
        createRequest({
          ...payload,
          event_id: historicalEventId,
        }),
        context,
      );

      expect(historicalResponse.status).toBe(202);

      const historicalEvent = await findEvent(historicalEventId);

      expect(historicalEvent.ipAddress).toBe("203.0.113.10");

      // 第二步：关闭 IP 存储，创建新事件。
      await db
        .update(systemSettings)
        .set({ storeRawIp: false });

      const disabledResponse = await collectHandler(
        createRequest({
          ...payload,
          event_id: disabledEventId,
        }),
        context,
      );

      expect(disabledResponse.status).toBe(202);

      const disabledEvent = await findEvent(disabledEventId);

      expect(disabledEvent.ipAddress).toBeNull();

      // Geo 仍然正常写入。
      expect(disabledEvent.countryCode).toBe("US");
      expect(disabledEvent.region).toBe("California");
      expect(disabledEvent.city).toBe("San Jose");

      // 关闭开关不能删除历史 IP。
      const historicalAfterDisable = await findEvent(
        historicalEventId,
      );

      expect(historicalAfterDisable.ipAddress).toBe(
        "203.0.113.10",
      );

      // 第三步：重新开启 IP 存储。
      await db
        .update(systemSettings)
        .set({ storeRawIp: true });

      const reEnabledResponse = await collectHandler(
        createRequest({
          ...payload,
          event_id: reEnabledEventId,
        }),
        context,
      );

      expect(reEnabledResponse.status).toBe(202);

      const reEnabledEvent = await findEvent(reEnabledEventId);

      expect(reEnabledEvent.ipAddress).toBe("203.0.113.10");
      expect(reEnabledEvent.countryCode).toBe("US");
      expect(reEnabledEvent.region).toBe("California");
      expect(reEnabledEvent.city).toBe("San Jose");
    } finally {
      // 无论测试成功或失败，都恢复原始系统配置。
      await db
        .update(systemSettings)
        .set({ storeRawIp: originalStoreRawIp });
    }
  });


  it("SEC-05-01：清理过期 IP，但保留事件及其他字段", async () => {
    const now = new Date("2026-11-07T12:00:00.000Z");

    const expiredEventId = randomUUID();
    const boundaryEventId = randomUUID();
    const recentEventId = randomUUID();
    const nullIpEventId = randomUUID();

    const testEventIds = [
      expiredEventId,
      boundaryEventId,
      recentEventId,
      nullIpEventId,
    ];

    // 先通过真实采集接口创建四条记录。
    for (const testEventId of testEventIds) {
      const response = await collectHandler(
        createRequest({
          ...payload,
          event_id: testEventId,
        }),
        context,
      );

      expect(response.status).toBe(202);
    }

    const findEvent = async (testEventId: string) => {
      const rows = await db
        .select()
        .from(pageEvents)
        .where(
          and(
            eq(pageEvents.siteId, siteId),
            eq(pageEvents.eventId, testEventId),
          ),
        );

      expect(rows).toHaveLength(1);
      return rows[0];
    };

    // 设置测试时间：
    // 31 天前：应清理
    await db
      .update(pageEvents)
      .set({
        receivedAt: new Date(
          now.getTime() - 31 * 24 * 60 * 60 * 1000,
        ),
      })
      .where(eq(pageEvents.eventId, expiredEventId));

    // 恰好 30 天前：不清理
    await db
      .update(pageEvents)
      .set({
        receivedAt: new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000,
        ),
      })
      .where(eq(pageEvents.eventId, boundaryEventId));

    // 29 天前：不清理
    await db
      .update(pageEvents)
      .set({
        receivedAt: new Date(
          now.getTime() - 29 * 24 * 60 * 60 * 1000,
        ),
      })
      .where(eq(pageEvents.eventId, recentEventId));

    // 31 天前，但 IP 已经为空：不应重复计数
    await db
      .update(pageEvents)
      .set({
        receivedAt: new Date(
          now.getTime() - 31 * 24 * 60 * 60 * 1000,
        ),
        ipAddress: null,
      })
      .where(eq(pageEvents.eventId, nullIpEventId));

    const countBefore = await getSiteEventCount();

    // 执行真实 PostgreSQL 清理。
    const cleanedCount = await cleanupExpiredIpAddresses(
      db,
      30,
      now,
    );

    // 清理数量可能包含其他测试数据，只验证本测试创建的记录。
    expect(cleanedCount).toBeGreaterThanOrEqual(1);

    const expiredEvent = await findEvent(expiredEventId);
    const boundaryEvent = await findEvent(boundaryEventId);
    const recentEvent = await findEvent(recentEventId);
    const nullIpEvent = await findEvent(nullIpEventId);

    // 31 天前的 IP 被清理。
    expect(expiredEvent.ipAddress).toBeNull();

    // 恰好 30 天前的 IP 保留。
    expect(boundaryEvent.ipAddress).toBe("203.0.113.10");

    // 29 天前的 IP 保留。
    expect(recentEvent.ipAddress).toBe("203.0.113.10");

    // 原本为空的 IP 仍然为空。
    expect(nullIpEvent.ipAddress).toBeNull();

    // 其他统计字段不得被修改。
    expect(expiredEvent.city).toBe("San Jose");
    expect(expiredEvent.countryCode).toBe("US");
    expect(expiredEvent.pageUrl).toContain("/products");

    // 事件数量必须保持不变。
    const countAfter = await getSiteEventCount();
    expect(countAfter).toBe(countBefore);

    // 再次执行，不能重复清理已经清理的数据。
    const secondCleanedCount = await cleanupExpiredIpAddresses(
      db,
      30,
      now,
    );

    // 本测试创建的过期 IP 已经清理，不应再次被清理。
    const expiredEventAfterSecondCleanup = await findEvent(expiredEventId);
    expect(expiredEventAfterSecondCleanup.ipAddress).toBeNull();
    expect(await getSiteEventCount()).toBe(countBefore);
  });

    
  it("SEC-06-01：清理 IP 前后统计指标保持一致", async () => {
    const now = new Date();

    const visitorA = randomUUID();
    const visitorB = randomUUID();

    const sessionA = randomUUID();
    const sessionB = randomUUID();

    const events = [
      {
        eventId: randomUUID(),
        visitorId: visitorA,
        sessionId: sessionA,
        path: "/home",
      },
      {
        eventId: randomUUID(),
        visitorId: visitorA,
        sessionId: sessionA,
        path: "/about",
      },
      {
        eventId: randomUUID(),
        visitorId: visitorB,
        sessionId: sessionB,
        path: "/home",
      },
    ];

    const eventIds = events.map((event) => event.eventId);

    // 1. 通过真实采集接口写入 3 条事件。
    for (const event of events) {
      const response = await collectHandler(
        createRequest({
          ...payload,
          event_id: event.eventId,
          visitor_id: event.visitorId,
          session_id: event.sessionId,
          page_url: `https://${domain}${event.path}`,
        }),
        context,
      );

      expect(response.status).toBe(202);
    }

    // 2. 将事件接收时间调整为 31 天前，
    //    并确保每条记录都有 IP。
    const expiredAt = new Date(
      now.getTime() - 31 * 24 * 60 * 60 * 1000,
    );

    await pool.query(
      `
        UPDATE page_events
        SET
          received_at = $1,
          ip_address = $2
        WHERE site_id = $3
          AND event_id = ANY($4::uuid[])
      `,
      [
        expiredAt,
        "203.0.113.10",
        siteId,
        eventIds,
      ],
    );

    // 3. 统计查询：这些指标不依赖 IP。
    const getStats = async () => {
      const result = await pool.query(
        `
          SELECT
            COUNT(*)::int AS pv,
            COUNT(DISTINCT visitor_id)::int AS uv,
            COUNT(DISTINCT session_id)::int AS sessions,
            COUNT(DISTINCT country_code)::int AS countries,
            COUNT(DISTINCT region)::int AS regions,
            COUNT(DISTINCT city)::int AS cities,
            COUNT(DISTINCT browser)::int AS browsers,
            COUNT(DISTINCT os)::int AS operating_systems
          FROM page_events
          WHERE site_id = $1
            AND event_id = ANY($2::uuid[])
        `,
        [siteId, eventIds],
      );

      const pageResult = await pool.query(
        `
          SELECT
            page_path,
            COUNT(*)::int AS views
          FROM page_events
          WHERE site_id = $1
            AND event_id = ANY($2::uuid[])
          GROUP BY page_path
          ORDER BY page_path
        `,
        [siteId, eventIds],
      );

      return {
        metrics: result.rows[0],
        pages: pageResult.rows,
      };
    };

    // 4. 清理前统计。
    const beforeStats = await getStats();

    const ipBefore = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM page_events
        WHERE site_id = $1
          AND event_id = ANY($2::uuid[])
          AND ip_address IS NOT NULL
      `,
      [siteId, eventIds],
    );

    expect(beforeStats.metrics.pv).toBe(3);
    expect(beforeStats.metrics.uv).toBe(2);
    expect(beforeStats.metrics.sessions).toBe(2);

    expect(beforeStats.pages).toEqual([
      { page_path: "/about", views: 1 },
      { page_path: "/home", views: 2 },
    ]);

    expect(ipBefore.rows[0].count).toBe(3);

    // 5. 执行真实 IP 清理。
    const cleanedCount = await cleanupExpiredIpAddresses(
      db,
      30,
      now,
    );

    // expect(cleanedCount).toBeGreaterThanOrEqual(3);
    // 全表清理数量不固定，具体清理结果通过本测试专属事件验证。
    expect(Number.isInteger(cleanedCount)).toBe(true);
    expect(cleanedCount).toBeGreaterThanOrEqual(3);

    // 6. 清理后重新统计。
    const afterStats = await getStats();

    // 所有非 IP 统计指标必须完全一致。
    expect(afterStats).toEqual(beforeStats);

    // 7. 验证 IP 已经全部清除。
    const ipAfter = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM page_events
        WHERE site_id = $1
          AND event_id = ANY($2::uuid[])
          AND ip_address IS NOT NULL
      `,
      [siteId, eventIds],
    );

    expect(ipAfter.rows[0].count).toBe(0);

    // 8. 验证事件记录仍然存在。
    const remaining = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM page_events
        WHERE site_id = $1
          AND event_id = ANY($2::uuid[])
      `,
      [siteId, eventIds],
    );

    expect(remaining.rows[0].count).toBe(3);
  });


  it("RL-08-01：Collect Handler 应执行站点级限流并返回 429", async () => {
    const originalSettings = await getSystemSettings(db);
    const originalMaxRequests =
      originalSettings.rate_limit.site_rate_limit_max_requests;

    try {
      // 清除当前测试站点已有的限流计数。
      await pool.query(
        `DELETE FROM site_rate_limit_counters WHERE site_id = $1`,
        [siteId],
      );

      // 临时将每站点每 60 秒请求上限调整为 2。
      await db
        .update(systemSettings)
        .set({ siteRateLimitMaxRequests: 2 });

      // 无效事件不应该消耗请求额度。
      const invalidResponse = await collectHandler(
        createRequest({
          ...payload,
          event_id: randomUUID(),
          event_type: "click",
        }),
        context,
      );

      await expectError(
        invalidResponse,
        400,
        "UNSUPPORTED_EVENT_TYPE",
      );

      // 第一次有效请求。
      const firstResponse = await collectHandler(
        createRequest({
          ...payload,
          event_id: randomUUID(),
        }),
        context,
      );

      expect(firstResponse.status).toBe(202);

      // 第二次有效请求。
      const secondResponse = await collectHandler(
        createRequest({
          ...payload,
          event_id: randomUUID(),
        }),
        context,
      );

      expect(secondResponse.status).toBe(202);

      // 第三次请求应该超过限额。
      const thirdResponse = await collectHandler(
        createRequest({
          ...payload,
          event_id: randomUUID(),
        }),
        context,
      );

      expect(thirdResponse.status).toBe(429);

      await expectError(
        thirdResponse,
        429,
        "RATE_LIMIT_EXCEEDED",
      );

      // 验证 Retry-After。
      const retryAfter = Number(
        thirdResponse.headers.get("Retry-After"),
      );

      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);

      // 验证 429 响应仍然包含正确的 CORS。
      expect(
        thirdResponse.headers.get("Access-Control-Allow-Origin"),
      ).toBe(`https://${domain}`);
    } finally {
      // 恢复全局系统配置。
      await db
        .update(systemSettings)
        .set({
          siteRateLimitMaxRequests: originalMaxRequests,
        });

      // 清理本测试产生的限流计数。
      await pool.query(
        `DELETE FROM site_rate_limit_counters WHERE site_id = $1`,
        [siteId],
      );
    }
  });


});




import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const LOCAL_DATABASE_URL =
  "postgresql://plv_dev:plv_local_dev_2026@localhost:5433/plv_site_monitor_dev";

const HMAC_SECRET = process.env.PLV_ANALYTICS_HMAC_SECRET;
const HMAC_KEY_VERSION = Number(
  process.env.PLV_ANALYTICS_HMAC_KEY_VERSION,
);

const SESSION_MODEL_VERSION = 1;

let db: typeof import("../../db/client").db;
let pool: typeof import("../../db/client").pool;
let sites: typeof import("../../db/schema").sites;
let analyticsSessionFacts:
  typeof import("../../db/analytics-schema").analyticsSessionFacts;
let eq: typeof import("drizzle-orm").eq;

let createOrUpdateAnalyticsSession: typeof import(
  "../../netlify/functions/_shared/analytics/session-lifecycle"
)["createOrUpdateAnalyticsSession"];

let siteId: string;

const visitorKey = "a".repeat(64);
const visitorKeyVersion = 1;
const timezone = "UTC";

const baseTime = new Date("2026-11-11T10:00:00.000Z");

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

describe("Analytics Session Lifecycle", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ||= LOCAL_DATABASE_URL;

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not configured");
    }

    const parsed = new URL(databaseUrl);

    if (
      !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
      parsed.port !== "5433" ||
      parsed.pathname !== "/plv_site_monitor_dev" ||
      databaseUrl !== LOCAL_DATABASE_URL
    ) {
      throw new Error(
        "Unsafe database target. Only local plv_site_monitor_dev is allowed.",
      );
    }

    if (!HMAC_SECRET || !/^[0-9a-fA-F]{64}$/.test(HMAC_SECRET)) {
      throw new Error("Valid PLV_ANALYTICS_HMAC_SECRET is required");
    }

    if (!Number.isSafeInteger(HMAC_KEY_VERSION) || HMAC_KEY_VERSION <= 0) {
      throw new Error("Valid PLV_ANALYTICS_HMAC_KEY_VERSION is required");
    }

    const [clientModule, schemaModule, analyticsModule, drizzleModule] =
      await Promise.all([
        import("../../db/client"),
        import("../../db/schema"),
        import("../../db/analytics-schema"),
        import("drizzle-orm"),
      ]);

    db = clientModule.db;
    pool = clientModule.pool;
    sites = schemaModule.sites;
    analyticsSessionFacts = analyticsModule.analyticsSessionFacts;
    eq = drizzleModule.eq;

    const lifecycleModule = await import(
      "../../netlify/functions/_shared/analytics/session-lifecycle"
    );

    createOrUpdateAnalyticsSession =
      lifecycleModule.createOrUpdateAnalyticsSession;

    siteId = randomUUID();

    await db.insert(sites).values({
      id: siteId,
      name: "Analytics Session Lifecycle Test",
      status: "active",
      timezone,
    });
  });

  afterAll(async () => {
    if (db && siteId) {
      await db
        .delete(analyticsSessionFacts)
        .where(eq(analyticsSessionFacts.siteId, siteId));

      await db.delete(sites).where(eq(sites.id, siteId));
    }

    if (pool) {
      await pool.end();
    }
  });

  async function createSession(
  receivedAt: Date,
  pagePath: string,
  currentVisitorKey = visitorKey,
  currentTimezone = timezone,
) {
    return db.transaction(async (tx) => {
      return createOrUpdateAnalyticsSession(tx, {
        siteId,
        visitorKey: currentVisitorKey,
        visitorKeyVersion,
        pagePath,
        receivedAt,
        timezone: currentTimezone,
        sessionKeySecret: HMAC_SECRET!,
        sessionKeyVersion: HMAC_KEY_VERSION,
        sessionModelVersion: SESSION_MODEL_VERSION,
      });
    });
  }

  async function getSessions() {
    return db
      .select()
      .from(analyticsSessionFacts)
      .where(eq(analyticsSessionFacts.siteId, siteId));
  }

  it("AN-SESSION-01：首次 Page View 应创建 Active Session", async () => {
    const result = await createSession(baseTime, "/home");
    const sessions = await getSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("active");
    expect(sessions[0].startedAt.getTime()).toBe(baseTime.getTime());
    expect(sessions[0].lastActivityAt.getTime()).toBe(baseTime.getTime());
    expect(sessions[0].endedAt).toBeNull();
    expect(sessions[0].pageViewCount).toBe(1);
    expect(sessions[0].entryPage).toBe("/home");
    expect(sessions[0].sessionKey).toBeTruthy();
    expect(result.sessionKey).toBe(sessions[0].sessionKey);
  });

  it("AN-SESSION-02：29 分钟后应复用原 Session", async () => {
    const receivedAt = addMinutes(baseTime, 29);

    const result = await createSession(receivedAt, "/products");
    const sessions = await getSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("active");
    expect(sessions[0].pageViewCount).toBe(2);
    expect(sessions[0].lastActivityAt.getTime()).toBe(
      receivedAt.getTime(),
    );
    expect(sessions[0].exitPage).toBe("/products");
    expect(result.sessionKey).toBe(sessions[0].sessionKey);
  });

  it("AN-SESSION-03：恰好 30 分钟后应结束旧 Session 并创建新 Session", async () => {
    const receivedAt = addMinutes(baseTime, 59);

    const result = await createSession(receivedAt, "/checkout");
    const sessions = await getSessions();

    expect(sessions).toHaveLength(2);

    const completedSessions = sessions.filter(
      (session) => session.status === "completed",
    );

    const activeSessions = sessions.filter(
      (session) => session.status === "active",
    );

    expect(completedSessions).toHaveLength(1);
    expect(activeSessions).toHaveLength(1);

    const oldSession = completedSessions[0];
    const newSession = activeSessions[0];

    expect(oldSession.pageViewCount).toBe(2);
    expect(oldSession.endedAt?.getTime()).toBe(
      addMinutes(baseTime, 59).getTime(),
    );

    expect(newSession.startedAt.getTime()).toBe(receivedAt.getTime());
    expect(newSession.lastActivityAt.getTime()).toBe(receivedAt.getTime());
    expect(newSession.pageViewCount).toBe(1);
    expect(newSession.entryPage).toBe("/checkout");
    expect(newSession.endedAt).toBeNull();

    expect(newSession.sessionKey).not.toBe(oldSession.sessionKey);
    expect(result.sessionKey).toBe(newSession.sessionKey);
  });

  it("AN-SESSION-04：同一 Visitor 并发访问应保持单个 Active Session", async () => {
    const concurrentVisitorKey = "b".repeat(64);
    const receivedAt = addMinutes(baseTime, 120);

    const results = await Promise.all([
      createSession(receivedAt, "/concurrent-a", concurrentVisitorKey),
      createSession(receivedAt, "/concurrent-b", concurrentVisitorKey),
    ]);

    const sessions = await db
      .select()
      .from(analyticsSessionFacts)
      .where(
        eq(analyticsSessionFacts.visitorKey, concurrentVisitorKey),
      );

    expect(results).toHaveLength(2);
    expect(sessions).toHaveLength(1);

    expect(sessions[0].status).toBe("active");
    expect(sessions[0].pageViewCount).toBe(2);
    expect(sessions[0].startedAt.getTime()).toBe(receivedAt.getTime());
    expect(sessions[0].lastActivityAt.getTime()).toBe(receivedAt.getTime());
  });

  it("AN-SESSION-05：超过 30 分钟后应创建新 Session", async () => {
  const testVisitorKey = "c".repeat(64);

  const firstVisit = baseTime;
  const secondVisit = addMinutes(baseTime, 31);

  await createSession(firstVisit, "/first", testVisitorKey);
  const result = await createSession(
    secondVisit,
    "/return",
    testVisitorKey,
  );

  const sessions = await db
    .select()
    .from(analyticsSessionFacts)
    .where(
      eq(analyticsSessionFacts.visitorKey, testVisitorKey),
    );

  expect(sessions).toHaveLength(2);

  const completedSession = sessions.find(
    (session) => session.status === "completed",
  );

  const activeSession = sessions.find(
    (session) => session.status === "active",
  );

  expect(completedSession).toBeDefined();
  expect(activeSession).toBeDefined();

  expect(completedSession!.pageViewCount).toBe(1);
  expect(completedSession!.endedAt?.getTime()).toBe(
    addMinutes(firstVisit, 30).getTime(),
  );

  expect(activeSession!.pageViewCount).toBe(1);
  expect(activeSession!.startedAt.getTime()).toBe(
    secondVisit.getTime(),
  );
  expect(activeSession!.entryPage).toBe("/return");

  expect(activeSession!.sessionKey).not.toBe(
    completedSession!.sessionKey,
  );

  expect(result.sessionKey).toBe(activeSession!.sessionKey);
});

it("AN-SESSION-06：Session 应保存创建时的时区和统计日期快照", async () => {
  const testVisitorKey = "d".repeat(64);

  // UTC 时间为 11 月 11 日，但上海时间已经是 11 月 12 日。
  const firstVisit = new Date("2026-11-11T18:30:00.000Z");

  await createSession(
    firstVisit,
    "/timezone-first",
    testVisitorKey,
    "Asia/Shanghai",
  );

  // 模拟后续请求传入不同的时区。
  // 已创建 Session 的 timezone 和 statDate 不应被覆盖。
  const secondVisit = addMinutes(firstVisit, 5);

  await createSession(
    secondVisit,
    "/timezone-second",
    testVisitorKey,
    "America/Los_Angeles",
  );

  const sessions = await db
    .select()
    .from(analyticsSessionFacts)
    .where(
      eq(analyticsSessionFacts.visitorKey, testVisitorKey),
    );

  expect(sessions).toHaveLength(1);

  expect(sessions[0].status).toBe("active");
  expect(sessions[0].pageViewCount).toBe(2);

  expect(sessions[0].timezone).toBe("Asia/Shanghai");
  expect(sessions[0].statDate).toBe("2026-11-12");

  expect(sessions[0].startedAt.getTime()).toBe(
    firstVisit.getTime(),
  );

  expect(sessions[0].lastActivityAt.getTime()).toBe(
    secondVisit.getTime(),
  );
});

it("AN-SESSION-07：新 Session 应使用创建时传入的新时区", async () => {
  const testVisitorKey = "e".repeat(64);

  const firstVisit = new Date("2026-11-11T18:30:00.000Z");
  const secondVisit = addMinutes(firstVisit, 31);

  await createSession(
    firstVisit,
    "/first",
    testVisitorKey,
    "Asia/Shanghai",
  );

  await createSession(
    secondVisit,
    "/second",
    testVisitorKey,
    "America/Los_Angeles",
  );

  const sessions = await db
    .select()
    .from(analyticsSessionFacts)
    .where(
      eq(analyticsSessionFacts.visitorKey, testVisitorKey),
    );

  expect(sessions).toHaveLength(2);

  const oldSession = sessions.find(
    (session) => session.status === "completed",
  );

  const newSession = sessions.find(
    (session) => session.status === "active",
  );

  expect(oldSession).toBeDefined();
  expect(newSession).toBeDefined();

  expect(oldSession!.timezone).toBe("Asia/Shanghai");
  expect(oldSession!.statDate).toBe("2026-11-12");

  expect(newSession!.timezone).toBe("America/Los_Angeles");
  expect(newSession!.statDate).toBe("2026-11-11");
  expect(newSession!.startedAt.getTime()).toBe(
    secondVisit.getTime(),
  );
});
});


import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import {
  acquireVisitorSessionLock,
} from "../../netlify/functions/_shared/analytics/session-lock";

dotenv.config();

const TEST_DATABASE_URL =
  "postgresql://plv_dev:plv_local_dev_2026@localhost:5433/plv_site_monitor_dev";

let db: typeof import("../../db/client").db;
let pool: typeof import("../../db/client").pool;
let sql: typeof import("drizzle-orm").sql;

describe("Analytics Session Advisory Lock", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not configured");
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

    if (databaseUrl !== TEST_DATABASE_URL) {
      throw new Error(
        "DATABASE_URL does not match the approved local test database.",
      );
    }

    const drizzle = await import("drizzle-orm");
    const client = await import("../../db/client");

    db = client.db;
    pool = client.pool;
    sql = drizzle.sql;
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("应支持事务内获取 PostgreSQL Advisory Transaction Lock", async () => {
    const lockKey = "plv-site-monitor:analytics-session-lock-test";

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );

      const queryResult = await tx.execute(
        sql`SELECT 1 AS value`,
      );

      return queryResult;
    });

    expect(result).toBeDefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ value: 1 });
  });

  it("事务结束后应允许再次获取同一把事务级锁", async () => {
    const lockKey = "plv-site-monitor:analytics-session-lock-test";

    const acquireLock = async () =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
        );

        return true;
      });

    const first = await acquireLock();
    const second = await acquireLock();

    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it("相同 Visitor 应使用相同锁身份并允许顺序获取", async () => {
  const siteId = "00000000-0000-4000-8000-000000000001";
  const visitorKey = "a".repeat(64);

  const acquireLock = async () =>
    db.transaction(async (tx) => {
      await acquireVisitorSessionLock(
        tx,
        siteId,
        visitorKey,
        1,
      );
      return true;
    });

  expect(await acquireLock()).toBe(true);
  expect(await acquireLock()).toBe(true);
});

it("不同 Visitor 应能分别获取锁", async () => {
  const siteId = "00000000-0000-4000-8000-000000000001";

  const acquireLock = async (visitorKey: string) =>
    db.transaction(async (tx) => {
      await acquireVisitorSessionLock(
        tx,
        siteId,
        visitorKey,
        1,
      );
      return true;
    });

  expect(await acquireLock("a".repeat(64))).toBe(true);
  expect(await acquireLock("b".repeat(64))).toBe(true);
});

it("无效 Visitor 锁参数应被拒绝", async () => {
  await expect(
    db.transaction(async (tx) => {
      await acquireVisitorSessionLock(tx, "", "a".repeat(64), 1);
    }),
  ).rejects.toThrow("siteId must not be empty");

  await expect(
    db.transaction(async (tx) => {
      await acquireVisitorSessionLock(
        tx,
        "00000000-0000-4000-8000-000000000001",
        "a".repeat(64),
        0,
      );
    }),
  ).rejects.toThrow("visitorKeyVersion");
});
  
});

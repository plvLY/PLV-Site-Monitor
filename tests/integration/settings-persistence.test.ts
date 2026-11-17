
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_DATABASE_URL =
  "postgresql://plv_dev:plv_local_dev_2026@localhost:5433/plv_site_monitor_dev";

let db: typeof import("../../db/client").db;
let pool: typeof import("../../db/client").pool;
let systemSettings: typeof import("../../db/system-settings-schema").systemSettings;
let eq: typeof import("drizzle-orm").eq;

let getSystemSettings:
  typeof import("../../netlify/functions/_shared/settings/settings-service").getSystemSettings;

let updateSystemSettings:
  typeof import("../../netlify/functions/_shared/settings/settings-service").updateSystemSettings;

async function withRollback(
  assertion: (tx: typeof db) => Promise<void>,
): Promise<void> {
  const rollbackSignal = new Error(
    "ROLLBACK_SYSTEM_SETTINGS_INTEGRATION_TEST",
  );

  try {
    await db.transaction(async (tx) => {
      await assertion(tx as unknown as typeof db);

      // 主动回滚，避免修改全局 system_settings 单例配置。
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) {
      throw error;
    }
  }
}

describe("System Settings Persistence Integration", () => {
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
      settingsSchemaModule,
      drizzleModule,
      settingsServiceModule,
    ] = await Promise.all([
      import("../../db/client"),
      import("../../db/system-settings-schema"),
      import("drizzle-orm"),
      import("../../netlify/functions/_shared/settings/settings-service"),
    ]);

    db = clientModule.db;
    pool = clientModule.pool;
    systemSettings = settingsSchemaModule.systemSettings;
    eq = drizzleModule.eq;
    getSystemSettings = settingsServiceModule.getSystemSettings;
    updateSystemSettings = settingsServiceModule.updateSystemSettings;
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("initializes default settings when the singleton row is missing", async () => {
    await withRollback(async (tx) => {
      await tx
        .delete(systemSettings)
        .where(eq(systemSettings.id, 1));

      const result = await getSystemSettings(tx);

      expect(result).toEqual({
        retention: {
          event_retention_days: 90,
          ip_retention_days: 30,
          user_agent_retention_days: 30,
        },
        privacy: {
          store_raw_ip: true,
        },
      });

      const rows = await tx
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.id, 1));

      expect(rows).toHaveLength(1);
    });
  });

  it("does not overwrite persisted settings during repeated initialization", async () => {
    await withRollback(async (tx) => {
      await tx
        .delete(systemSettings)
        .where(eq(systemSettings.id, 1));

      await tx.insert(systemSettings).values({
        id: 1,
        eventRetentionDays: 60,
        ipRetentionDays: 20,
        userAgentRetentionDays: 15,
        storeRawIp: false,
      });

      const firstRead = await getSystemSettings(tx);
      const secondRead = await getSystemSettings(tx);

      const expected = {
        retention: {
          event_retention_days: 60,
          ip_retention_days: 20,
          user_agent_retention_days: 15,
        },
        privacy: {
          store_raw_ip: false,
        },
      };

      expect(firstRead).toEqual(expected);
      expect(secondRead).toEqual(expected);

      const rows = await tx
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.id, 1));

      expect(rows).toHaveLength(1);
    });
  });

  it("persists partial updates and returns the latest database values", async () => {
    await withRollback(async (tx) => {
      await tx
        .delete(systemSettings)
        .where(eq(systemSettings.id, 1));

      await getSystemSettings(tx);

      const updated = await updateSystemSettings(
        {
          ipRetentionDays: 14,
          storeRawIp: false,
        },
        tx,
      );

      expect(updated.retention.ip_retention_days).toBe(14);
      expect(updated.privacy.store_raw_ip).toBe(false);

      const reread = await getSystemSettings(tx);

      expect(reread).toEqual({
        retention: {
          event_retention_days: 90,
          ip_retention_days: 14,
          user_agent_retention_days: 30,
        },
        privacy: {
          store_raw_ip: false,
        },
      });

      const [row] = await tx
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.id, 1))
        .limit(1);

      expect(row).toBeDefined();
      expect(row.eventRetentionDays).toBe(90);
      expect(row.ipRetentionDays).toBe(14);
      expect(row.userAgentRetentionDays).toBe(30);
      expect(row.storeRawIp).toBe(false);
    });
  });
});

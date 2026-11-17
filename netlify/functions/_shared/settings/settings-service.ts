import { eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import { systemSettings } from "../../../../db/system-settings-schema";
import { SYSTEM_SETTINGS_DEFAULTS, SYSTEM_SETTINGS_ID } from "./settings-defaults";
import type { SystemSettingsDto, SystemSettingsPatch } from "./settings-types";

type Database = typeof db;

async function ensureSettingsRow(database: Database): Promise<void> {
  await database
    .insert(systemSettings)
    .values({
      id: SYSTEM_SETTINGS_ID,
      ...SYSTEM_SETTINGS_DEFAULTS,
    })
    .onConflictDoNothing({ target: systemSettings.id });
}

function toDto(row: typeof systemSettings.$inferSelect): SystemSettingsDto {
  return {
    retention: {
      event_retention_days: row.eventRetentionDays,
      ip_retention_days: row.ipRetentionDays,
      user_agent_retention_days: row.userAgentRetentionDays,
    },
    privacy: {
      store_raw_ip: row.storeRawIp,
    },
  };
}

/**
 * Read the singleton settings record. The insert is idempotent and protects
 * deployments where the migration's seed row has not yet been applied.
 */
export async function getSystemSettings(
  database: Database = db,
): Promise<SystemSettingsDto> {
  await ensureSettingsRow(database);

  const [row] = await database
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
    .limit(1);

  if (!row) {
    throw new Error("System settings row could not be initialized.");
  }

  return toDto(row);
}

/**
 * Apply a validated partial update in one SQL UPDATE statement.
 * Fields omitted from the patch are not changed.
 */
export async function updateSystemSettings(
  patch: SystemSettingsPatch,
  database: Database = db,
): Promise<SystemSettingsDto> {
  await ensureSettingsRow(database);

  const values = {
    ...(patch.eventRetentionDays !== undefined
      ? { eventRetentionDays: patch.eventRetentionDays }
      : {}),
    ...(patch.ipRetentionDays !== undefined
      ? { ipRetentionDays: patch.ipRetentionDays }
      : {}),
    ...(patch.userAgentRetentionDays !== undefined
      ? { userAgentRetentionDays: patch.userAgentRetentionDays }
      : {}),
    ...(patch.storeRawIp !== undefined
      ? { storeRawIp: patch.storeRawIp }
      : {}),
    updatedAt: new Date(),
  };

  const [row] = await database
    .update(systemSettings)
    .set(values)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
    .returning();

  if (!row) {
    throw new Error("System settings row could not be updated.");
  }

  return toDto(row);
}

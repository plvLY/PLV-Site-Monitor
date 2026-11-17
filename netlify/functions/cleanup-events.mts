
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/client";
import { getSystemSettings } from "./_shared/settings/settings-service";
import type { SystemSettingsDto } from "./_shared/settings/settings-types";
import { cleanupExpiredEvents } from "./_shared/event-retention";

type Database = typeof db;

type SettingsReader = (
  database: Database,
) => Promise<SystemSettingsDto>;

interface EventCleanupResult {
  cutoff: Date;
  deletedCount: number;
}

type EventCleanupRunner = (
  database: Database,
  retentionDays: number,
  now: Date,
) => Promise<EventCleanupResult>;

interface CleanupEventsDependencies {
  database?: Database;
  readSettings?: SettingsReader;
  cleanup?: EventCleanupRunner;
  now?: () => Date;
}

/** 可注入依赖，生产环境必须读取持久化系统配置。 */
export function createCleanupEventsHandler(
  dependencies: CleanupEventsDependencies = {},
) {
  const database = dependencies.database ?? db;
  const readSettings = dependencies.readSettings ?? getSystemSettings;
  const cleanup = dependencies.cleanup ?? cleanupExpiredEvents;
  const now = dependencies.now ?? (() => new Date());

  return async function handler(
    _request: Request,
    _context: Context,
  ): Promise<Response> {
    try {
      // Fail closed：配置读取失败时不执行清理。
      const settings = await readSettings(database);
      const retentionDays = settings.retention.event_retention_days;

      const result = await cleanup(
        database,
        retentionDays,
        now(),
      );

      console.info(
        `[PLV Site Monitor] Event retention cleanup completed. Retention days: ${retentionDays}. Deleted records: ${result.deletedCount}`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          retention_days: retentionDays,
          cutoff: result.cutoff.toISOString(),
          deleted_count: result.deletedCount,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    } catch (error) {
      console.error(
        "[PLV Site Monitor] Event retention cleanup failed:",
        error,
      );

      return new Response(
        JSON.stringify({
          success: false,
          message: "Event retention cleanup failed.",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    }
  };
}

const handler = createCleanupEventsHandler();

export default handler;

export const config: Config = {
  schedule: "@daily",
};

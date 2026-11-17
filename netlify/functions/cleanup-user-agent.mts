
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/client";
import { getSystemSettings } from "./_shared/settings/settings-service";
import type { SystemSettingsDto } from "./_shared/settings/settings-types";
import { cleanupExpiredUserAgents } from "./_shared/user-agent-retention";

type Database = typeof db;

type SettingsReader = (
  database: Database,
) => Promise<SystemSettingsDto>;

type UserAgentCleanupRunner = (
  database: Database,
  retentionDays: number,
  now: Date,
) => Promise<number>;

interface CleanupUserAgentDependencies {
  database?: Database;
  readSettings?: SettingsReader;
  cleanup?: UserAgentCleanupRunner;
  now?: () => Date;
}

/** 可注入依赖，生产环境必须读取持久化系统配置。 */
export function createCleanupUserAgentHandler(
  dependencies: CleanupUserAgentDependencies = {},
) {
  const database = dependencies.database ?? db;
  const readSettings = dependencies.readSettings ?? getSystemSettings;
  const cleanup = dependencies.cleanup ?? cleanupExpiredUserAgents;
  const now = dependencies.now ?? (() => new Date());

  return async function handler(
    _request: Request,
    _context: Context,
  ): Promise<Response> {
    try {
      // Fail closed：配置读取失败时不执行清理。
      const settings = await readSettings(database);
      const retentionDays = settings.retention.user_agent_retention_days;

      const cleanedCount = await cleanup(
        database,
        retentionDays,
        now(),
      );

      console.info(
        `[PLV Site Monitor] User-Agent retention cleanup completed. Retention days: ${retentionDays}. Cleaned records: ${cleanedCount}`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          retention_days: retentionDays,
          cleaned_count: cleanedCount,
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
        "[PLV Site Monitor] User-Agent retention cleanup failed:",
        error,
      );

      return new Response(
        JSON.stringify({
          success: false,
          message: "User-Agent retention cleanup failed.",
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

const handler = createCleanupUserAgentHandler();

export default handler;

export const config: Config = {
  schedule: "@daily",
};

import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/client";
import { getSystemSettings } from "./_shared/settings/settings-service";
import type { SystemSettingsDto } from "./_shared/settings/settings-types";
import { cleanupExpiredIpAddresses } from "./_shared/ip-retention";

type Database = typeof db;
type SettingsReader = (database: Database) => Promise<SystemSettingsDto>;
type IpCleanupRunner = (database: Database, retentionDays: number, now: Date) => Promise<number>;

interface CleanupIpDependencies {
  database?: Database;
  readSettings?: SettingsReader;
  cleanup?: IpCleanupRunner;
  now?: () => Date;
}

/** 可注入依赖以便测试；生产环境始终先读取持久化系统配置。 */
export function createCleanupIpHandler(dependencies: CleanupIpDependencies = {}) {
  const database = dependencies.database ?? db;
  const readSettings = dependencies.readSettings ?? getSystemSettings;
  const cleanup = dependencies.cleanup ?? cleanupExpiredIpAddresses;
  const now = dependencies.now ?? (() => new Date());

  return async function handler(_request: Request, _context: Context): Promise<Response> {
    try {
      // Fail closed：配置读取失败时不得回退到固定默认期限执行清理。
      const settings = await readSettings(database);
      const retentionDays = settings.retention.ip_retention_days;
      const cleanedCount = await cleanup(database, retentionDays, now());

      console.info(
        `[PLV Site Monitor] IP retention cleanup completed. Retention days: ${retentionDays}. Cleaned records: ${cleanedCount}`,
      );
      return new Response(JSON.stringify({
        success: true,
        retention_days: retentionDays,
        cleaned_count: cleanedCount,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    } catch (error) {
      console.error("[PLV Site Monitor] IP retention cleanup failed:", error);
      return new Response(JSON.stringify({
        success: false,
        message: "IP retention cleanup failed.",
      }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  };
}

const handler = createCleanupIpHandler();
export default handler;

export const config: Config = {
  schedule: "@daily",
};

import { and, isNotNull, lt } from "drizzle-orm";
import { pageEvents } from "../../../db/schema";

type Database = typeof import("../../../db/client").db;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** IP 保留期限的产品硬上限。实际清理期限必须来自 system_settings。 */
export const MAX_IP_RETENTION_DAYS = 30;

/** 严格早于截止时间的数据才会被清理；期限必须为 1～30 天。 */
export function getIpRetentionCutoff(
  now: Date,
  retentionDays: number,
): Date {
  if (Number.isNaN(now.getTime())) {
    throw new Error("Invalid current date.");
  }
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_IP_RETENTION_DAYS) {
    throw new Error(`retentionDays must be an integer between 1 and ${MAX_IP_RETENTION_DAYS}.`);
  }
  return new Date(now.getTime() - retentionDays * DAY_IN_MS);
}

/** 仅将过期原始 IP 置为 NULL，不删除事件或修改其他字段。 */
export async function cleanupExpiredIpAddresses(
  database: Database,
  retentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = getIpRetentionCutoff(now, retentionDays);
  const rows = await database
    .update(pageEvents)
    .set({ ipAddress: null })
    .where(and(lt(pageEvents.receivedAt, cutoff), isNotNull(pageEvents.ipAddress)))
    .returning({ id: pageEvents.id });
  return rows.length;
}

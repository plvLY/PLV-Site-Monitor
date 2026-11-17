
import { and, isNotNull, lt } from "drizzle-orm";
import { pageEvents } from "../../../db/schema";

type Database = typeof import("../../../db/client").db;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** User-Agent 保留期限的产品硬上限。 */
export const MAX_USER_AGENT_RETENTION_DAYS = 30;

/**
 * 计算 User-Agent 清理截止时间。
 * 仅允许 1～30 天的整数保留期限。
 */
export function getUserAgentRetentionCutoff(
  now: Date,
  retentionDays: number,
): Date {
  if (Number.isNaN(now.getTime())) {
    throw new Error("Invalid current date.");
  }

  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > MAX_USER_AGENT_RETENTION_DAYS
  ) {
    throw new Error(
      `retentionDays must be an integer between 1 and ${MAX_USER_AGENT_RETENTION_DAYS}.`,
    );
  }

  return new Date(now.getTime() - retentionDays * DAY_IN_MS);
}

/**
 * 仅将过期原始 User-Agent 设置为 NULL。
 *
 * 不删除事件，不修改 IP、Geo 或其他统计字段。
 */
export async function cleanupExpiredUserAgents(
  database: Database,
  retentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = getUserAgentRetentionCutoff(now, retentionDays);

  const rows = await database
    .update(pageEvents)
    .set({ userAgent: null })
    .where(
      and(
        lt(pageEvents.receivedAt, cutoff),
        isNotNull(pageEvents.userAgent),
      ),
    )
    .returning({ id: pageEvents.id });

  return rows.length;
}

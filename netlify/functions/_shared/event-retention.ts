
import { lt } from "drizzle-orm";
import { db } from "../../../db/client";
import { pageEvents } from "../../../db/schema";

/**
 * 原始事件最大保留期限（天）
 */
export const MAX_EVENT_RETENTION_DAYS = 90;

/**
 * 原始事件最小保留期限（天）
 */
export const MIN_EVENT_RETENTION_DAYS = 1;

/**
 * 校验原始事件保留期限
 */
function validateRetentionDays(retentionDays: number): void {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < MIN_EVENT_RETENTION_DAYS ||
    retentionDays > MAX_EVENT_RETENTION_DAYS
  ) {
    throw new Error(
      `Invalid event retention days: ${retentionDays}. ` +
      `Expected an integer between ${MIN_EVENT_RETENTION_DAYS} and ${MAX_EVENT_RETENTION_DAYS}.`,
    );
  }
}

/**
 * 按动态保留期限清理过期原始事件
 *
 * 仅删除 page_events，不影响 Analytics Facts、
 * Session Facts 和 Daily Aggregates。
 *
 * 删除边界：received_at < cutoff
 */
export async function cleanupExpiredEvents(
  database: typeof db,
  retentionDays: number,
  now: Date = new Date(),
) {
  validateRetentionDays(retentionDays);

  const cutoff = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
  );

  const deleted = await database
    .delete(pageEvents)
    .where(lt(pageEvents.receivedAt, cutoff))
    .returning({
      id: pageEvents.id,
    });

  return {
    cutoff,
    deletedCount: deleted.length,
  };
}


import { sql } from "drizzle-orm";

export interface AdvisoryLockTransaction {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/**
 * Acquires a transaction-scoped lock for one Visitor.
 *
 * The lock is automatically released when the surrounding
 * PostgreSQL transaction commits or rolls back.
 *
 * All Page View writes for the same site and Visitor must use
 * the same lock identity.
 */
export async function acquireVisitorSessionLock(
  tx: AdvisoryLockTransaction,
  siteId: string,
  visitorKey: string,
  visitorKeyVersion: number,
): Promise<void> {
  if (!siteId.trim()) {
    throw new Error("siteId must not be empty");
  }

  if (!visitorKey.trim()) {
    throw new Error("visitorKey must not be empty");
  }

  if (
    !Number.isSafeInteger(visitorKeyVersion) ||
    visitorKeyVersion <= 0
  ) {
    throw new Error("visitorKeyVersion must be a positive integer");
  }

  const lockIdentity =
    `plv-sm:analytics-session-lock:v1:${siteId}:` +
    `${visitorKeyVersion}:${visitorKey}`;

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`,
  );
}

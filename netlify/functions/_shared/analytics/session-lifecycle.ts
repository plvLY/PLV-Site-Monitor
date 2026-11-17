
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { analyticsSessionFacts } from "../../../../db/analytics-schema";
import { createAnalyticsIdentity } from "./identity";
import {
  acquireVisitorSessionLock,
  type AdvisoryLockTransaction,
} from "./session-lock";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export interface CreateOrUpdateAnalyticsSessionInput {
  siteId: string;
  visitorKey: string;
  visitorKeyVersion: number;
  pagePath: string;
  receivedAt: Date | (() => Date);
  timezone: string;
  sessionKeySecret: string;
  sessionKeyVersion: number;
  sessionModelVersion: number;
}

function getStatDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function validateInput(input: CreateOrUpdateAnalyticsSessionInput): void {
  if (!input.siteId.trim()) {
    throw new Error("siteId must not be empty");
  }

  if (!input.visitorKey.trim()) {
    throw new Error("visitorKey must not be empty");
  }

  if (!input.pagePath.trim()) {
    throw new Error("pagePath must not be empty");
  }

  if (!input.timezone.trim()) {
    throw new Error("timezone must not be empty");
  }

  // Validate the timezone before any database write.
  new Intl.DateTimeFormat("en-US", {
    timeZone: input.timezone,
  });

  for (const [name, value] of [
    ["visitorKeyVersion", input.visitorKeyVersion],
    ["sessionKeyVersion", input.sessionKeyVersion],
    ["sessionModelVersion", input.sessionModelVersion],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
}

/**
 * Creates or updates the server-side Analytics Session.
 *
 * The caller owns the transaction. This function never starts
 * or commits a transaction independently.
 *
 * The current Tracker tab-level session_id must never be used
 * as the Analytics Session identity.
 */
export async function createOrUpdateAnalyticsSession(
  tx: any,
  input: CreateOrUpdateAnalyticsSessionInput,
) {
  validateInput(input);

  await acquireVisitorSessionLock(
    tx as AdvisoryLockTransaction,
    input.siteId,
    input.visitorKey,
    input.visitorKeyVersion,
  );

  // 必须在 Visitor 锁获取后生成接收时间，
  // 保证同一 Visitor 的 Session 时间顺序与事务处理顺序一致。
  const receivedAt =
    typeof input.receivedAt === "function"
      ? input.receivedAt()
      : input.receivedAt;

  if (
    !(receivedAt instanceof Date) ||
    Number.isNaN(receivedAt.getTime())
  ) {
    throw new Error("receivedAt must be a valid Date");
  }

  const [activeSession] = await tx
    .select()
    .from(analyticsSessionFacts)
    .where(
      and(
        eq(analyticsSessionFacts.siteId, input.siteId),
        eq(analyticsSessionFacts.visitorKey, input.visitorKey),
        eq(
          analyticsSessionFacts.visitorKeyVersion,
          input.visitorKeyVersion,
        ),
        eq(analyticsSessionFacts.status, "active"),
      ),
    )
    .limit(1);

  if (activeSession) {
    const elapsed =
      receivedAt.getTime() -
      activeSession.lastActivityAt.getTime();

    if (elapsed < SESSION_TIMEOUT_MS) {
      const [updatedSession] = await tx
        .update(analyticsSessionFacts)
        .set({
          lastActivityAt: receivedAt,
          exitPage: input.pagePath,
          pageViewCount: activeSession.pageViewCount + 1,
          updatedAt: receivedAt,
        })
        .where(eq(analyticsSessionFacts.id, activeSession.id))
        .returning();

      return updatedSession;
    }

    // The old Session expires 30 minutes after its last
    // successful Page View, not at the next visit time.
    const endedAt = new Date(
      activeSession.lastActivityAt.getTime() + SESSION_TIMEOUT_MS,
    );

    await tx
      .update(analyticsSessionFacts)
      .set({
        status: "completed",
        endedAt,
        updatedAt: receivedAt,
      })
      .where(eq(analyticsSessionFacts.id, activeSession.id));
  }

  // Generate a new server-side identity only when creating
  // a new Analytics Session.
  const identity = createAnalyticsIdentity({
    secret: input.sessionKeySecret,
    keyVersion: input.sessionKeyVersion,
  });

  const sessionIdentity = randomUUID();

  const sessionKey = identity.createSessionKey(
    input.siteId,
    sessionIdentity,
  );

  const [newSession] = await tx
    .insert(analyticsSessionFacts)
    .values({
      siteId: input.siteId,
      sessionKey: sessionKey.key,
      sessionKeyVersion: sessionKey.keyVersion,
      visitorKey: input.visitorKey,
      visitorKeyVersion: input.visitorKeyVersion,
      sessionModelVersion: input.sessionModelVersion,
      startedAt: receivedAt,
      lastActivityAt: receivedAt,
      endedAt: null,
      timezone: input.timezone,
      statDate: getStatDate(receivedAt, input.timezone),
      entryPage: input.pagePath,
      exitPage: input.pagePath,
      pageViewCount: 1,
      status: "active",
      createdAt: receivedAt,
      updatedAt: receivedAt,
    })
    .returning();

  return newSession;
}


import {
  createHash,
  randomBytes,
} from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "../../../../db/client";
import { adminSessions, adminUsers } from "../../../../db/auth-schema";

const SESSION_TOKEN_BYTES = 32;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Database = typeof db;

export interface AdminSessionIdentity {
  sessionId: string;
  adminUserId: number;
  username: string;
}

export interface CreatedAdminSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export interface AdminSessionRepository {
  create(input: {
    adminUserId: number;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<{ id: string }>;

  findActive(
    tokenHash: string,
    now: Date,
  ): Promise<AdminSessionIdentity | null>;

  touch(sessionId: string, now: Date): Promise<boolean>;

  revoke(tokenHash: string, now: Date): Promise<boolean>;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isValidToken(token: unknown): token is string {
  if (
    typeof token !== "string" ||
    !SESSION_TOKEN_PATTERN.test(token)
  ) {
    return false;
  }

  const decoded = Buffer.from(token, "base64url");

  return (
    decoded.length === SESSION_TOKEN_BYTES &&
    decoded.toString("base64url") === token
  );
}

function hashSessionToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

function createDatabaseRepository(
  database: Database,
): AdminSessionRepository {
  return {
    async create(input) {
      const [row] = await database
        .insert(adminSessions)
        .values({
          adminUserId: input.adminUserId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          createdAt: input.createdAt,
        })
        .returning({
          id: adminSessions.id,
        });

      if (!row) {
        throw new Error("Admin session creation failed.");
      }

      return row;
    },

    async findActive(tokenHash, now) {
      const [row] = await database
        .select({
          sessionId: adminSessions.id,
          adminUserId: adminUsers.id,
          username: adminUsers.username,
        })
        .from(adminSessions)
        .innerJoin(
          adminUsers,
          eq(adminSessions.adminUserId, adminUsers.id),
        )
        .where(
          and(
            eq(adminSessions.tokenHash, tokenHash),
            isNull(adminSessions.revokedAt),
            gt(adminSessions.expiresAt, now),
          ),
        )
        .limit(1);

      return row ?? null;
    },

    async touch(sessionId, now) {
      const rows = await database
        .update(adminSessions)
        .set({
          lastSeenAt: now,
        })
        .where(
          and(
            eq(adminSessions.id, sessionId),
            isNull(adminSessions.revokedAt),
            gt(adminSessions.expiresAt, now),
          ),
        )
        .returning({
          id: adminSessions.id,
        });

      return rows.length > 0;
    },

    async revoke(tokenHash, now) {
      const rows = await database
        .update(adminSessions)
        .set({
          revokedAt: now,
        })
        .where(
          and(
            eq(adminSessions.tokenHash, tokenHash),
            isNull(adminSessions.revokedAt),
          ),
        )
        .returning({
          id: adminSessions.id,
        });

      return rows.length > 0;
    },
  };
}

/**
 * Create a persistent administrator session.
 *
 * The raw token is returned once to the caller.
 * Only its SHA-256 hash is persisted.
 */
export async function createAdminSession(
  adminUserId: number,
  options: {
    now?: Date;
    repository?: AdminSessionRepository;
    database?: Database;
  } = {},
): Promise<CreatedAdminSession> {
  if (
    !Number.isInteger(adminUserId) ||
    adminUserId < 1 ||
    adminUserId > 32767
  ) {
    throw new Error("Invalid administrator ID.");
  }

  const now = options.now ?? new Date();

  if (!isValidDate(now)) {
    throw new Error("Invalid session creation time.");
  }

  const repository =
    options.repository ??
    createDatabaseRepository(options.database ?? db);

  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  const row = await repository.create({
    adminUserId,
    tokenHash,
    expiresAt,
    createdAt: now,
  });

  return {
    sessionId: row.id,
    token,
    expiresAt,
  };
}

/**
 * Verify an administrator session.
 *
 * Returns null for invalid, expired, revoked, missing sessions,
 * or database failures. Authorization always fails closed.
 */
export async function verifyAdminSession(
  token: string | null | undefined,
  options: {
    now?: Date;
    repository?: AdminSessionRepository;
    database?: Database;
  } = {},
): Promise<AdminSessionIdentity | null> {
  if (!isValidToken(token)) {
    return null;
  }

  const now = options.now ?? new Date();

  if (!isValidDate(now)) {
    return null;
  }

  try {
    const repository =
      options.repository ??
      createDatabaseRepository(options.database ?? db);

    const tokenHash = hashSessionToken(token);

    const identity = await repository.findActive(tokenHash, now);

    if (!identity) {
      return null;
    }

    // Recheck revocation and expiration atomically before accepting.
    const touched = await repository.touch(identity.sessionId, now);

    return touched ? identity : null;
  } catch {
    return null;
  }
}

/**
 * Revoke the session represented by the supplied raw token.
 *
 * The raw token is never persisted.
 */
export async function revokeAdminSession(
  token: string | null | undefined,
  options: {
    now?: Date;
    repository?: AdminSessionRepository;
    database?: Database;
  } = {},
): Promise<boolean> {
  if (!isValidToken(token)) {
    return false;
  }

  const now = options.now ?? new Date();

  if (!isValidDate(now)) {
    throw new Error("Invalid session revocation time.");
  }

  const repository =
    options.repository ??
    createDatabaseRepository(options.database ?? db);

  const tokenHash = hashSessionToken(token);

  return repository.revoke(tokenHash, now);
}


import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Single super administrator account.
 *
 * The database enforces a singleton account with id = 1.
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: smallint("id").primaryKey().default(1),

    username: varchar("username", {
      length: 64,
    }).notNull(),

    passwordHash: text("password_hash").notNull(),

    passwordChangedAt: timestamp("password_changed_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("admin_users_username_uidx").on(table.username),

    check(
      "admin_users_singleton_id_check",
      sql`${table.id} = 1`,
    ),

    check(
      "admin_users_username_format_check",
      sql`${table.username} = lower(${table.username})
        AND ${table.username} ~ '^[a-z0-9._-]{3,64}$'`,
    ),
  ],
);

/**
 * Persistent administrator login sessions.
 *
 * Only the SHA-256 hash of the session token is stored.
 */
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    adminUserId: smallint("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: "cascade",
      }),

    tokenHash: varchar("token_hash", {
      length: 64,
    }).notNull(),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date",
    }),

    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_hash_uidx").on(
      table.tokenHash,
    ),

    index("admin_sessions_admin_user_id_idx").on(
      table.adminUserId,
    ),

    index("admin_sessions_expires_at_idx").on(
      table.expiresAt,
    ),

    check(
      "admin_sessions_token_hash_format_check",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;

export type AdminSession = typeof adminSessions.$inferSelect;
export type NewAdminSession = typeof adminSessions.$inferInsert;

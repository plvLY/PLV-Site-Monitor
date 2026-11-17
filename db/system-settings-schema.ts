import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  smallint,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Global singleton configuration for PLV Site Monitor.
 *
 * Retention values are configurable only within the product's hard limits.
 * Raw IP storage can be disabled without disabling Geo analytics.
 */
export const systemSettings = pgTable(
  "system_settings",
  {
    id: smallint("id").primaryKey().default(1),

    eventRetentionDays: integer("event_retention_days")
      .notNull()
      .default(90),

    ipRetentionDays: integer("ip_retention_days")
      .notNull()
      .default(30),

    userAgentRetentionDays: integer("user_agent_retention_days")
      .notNull()
      .default(30),

    storeRawIp: boolean("store_raw_ip")
      .notNull()
      .default(true),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (table) => [
    check("system_settings_singleton_id_check", sql`${table.id} = 1`),
    check(
      "system_settings_event_retention_check",
      sql`${table.eventRetentionDays} BETWEEN 1 AND 90`,
    ),
    check(
      "system_settings_ip_retention_check",
      sql`${table.ipRetentionDays} BETWEEN 1 AND 30`,
    ),
    check(
      "system_settings_user_agent_retention_check",
      sql`${table.userAgentRetentionDays} BETWEEN 1 AND 30`,
    ),
  ],
);

export type SystemSettings = typeof systemSettings.$inferSelect;
export type NewSystemSettings = typeof systemSettings.$inferInsert;

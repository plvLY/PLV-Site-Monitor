
import { sql } from "drizzle-orm";
import { sites } from "./schema";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  bigserial,
  bigint,
  integer,
  smallint,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";

/**
 * 长期事件事实表
 *
 * 不保存原始 visitor_id、session_id、IP、UA 和完整 URL。
 */
export const analyticsEventFacts = pgTable(
  "analytics_event_facts",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    siteId: uuid("site_id").notNull().references(() => sites.id),

    eventId: uuid("event_id").notNull(),

    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    statDate: date("stat_date", { mode: "string" }).notNull(),

    timezone: varchar("timezone", { length: 64 }).notNull(),

    visitorKey: varchar("visitor_key", { length: 64 }).notNull(),

    visitorKeyVersion: smallint("visitor_key_version").notNull(),

    sessionKey: varchar("session_key", { length: 64 }).notNull(),

    sessionKeyVersion: smallint("session_key_version").notNull(),

    pagePath: varchar("page_path", { length: 1024 }).notNull(),

    pageTitle: varchar("page_title", { length: 500 }),

    referrerHost: varchar("referrer_host", { length: 255 }),

    utmSource: varchar("utm_source", { length: 255 }),
    utmMedium: varchar("utm_medium", { length: 255 }),
    utmCampaign: varchar("utm_campaign", { length: 255 }),
    utmTerm: varchar("utm_term", { length: 255 }),
    utmContent: varchar("utm_content", { length: 255 }),

    browser: varchar("browser", { length: 100 }),
    os: varchar("os", { length: 100 }),
    deviceType: varchar("device_type", { length: 32 }),

    countryCode: varchar("country_code", { length: 10 }),
    region: varchar("region", { length: 120 }),
    city: varchar("city", { length: 120 }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("analytics_event_facts_site_event_uidx").on(
      table.siteId,
      table.eventId,
    ),

    index("analytics_event_facts_site_date_idx").on(
      table.siteId,
      table.statDate,
    ),

    index("analytics_event_facts_site_received_idx").on(
      table.siteId,
      table.receivedAt,
    ),

    index("analytics_event_facts_site_visitor_idx").on(
      table.siteId,
      table.visitorKey,
      table.visitorKeyVersion,
      table.receivedAt,
    ),

    index("analytics_event_facts_site_session_idx").on(
      table.siteId,
      table.sessionKey,
      table.sessionKeyVersion,
      table.receivedAt,
    ),

    check(
      "analytics_event_facts_visitor_key_version_check",
      sql`${table.visitorKeyVersion} > 0`,
    ),

    check(
      "analytics_event_facts_session_key_version_check",
      sql`${table.sessionKeyVersion} > 0`,
    ),
  ],
);

/**
 * 长期 Session 事实表
 *
 * sessionModelVersion:
 * 1 = 历史兼容 Tab Session
 * 2 = 新版 Analytics Session
 */
export const analyticsSessionFacts = pgTable(
  "analytics_session_facts",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    siteId: uuid("site_id").notNull().references(() => sites.id),

    sessionKey: varchar("session_key", { length: 64 }).notNull(),

    sessionKeyVersion: smallint("session_key_version").notNull(),

    visitorKey: varchar("visitor_key", { length: 64 }).notNull(),

    visitorKeyVersion: smallint("visitor_key_version").notNull(),

    sessionModelVersion: smallint("session_model_version").notNull(),

    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    lastActivityAt: timestamp("last_activity_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    endedAt: timestamp("ended_at", {
      withTimezone: true,
      mode: "date",
    }),

    timezone: varchar("timezone", { length: 64 }).notNull(),

    statDate: date("stat_date", { mode: "string" }).notNull(),

    entryPage: varchar("entry_page", { length: 1024 }).notNull(),

    exitPage: varchar("exit_page", { length: 1024 }),

    pageViewCount: integer("page_view_count").notNull().default(1),

    status: varchar("status", { length: 16 })
      .notNull()
      .default("active"),

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
    uniqueIndex("analytics_session_facts_site_session_uidx").on(
      table.siteId,
      table.sessionKey,
      table.sessionKeyVersion,
    ),

    uniqueIndex("analytics_session_one_active_uidx")
      .on(
        table.siteId,
        table.visitorKey,
        table.visitorKeyVersion,
      )
      .where(sql`${table.status} = 'active'`),

    index("analytics_session_facts_site_date_idx").on(
      table.siteId,
      table.statDate,
    ),

    index("analytics_session_facts_site_visitor_idx").on(
      table.siteId,
      table.visitorKey,
      table.visitorKeyVersion,
    ),

    check(
      "analytics_session_status_check",
      sql`${table.status} IN ('active', 'completed')`,
    ),

    check(
      "analytics_session_page_view_count_check",
      sql`${table.pageViewCount} > 0`,
    ),

    check(
      "analytics_session_status_ended_check",
      sql`(
        (${table.status} = 'active' AND ${table.endedAt} IS NULL)
        OR
        (${table.status} = 'completed' AND ${table.endedAt} IS NOT NULL)
      )`,
    ),

    check(
      "analytics_session_model_version_check",
      sql`${table.sessionModelVersion} IN (1, 2)`,
    ),
  ],
);

/**
 * 日级全站统计
 */
export const analyticsDailyOverview = pgTable(
  "analytics_daily_overview",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    siteId: uuid("site_id").notNull().references(() => sites.id),

    statDate: date("stat_date", { mode: "string" }).notNull(),

    timezone: varchar("timezone", { length: 64 }).notNull(),

    pageViews: bigint("page_views", { mode: "bigint" })
      .notNull()
      .default(0n),

    visitors: bigint("visitors", { mode: "bigint" })
      .notNull()
      .default(0n),

    sessions: bigint("sessions", { mode: "bigint" })
      .notNull()
      .default(0n),

    completedSessions: bigint("completed_sessions", { mode: "bigint" })
      .notNull()
      .default(0n),

    bounceSessions: bigint("bounce_sessions", { mode: "bigint" })
      .notNull()
      .default(0n),

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
    uniqueIndex("analytics_daily_overview_unique_idx").on(
      table.siteId,
      table.statDate,
      table.timezone,
    ),

    index("analytics_daily_overview_site_date_idx").on(
      table.siteId,
      table.statDate,
    ),
  ],
);

/**
 * 页面日级统计
 */
export const analyticsDailyPages = pgTable(
  "analytics_daily_pages",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    siteId: uuid("site_id").notNull().references(() => sites.id),

    statDate: date("stat_date", { mode: "string" }).notNull(),

    timezone: varchar("timezone", { length: 64 }).notNull(),

    pagePath: varchar("page_path", { length: 1024 }).notNull(),

    pageViews: bigint("page_views", { mode: "bigint" })
      .notNull()
      .default(0n),

    uniqueVisitors: bigint("unique_visitors", { mode: "bigint" })
      .notNull()
      .default(0n),

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
    uniqueIndex("analytics_daily_pages_unique_idx").on(
      table.siteId,
      table.statDate,
      table.timezone,
      table.pagePath,
    ),

    index("analytics_daily_pages_site_date_idx").on(
      table.siteId,
      table.statDate,
    ),
  ],
);

/**
 * 来源与 UTM 日级统计
 */
export const analyticsDailySources = pgTable(
  "analytics_daily_sources",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    siteId: uuid("site_id").notNull().references(() => sites.id),

    statDate: date("stat_date", { mode: "string" }).notNull(),

    timezone: varchar("timezone", { length: 64 }).notNull(),

    dimension: varchar("dimension", { length: 32 }).notNull(),

    dimensionKey: varchar("dimension_key", { length: 64 }).notNull(),

    dimensionValue: varchar("dimension_value", { length: 255 }),

    pageViews: bigint("page_views", { mode: "bigint" })
      .notNull()
      .default(0n),

    uniqueVisitors: bigint("unique_visitors", { mode: "bigint" })
      .notNull()
      .default(0n),

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
    uniqueIndex("analytics_daily_sources_unique_idx").on(
      table.siteId,
      table.statDate,
      table.timezone,
      table.dimension,
      table.dimensionKey,
    ),

    index("analytics_daily_sources_site_date_idx").on(
      table.siteId,
      table.statDate,
    ),

    check(
      "analytics_daily_sources_dimension_check",
      sql`${table.dimension} IN (
        'referrer_host',
        'utm_source',
        'utm_medium',
        'utm_campaign'
      )`,
    ),
  ],
);

/**
 * 设备日级统计
 */
export const analyticsDailyDevices = pgTable(
  "analytics_daily_devices",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    siteId: uuid("site_id").notNull().references(() => sites.id),

    statDate: date("stat_date", { mode: "string" }).notNull(),

    timezone: varchar("timezone", { length: 64 }).notNull(),

    dimension: varchar("dimension", { length: 32 }).notNull(),

    dimensionKey: varchar("dimension_key", { length: 64 }).notNull(),

    dimensionValue: varchar("dimension_value", { length: 100 }),

    pageViews: bigint("page_views", { mode: "bigint" })
      .notNull()
      .default(0n),

    uniqueVisitors: bigint("unique_visitors", { mode: "bigint" })
      .notNull()
      .default(0n),

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
    uniqueIndex("analytics_daily_devices_unique_idx").on(
      table.siteId,
      table.statDate,
      table.timezone,
      table.dimension,
      table.dimensionKey,
    ),

    index("analytics_daily_devices_site_date_idx").on(
      table.siteId,
      table.statDate,
    ),

    check(
      "analytics_daily_devices_dimension_check",
      sql`${table.dimension} IN ('browser', 'os', 'device_type')`,
    ),
  ],
);

/**
 * 地域日级统计
 */
export const analyticsDailyLocations = pgTable(
  "analytics_daily_locations",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    siteId: uuid("site_id").notNull().references(() => sites.id),

    statDate: date("stat_date", { mode: "string" }).notNull(),

    timezone: varchar("timezone", { length: 64 }).notNull(),

    countryCode: varchar("country_code", { length: 10 }),

    region: varchar("region", { length: 120 }),

    city: varchar("city", { length: 120 }),

    dimensionKey: varchar("dimension_key", { length: 64 }).notNull(),

    pageViews: bigint("page_views", { mode: "bigint" })
      .notNull()
      .default(0n),

    uniqueVisitors: bigint("unique_visitors", { mode: "bigint" })
      .notNull()
      .default(0n),

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
    uniqueIndex("analytics_daily_locations_unique_idx").on(
      table.siteId,
      table.statDate,
      table.timezone,
      table.dimensionKey,
    ),

    index("analytics_daily_locations_site_date_idx").on(
      table.siteId,
      table.statDate,
    ),
  ],
);

/**
 * 日级精确去重 Membership
 *
 * subjectType:
 * visitor / session
 */
export const analyticsDailyMemberships = pgTable(
  "analytics_daily_memberships",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),

    siteId: uuid("site_id").notNull().references(() => sites.id),

    statDate: date("stat_date", { mode: "string" }).notNull(),

    timezone: varchar("timezone", { length: 64 }).notNull(),

    dimension: varchar("dimension", { length: 32 }).notNull(),

    dimensionKey: varchar("dimension_key", { length: 64 }).notNull(),

    subjectType: varchar("subject_type", { length: 16 }).notNull(),

    subjectKey: varchar("subject_key", { length: 64 }).notNull(),

    subjectKeyVersion: smallint("subject_key_version").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("analytics_daily_memberships_unique_idx").on(
      table.siteId,
      table.statDate,
      table.timezone,
      table.dimension,
      table.dimensionKey,
      table.subjectType,
      table.subjectKeyVersion,
      table.subjectKey,
    ),

    index("analytics_daily_memberships_site_date_idx").on(
      table.siteId,
      table.statDate,
    ),

    check(
      "analytics_daily_memberships_dimension_check",
      sql`${table.dimension} IN (
        'overview',
        'page',
        'referrer_host',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'browser',
        'os',
        'device_type',
        'location'
      )`,
    ),

    check(
      "analytics_daily_memberships_subject_type_check",
      sql`${table.subjectType} IN ('visitor', 'session')`,
    ),

    check(
      "analytics_daily_memberships_subject_version_check",
      sql`${table.subjectKeyVersion} > 0`,
    ),
  ],
);

// Select / Insert 类型
export type AnalyticsEventFact =
  typeof analyticsEventFacts.$inferSelect;
export type NewAnalyticsEventFact =
  typeof analyticsEventFacts.$inferInsert;

export type AnalyticsSessionFact =
  typeof analyticsSessionFacts.$inferSelect;
export type NewAnalyticsSessionFact =
  typeof analyticsSessionFacts.$inferInsert;

export type AnalyticsDailyOverview =
  typeof analyticsDailyOverview.$inferSelect;
export type NewAnalyticsDailyOverview =
  typeof analyticsDailyOverview.$inferInsert;

export type AnalyticsDailyPage =
  typeof analyticsDailyPages.$inferSelect;
export type NewAnalyticsDailyPage =
  typeof analyticsDailyPages.$inferInsert;

export type AnalyticsDailySource =
  typeof analyticsDailySources.$inferSelect;
export type NewAnalyticsDailySource =
  typeof analyticsDailySources.$inferInsert;

export type AnalyticsDailyDevice =
  typeof analyticsDailyDevices.$inferSelect;
export type NewAnalyticsDailyDevice =
  typeof analyticsDailyDevices.$inferInsert;

export type AnalyticsDailyLocation =
  typeof analyticsDailyLocations.$inferSelect;
export type NewAnalyticsDailyLocation =
  typeof analyticsDailyLocations.$inferInsert;

export type AnalyticsDailyMembership =
  typeof analyticsDailyMemberships.$inferSelect;
export type NewAnalyticsDailyMembership =
  typeof analyticsDailyMemberships.$inferInsert;




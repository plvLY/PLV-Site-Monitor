import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  bigserial,
  integer,
  inet,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * 站点主表
 */
export const sites = pgTable("sites", {
  id: uuid("id").defaultRandom().primaryKey(),

  name: varchar("name", { length: 100 }).notNull(),

  // active / disabled / archived
  status: varchar("status", { length: 20 })
    .notNull()
    .default("active"),

  timezone: varchar("timezone", { length: 64 })
    .notNull()
    .default("UTC"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }).notNull().defaultNow(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  }).notNull().defaultNow(),
});

/**
 * 站点域名表
 */
export const siteDomains = pgTable(
  "site_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),

    // 规范化后的纯域名，不包含协议和路径
    domain: varchar("domain", { length: 255 }).notNull(),

    isPrimary: boolean("is_primary")
      .notNull()
      .default(false),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),
  },
  (table) => [
  // 全局域名唯一
  uniqueIndex("site_domains_domain_uidx").on(table.domain),

  // 站点查询索引
  index("site_domains_site_id_idx").on(table.siteId),

  // 每个站点最多只能有一个主域名
  uniqueIndex("site_domains_one_primary_uidx")
    .on(table.siteId)
    .where(sql`${table.isPrimary} = true`),
  ],
);

/**
 * 页面访问事件表
 */
export const pageEvents = pgTable(
  "page_events",
  {
    // 使用 BIGSERIAL，适合持续增长的事件数据
    id: bigserial("id", { mode: "number" }).primaryKey(),

    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),

    // 客户端事件 UUID，用于幂等去重
    eventId: uuid("event_id").notNull(),

    eventType: varchar("event_type", { length: 32 })
      .notNull()
      .default("page_view"),

    visitorId: uuid("visitor_id").notNull(),

    sessionId: uuid("session_id").notNull(),

    pageUrl: varchar("page_url", { length: 2048 }).notNull(),

    pagePath: varchar("page_path", { length: 1024 }).notNull(),

    pageTitle: varchar("page_title", { length: 500 }),

    referrer: varchar("referrer", { length: 2048 }),

    referrerHost: varchar("referrer_host", { length: 255 }),

    // UTM 来源参数
    utmSource: varchar("utm_source", { length: 255 }),
    utmMedium: varchar("utm_medium", { length: 255 }),
    utmCampaign: varchar("utm_campaign", { length: 255 }),
    utmTerm: varchar("utm_term", { length: 255 }),
    utmContent: varchar("utm_content", { length: 255 }),

    // 客户端事件时间
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    // 服务端接收时间
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    }).notNull().defaultNow(),

    userAgent: varchar("user_agent", { length: 1000 }),

    deviceType: varchar("device_type", { length: 32 }),
    browser: varchar("browser", { length: 100 }),
    os: varchar("os", { length: 100 }),

    // 服务端获取，最长保留 30 天
    ipAddress: inet("ip_address"),

    countryCode: varchar("country_code", { length: 10 }),
    region: varchar("region", { length: 120 }),
    city: varchar("city", { length: 120 }),
  },
  (table) => [
    uniqueIndex("page_events_site_event_uidx").on(
      table.siteId,
      table.eventId,
    ),

    index("page_events_site_received_idx").on(
      table.siteId,
      table.receivedAt,
    ),

    index("page_events_site_visitor_received_idx").on(
      table.siteId,
      table.visitorId,
      table.receivedAt,
    ),

    index("page_events_site_session_received_idx").on(
      table.siteId,
      table.sessionId,
      table.receivedAt,
    ),

    index("page_events_site_path_idx").on(
      table.siteId,
      table.pagePath,
    ),
  ],
);


/**
 * Site ID 采集限流计数器
 *
 * 每个站点、每个固定时间窗口保存一条计数记录。
 * 计数通过 PostgreSQL 原子 UPSERT 更新。
 */
export const siteRateLimitCounters = pgTable(
  "site_rate_limit_counters",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),

    windowStart: timestamp("window_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    requestCount: integer("request_count")
      .notNull()
      .default(0),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("site_rate_limit_counters_site_window_uidx")
      .on(table.siteId, table.windowStart),

    index("site_rate_limit_counters_window_start_idx")
      .on(table.windowStart),
  ],
);

// 导出类型，供 Service 层使用
export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

export type SiteDomain = typeof siteDomains.$inferSelect;
export type NewSiteDomain = typeof siteDomains.$inferInsert;

export type PageEvent = typeof pageEvents.$inferSelect;
export type NewPageEvent = typeof pageEvents.$inferInsert;

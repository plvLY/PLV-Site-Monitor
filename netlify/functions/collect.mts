import { resolveVisitorMetadata } from "./_shared/visitor-metadata";
import type { Config, Context } from "@netlify/functions";
import { and, eq, sql } from "drizzle-orm";

import { db, pool } from "../../db/client";
import { sites, siteDomains, pageEvents } from "../../db/schema";
import { analyticsEventFacts } from "../../db/analytics-schema";

import { parseOrigin } from "./_shared/origin";
import {
  EventValidationError,
  validateCollectEvent,
} from "./_shared/event-validator";

import {
  createAnalyticsIdentity,
  getAnalyticsIdentityConfig,
} from "./_shared/analytics/identity";

import {
  createOrUpdateAnalyticsSession,
} from "./_shared/analytics/session-lifecycle";

import {
  writePageViewAggregates,
} from "./_shared/analytics/aggregate-writer";

import { isRawIpStorageEnabled } from "./_shared/settings/raw-ip-policy";

import { getSystemSettings } from "./_shared/settings/settings-service";

import {
  checkSiteRateLimit,
  SITE_RATE_LIMIT_WINDOW_SECONDS,
} from "./_shared/rate-limit/rate-limit-service";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_MODEL_VERSION = 2;

class DuplicateAnalyticsEventError extends Error {
  constructor() {
    super("Analytics event already exists");
    this.name = "DuplicateAnalyticsEventError";
  }
}

function jsonResponse(
  data: unknown,
  status: number,
  origin?: string,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  });

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  origin?: string,
): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    status,
    origin,
  );
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

async function isDomainAllowed(
  siteId: string,
  hostname: string,
): Promise<boolean> {
  const result = await db
    .select({
      id: siteDomains.id,
    })
    .from(siteDomains)
    .where(
      and(
        eq(siteDomains.siteId, siteId),
        sql`lower(${siteDomains.domain}) = ${hostname}`,
      ),
    )
    .limit(1);

  return result.length > 0;
}

async function handleOptions(request: Request): Promise<Response> {
  const parsedOrigin = parseOrigin(
    request.headers.get("Origin"),
  );

  if (!parsedOrigin) {
    return errorResponse(
      "INVALID_ORIGIN",
      "Origin is missing or invalid.",
      403,
    );
  }

  const result = await db
    .select({
      siteId: sites.id,
    })
    .from(siteDomains)
    .innerJoin(
      sites,
      eq(siteDomains.siteId, sites.id),
    )
    .where(
      and(
        sql`lower(${siteDomains.domain}) = ${parsedOrigin.hostname}`,
        eq(sites.status, "active"),
      ),
    )
    .limit(1);

  if (result.length === 0) {
    return errorResponse(
      "ORIGIN_NOT_ALLOWED",
      "This origin is not registered.",
      403,
    );
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": parsedOrigin.origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}

export default async (
  request: Request,
  _context: Context,
): Promise<Response> => {
  const parsedOrigin = parseOrigin(
    request.headers.get("Origin"),
  );

  try {
    // 1. OPTIONS 预检
    if (request.method === "OPTIONS") {
      return await handleOptions(request);
    }
    // 1.1 仅允许 POST 进入事件采集流程。
    if (request.method !== "POST") {
      const response = errorResponse(
        "METHOD_NOT_ALLOWED",
        "Only POST and OPTIONS requests are allowed.",
        405,
        parsedOrigin?.origin,
      );

      response.headers.set("Allow", "POST, OPTIONS");
      return response;
    }

    // 2. Origin 校验
    if (!parsedOrigin) {
      return errorResponse(
        "INVALID_ORIGIN",
        "Origin is missing or invalid.",
        403,
      );
    }

    // 3. Content-Type 校验
    const contentType = request.headers.get("Content-Type") ?? "";

    const mediaType = contentType
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (mediaType !== "application/json") {
      return errorResponse(
        "INVALID_CONTENT_TYPE",
        "Content-Type must be application/json.",
        415,
        parsedOrigin.origin,
      );
    }

    // 4. JSON 解析及请求体大小校验
    let payload: Record<string, unknown>;

    try {
      const rawBody = await request.text();
      const bodySize = new TextEncoder().encode(rawBody).byteLength;

      if (bodySize > 16 * 1024) {
        return errorResponse(
          "PAYLOAD_TOO_LARGE",
          "Request body must not exceed 16 KB.",
          413,
          parsedOrigin.origin,
        );
      }

      const body: unknown = JSON.parse(rawBody);

      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body)
      ) {
        throw new Error("Invalid JSON object");
      }

      payload = body as Record<string, unknown>;
    } catch {
      return errorResponse(
        "INVALID_JSON",
        "Request body must be a valid JSON object.",
        400,
        parsedOrigin.origin,
      );
    }

    // 5. Site ID 校验
    const siteId = payload.site_id;

    if (
      typeof siteId !== "string" ||
      !UUID_REGEX.test(siteId)
    ) {
      return errorResponse(
        "INVALID_SITE_ID",
        "site_id must be a valid UUID.",
        400,
        parsedOrigin.origin,
      );
    }

    // 6. 查询站点及其时区
    const siteResult = await db
      .select({
        id: sites.id,
        status: sites.status,
        timezone: sites.timezone,
      })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);

    if (siteResult.length === 0) {
      return errorResponse(
        "SITE_NOT_FOUND",
        "The specified site does not exist.",
        404,
        parsedOrigin.origin,
      );
    }

    const site = siteResult[0];

    // 7. 站点状态
    if (site.status !== "active") {
      return errorResponse(
        "SITE_INACTIVE",
        "The specified site is inactive.",
        404,
        parsedOrigin.origin,
      );
    }

    // 8. 域名白名单
    const allowed = await isDomainAllowed(
      siteId,
      parsedOrigin.hostname,
    );

    if (!allowed) {
      return errorResponse(
        "DOMAIN_NOT_ALLOWED",
        "This domain is not registered for the specified site.",
        403,
        parsedOrigin.origin,
      );
    }

    // 9. 服务端访客 Metadata
    const metadata = resolveVisitorMetadata(
      request,
      _context,
    );

    // 10. 事件校验和标准化
    let event;

    try {
      event = validateCollectEvent(
        payload,
        siteId,
        parsedOrigin.hostname,
      );
    } catch (error) {
      if (error instanceof EventValidationError) {
        return errorResponse(
          error.code,
          error.message,
          400,
          parsedOrigin.origin,
        );
      }

      throw error;
    }

    // 10. 站点级采集限流。
    // 仅通过前置校验的有效事件消耗请求额度。
    const settings = await getSystemSettings();
    const maxRequests =
      settings.rate_limit.site_rate_limit_max_requests;

    const rateLimitResult = await checkSiteRateLimit(
      pool,
      siteId,
      maxRequests,
    );

    if (!rateLimitResult.allowed) {
      const response = errorResponse(
        "RATE_LIMIT_EXCEEDED",
        "The site has exceeded its request limit. Please retry later.",
        429,
        parsedOrigin.origin,
      );

      response.headers.set(
        "Retry-After",
        String(
          rateLimitResult.retryAfterSeconds ??
            SITE_RATE_LIMIT_WINDOW_SECONDS,
        ),
      );

      return response;
    }

    // 10.1 读取原始 IP 隐私设置。
    // 设置读取失败时默认关闭原始 IP 存储（Fail-Closed）。
    const storeRawIp = await isRawIpStorageEnabled();

    // 11. 创建 HMAC Identity
    const identityConfig = getAnalyticsIdentityConfig();
    const identity = createAnalyticsIdentity(identityConfig);

    const visitorIdentity = identity.createVisitorKey(
      siteId,
      event.visitor_id,
    );

    // 12. 同一事务写入 Analytics 和原始事件
    const transactionState: {
      receivedAt?: Date;
    } = {};

    try {
      await db.transaction(async (tx) => {
        // Session Lifecycle 内部先获取 Visitor Advisory Lock，
        // 再调用此函数生成 receivedAt。
        const session = await createOrUpdateAnalyticsSession(
          tx,
          {
            siteId,
            visitorKey: visitorIdentity.key,
            visitorKeyVersion: visitorIdentity.keyVersion,
            pagePath: event.page_path,
            receivedAt: () => {
              const receivedAt = new Date();
              transactionState.receivedAt = receivedAt;
              return receivedAt;
            },
            timezone: site.timezone,
            sessionKeySecret: identityConfig.secret,
            sessionKeyVersion: identityConfig.keyVersion,
            sessionModelVersion: SESSION_MODEL_VERSION,
          },
        );

        const receivedAt = transactionState.receivedAt;

        if (!receivedAt) {
          throw new Error(
            "Session lifecycle did not generate receivedAt",
          );
        }

        const statDate = getStatDate(receivedAt, site.timezone);

        // Event Facts 是长期防重依据。
        // session_key 必须来自服务端 Session Lifecycle。
        const insertedFacts = await tx
          .insert(analyticsEventFacts)
          .values({
            siteId,
            eventId: event.event_id,

            receivedAt,
            occurredAt: event.occurred_at,
            statDate,
            timezone: site.timezone,

            visitorKey: visitorIdentity.key,
            visitorKeyVersion: visitorIdentity.keyVersion,

            sessionKey: session.sessionKey,
            sessionKeyVersion: session.sessionKeyVersion,

            pagePath: event.page_path,
            pageTitle: event.page_title,
            referrerHost: event.referrer_host,

            utmSource: event.utm_source,
            utmMedium: event.utm_medium,
            utmCampaign: event.utm_campaign,
            utmTerm: event.utm_term,
            utmContent: event.utm_content,

            browser: metadata.browser,
            os: metadata.os,
            deviceType: metadata.deviceType,

            countryCode: metadata.countryCode,
            region: metadata.region,
            city: metadata.city,
          })
          .onConflictDoNothing({
            target: [
              analyticsEventFacts.siteId,
              analyticsEventFacts.eventId,
            ],
          })
          .returning({
            id: analyticsEventFacts.id,
          });

        // 事件唯一约束冲突：
        // 必须抛出异常回滚刚才的 Session 更新。
        if (insertedFacts.length === 0) {
          throw new DuplicateAnalyticsEventError();
        }

        // 写入原始事件。
        // 旧 page_events 记录冲突不影响新 Analytics Fact。
        await tx
          .insert(pageEvents)
          .values({
            siteId: event.site_id,
            eventId: event.event_id,
            eventType: event.event_type,
            visitorId: event.visitor_id,
            sessionId: event.session_id,

            pageUrl: event.page_url,
            pagePath: event.page_path,
            pageTitle: event.page_title,

            referrer: event.referrer,
            referrerHost: event.referrer_host,

            utmSource: event.utm_source,
            utmMedium: event.utm_medium,
            utmCampaign: event.utm_campaign,
            utmTerm: event.utm_term,
            utmContent: event.utm_content,

            occurredAt: event.occurred_at,
            receivedAt,

            userAgent: metadata.userAgent,
            deviceType: metadata.deviceType,
            browser: metadata.browser,
            os: metadata.os,

            ipAddress: storeRawIp ? metadata.ipAddress : null,
            countryCode: metadata.countryCode,
            region: metadata.region,
            city: metadata.city,
          })
          .onConflictDoNothing({
            target: [
              pageEvents.siteId,
              pageEvents.eventId,
            ],
          });

          // 写入 Daily Memberships 和 Daily Aggregates。
          // 与 Event Facts、Session Facts、原始事件共用同一个事务。
          await writePageViewAggregates(tx, {
            siteId,
            statDate,
            timezone: site.timezone,

            visitorKey: visitorIdentity.key,
            visitorKeyVersion: visitorIdentity.keyVersion,

            sessionKey: session.sessionKey,
            sessionKeyVersion: session.sessionKeyVersion,

            pagePath: event.page_path,

            referrerHost: event.referrer_host,
            utmSource: event.utm_source,
            utmMedium: event.utm_medium,
            utmCampaign: event.utm_campaign,

            browser: metadata.browser,
            os: metadata.os,
            deviceType: metadata.deviceType,

            countryCode: metadata.countryCode,
            region: metadata.region,
            city: metadata.city,
          });
      });
    } catch (error) {
      if (error instanceof DuplicateAnalyticsEventError) {
        return jsonResponse(
          {
            success: true,
            code: "DUPLICATE_EVENT",
            message: "Event has already been collected.",
          },
          200,
          parsedOrigin.origin,
        );
      }

      throw error;
    }

    // 13. 首次收集成功
    const receivedAt = transactionState.receivedAt;

    if (!receivedAt) {
      throw new Error("Transaction completed without receivedAt");
    }
    

    return jsonResponse(
      {
        success: true,
        code: "EVENT_COLLECTED",
        message: "Event collected successfully.",
        data: {
          event_id: event.event_id,
          received_at: receivedAt.toISOString(),
        },
      },
      202,
      parsedOrigin.origin,
    );
  } catch (error) {
    console.error(
      "[PLV Site Monitor] Collect error:",
      error,
    );

    return errorResponse(
      "INTERNAL_SERVER_ERROR",
      "An internal server error occurred.",
      500,
      parsedOrigin?.origin,
    );
  }
};

export const config: Config = {
  path: "/api/collect",
  method: ["POST", "OPTIONS"],
};


export interface CollectEventInput {
  site_id: string;
  event_id: string;
  event_type: "page_view";
  visitor_id: string;
  session_id: string;

  page_url: string;
  page_path: string;
  page_title: string | null;
  referrer: string | null;
  occurred_at: Date;

  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;

  referrer_host: string | null;
}

export class EventValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EventValidationError";
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "password",
  "access_token",
  "refresh_token",
  "code",
  "email",
  "phone",
  "client_secret",
  "api_key",
  "apikey",
  "secret",
  "authorization",
  "auth_token",
  "id_token",
  "session_token",
  "code_verifier",
]);


const UTM_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

function validateUuid(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== "string" ||
    !UUID_REGEX.test(value)
  ) {
    throw new EventValidationError(
      `INVALID_${field.toUpperCase()}`,
      `${field} must be a valid UUID.`,
    );
  }

  return value.toLowerCase();
}

function cleanText(
  value: unknown,
  maxLength: number,
  field: string,
  required = false,
): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new EventValidationError(
        `INVALID_${field.toUpperCase()}`,
        `${field} is required.`,
      );
    }

    return null;
  }

  if (typeof value !== "string") {
    throw new EventValidationError(
      `INVALID_${field.toUpperCase()}`,
      `${field} must be a string.`,
    );
  }

  // 移除控制字符，避免污染日志和页面信息。
  const result = value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();

  if (result.length > maxLength) {
    throw new EventValidationError(
      `INVALID_${field.toUpperCase()}`,
      `${field} exceeds ${maxLength} characters.`,
    );
  }

  if (required && !result) {
    throw new EventValidationError(
      `INVALID_${field.toUpperCase()}`,
      `${field} cannot be empty.`,
    );
  }

  return result || null;
}

/**
 * URL 清理：
 * - 仅允许 HTTP / HTTPS
 * - 禁止用户名和密码
 * - 删除 Fragment
 * - 删除敏感查询参数
 */
function cleanUrl(
  value: unknown,
  field: string,
  required: boolean,
  allowedQueryKeys?: Set<string>,
): URL | null {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new EventValidationError(
        `INVALID_${field.toUpperCase()}`,
        `${field} is required.`,
      );
    }

    return null;
  }

  if (typeof value !== "string") {
    throw new EventValidationError(
      `INVALID_${field.toUpperCase()}`,
      `${field} must be a string.`,
    );
  }

  if (value.length > 4096) {
    throw new EventValidationError(
      `INVALID_${field.toUpperCase()}`,
      `${field} is too long.`,
    );
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      throw new Error("Unsupported protocol");
    }

    if (url.username || url.password) {
      throw new Error("URL credentials are not allowed");
    }

    url.hash = "";

    if (allowedQueryKeys) {
      const originalParams = Array.from(url.searchParams.entries());

      url.search = "";

      for (const [key, paramValue] of originalParams) {
        const normalizedKey = key.toLowerCase();

        if (allowedQueryKeys.has(normalizedKey)) {
          url.searchParams.append(normalizedKey, paramValue);
        }
      }
    } else {
      for (const key of Array.from(url.searchParams.keys())) {
        if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
          url.searchParams.delete(key);
        }
      }
    }

    if (url.toString().length > 2048) {
      throw new Error("Cleaned URL is too long");
    }

    return url;
  } catch {
    throw new EventValidationError(
      `INVALID_${field.toUpperCase()}`,
      `${field} must be a valid HTTP or HTTPS URL.`,
    );
  }
}

export function validateCollectEvent(
  payload: Record<string, unknown>,
  expectedSiteId: string,
  expectedHostname: string,
): CollectEventInput {
  const siteId = validateUuid(payload.site_id, "site_id");

  if (siteId !== expectedSiteId.toLowerCase()) {
    throw new EventValidationError(
      "SITE_ID_MISMATCH",
      "Payload site_id does not match the validated site.",
    );
  }

  const eventId = validateUuid(payload.event_id, "event_id");
  const visitorId = validateUuid(payload.visitor_id, "visitor_id");
  const sessionId = validateUuid(payload.session_id, "session_id");

  if (payload.event_type !== "page_view") {
    throw new EventValidationError(
      "UNSUPPORTED_EVENT_TYPE",
      "Only page_view events are supported.",
    );
  }

  const pageUrl = cleanUrl(payload.page_url, "page_url", true)!;

  if (
    pageUrl.hostname.toLowerCase() !==
    expectedHostname.toLowerCase()
  ) {
    throw new EventValidationError(
      "PAGE_URL_DOMAIN_MISMATCH",
      "page_url hostname must match the request origin.",
    );
  }

  const referrerUrl = cleanUrl(
    payload.referrer,
    "referrer",
    false,
  );

  const occurredAtValue = payload.occurred_at;

  if (
    typeof occurredAtValue !== "string" ||
    !occurredAtValue.trim()
  ) {
    throw new EventValidationError(
      "INVALID_OCCURRED_AT",
      "occurred_at must be a valid date string.",
    );
  }

  const occurredAt = new Date(occurredAtValue);

  if (Number.isNaN(occurredAt.getTime())) {
    throw new EventValidationError(
      "INVALID_OCCURRED_AT",
      "occurred_at must be a valid date string.",
    );
  }

  const utm: Record<string, string | null> = {};

  for (const field of UTM_FIELDS) {
    utm[field] = cleanText(
      payload[field],
      255,
      field,
    );
  }

  return {
    site_id: siteId,
    event_id: eventId,
    event_type: "page_view",
    visitor_id: visitorId,
    session_id: sessionId,

    page_url: pageUrl.toString(),

    // 统一从清理后的 URL 生成，不相信客户端 page_path。
    page_path: pageUrl.pathname || "/",

    page_title: cleanText(
      payload.page_title,
      500,
      "page_title",
    ),

    referrer: referrerUrl?.toString() ?? null,
    referrer_host: referrerUrl?.hostname ?? null,

    occurred_at: occurredAt,

    utm_source: utm.utm_source,
    utm_medium: utm.utm_medium,
    utm_campaign: utm.utm_campaign,
    utm_term: utm.utm_term,
    utm_content: utm.utm_content,
  };
}

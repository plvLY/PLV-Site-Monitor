
import { pool } from "../../db/client";
import { AnalyticsError } from "./_shared/analytics/errors";
import type { Authorization } from "./_shared/analytics/authorization";
import {
  assertSameOrigin,
  createAdminAuthorization,
} from "./_shared/admin-auth/guard";
import {
  errorResponse,
  successResponse,
  methodNotAllowedResponse,
} from "./_shared/analytics/response";
import {
  parsePagination,
  paginate,
} from "./_shared/analytics/pagination";
import {
  getAllSites,
  createSite,
  updateSite,
  type SiteDomainItem,
  type SiteWriteInput,
} from "./_shared/sites/sites-service";

export const config = {
  path: "/api/sites",
};

const ALLOWED_QUERY_KEYS = new Set(["page", "page_size"]);
const MAX_BODY_SIZE = 16 * 1024;

function parseOptionalInteger(
  value: string | null,
  name: string,
): number | undefined {
  if (value === null) return undefined;

  if (!/^\d+$/.test(value)) {
    throw new AnalyticsError("INVALID_QUERY", `${name} must be a valid integer.`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new AnalyticsError("INVALID_QUERY", `${name} exceeds the safe integer range.`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new AnalyticsError("INVALID_QUERY", `${field} must be a string.`);
  }

  const normalized = value.trim();

  if (!normalized || normalized.length > maxLength) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      `${field} must contain 1-${maxLength} characters.`,
    );
  }

  return normalized;
}

function validateTimezone(value: unknown): string {
  const timezone = requiredString(value, "timezone", 64);

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new AnalyticsError("INVALID_QUERY", "Invalid timezone.");
  }

  return timezone;
}

function normalizeDomain(value: unknown): string {
  const raw = requiredString(value, "domain", 255).toLowerCase();

  if (
    raw.includes("://") ||
    raw.includes("/") ||
    raw.includes("@") ||
    raw.includes("?") ||
    raw.includes("#") ||
    raw.includes(":")
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Domain must be a hostname without protocol, port or path.",
    );
  }

  const hostname = raw.endsWith(".") ? raw.slice(0, -1) : raw;

  const isLocalhost =
    hostname === "localhost" &&
    process.env.NODE_ENV !== "production";

  if (
    hostname.length > 253 ||
    (!hostname.includes(".") && !isLocalhost) ||
    !hostname.split(".").every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw new AnalyticsError("INVALID_QUERY", "Invalid domain.");
  }

  return hostname;
}

function validateDomains(value: unknown): SiteDomainItem[] {
  if (!Array.isArray(value)) {
    throw new AnalyticsError("INVALID_QUERY", "domains must be an array.");
  }

  if (value.length > 50) {
    throw new AnalyticsError("INVALID_QUERY", "A maximum of 50 domains is allowed.");
  }

  const domains = value.map((item) => {
    if (!isRecord(item)) {
      throw new AnalyticsError("INVALID_QUERY", "Invalid domain item.");
    }

    if (typeof item.is_primary !== "boolean") {
      throw new AnalyticsError(
        "INVALID_QUERY",
        "is_primary must be a boolean.",
      );
    }

    return {
      domain: normalizeDomain(item.domain),
      is_primary: item.is_primary,
    };
  });

  const uniqueDomains = new Set(domains.map((item) => item.domain));

  if (uniqueDomains.size !== domains.length) {
    throw new AnalyticsError("INVALID_QUERY", "Duplicate domains are not allowed.");
  }

  if (domains.length > 0 && domains.filter((item) => item.is_primary).length !== 1) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Exactly one primary domain is required when domains are provided.",
    );
  }

  if (domains.length === 0) {
    return [];
  }

  return domains;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > MAX_BODY_SIZE) {
    throw new AnalyticsError("INVALID_QUERY", "Request body is too large.");
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > MAX_BODY_SIZE) {
    throw new AnalyticsError("INVALID_QUERY", "Request body is too large.");
  }

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    throw new AnalyticsError("INVALID_QUERY", "Request body must be valid JSON.");
  }

  if (!isRecord(body)) {
    throw new AnalyticsError("INVALID_QUERY", "Request body must be a JSON object.");
  }

  return body;
}

function validateCreateInput(body: Record<string, unknown>) {
  const allowed = new Set(["name", "timezone", "domains"]);

  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new AnalyticsError("INVALID_QUERY", `Unknown field: ${key}`);
    }
  }

  return {
    name: requiredString(body.name, "name", 100),
    timezone: body.timezone === undefined
      ? "UTC"
      : validateTimezone(body.timezone),
    domains: body.domains === undefined
      ? undefined
      : validateDomains(body.domains),
  };
}

function validateUpdateInput(
  body: Record<string, unknown>,
): { siteId: string; input: SiteWriteInput } {
  const allowed = new Set(["site_id", "name", "timezone", "status", "domains"]);

  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new AnalyticsError("INVALID_QUERY", `Unknown field: ${key}`);
    }
  }

  const siteId = requiredString(body.site_id, "site_id", 36);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteId)) {
    throw new AnalyticsError("INVALID_QUERY", "site_id must be a valid UUID.");
  }

  const input: SiteWriteInput = {};

  if (body.name !== undefined) {
    input.name = requiredString(body.name, "name", 100);
  }

  if (body.timezone !== undefined) {
    input.timezone = validateTimezone(body.timezone);
  }

  if (body.status !== undefined) {
    if (!["active", "disabled", "archived"].includes(String(body.status))) {
      throw new AnalyticsError("INVALID_QUERY", "Invalid site status.");
    }

    input.status = body.status as SiteWriteInput["status"];
  }

  if (body.domains !== undefined) {
    input.domains = validateDomains(body.domains);
  }

  if (Object.keys(input).length === 0) {
    throw new AnalyticsError("INVALID_QUERY", "At least one field must be updated.");
  }

  return { siteId, input };
}

function mapDatabaseError(error: unknown): AnalyticsError {
  const pgError = error as { code?: string; constraint?: string };

  if (pgError?.code === "23505") {
    if (pgError.constraint === "site_domains_domain_uidx") {
      return new AnalyticsError("INVALID_QUERY", "Domain is already registered.");
    }

    if (pgError.constraint === "site_domains_one_primary_uidx") {
      return new AnalyticsError("INVALID_QUERY", "Only one primary domain is allowed.");
    }

    return new AnalyticsError("INVALID_QUERY", "A unique constraint was violated.");
  }

  if (pgError?.code === "23503") {
    return new AnalyticsError("INVALID_QUERY", "Referenced site does not exist.");
  }

  return new AnalyticsError("INTERNAL_ERROR", "An internal error occurred.");
}

export function createSitesHandler(dependencies: {
  database: typeof pool;
  authorization?: Authorization;
}) {
  const { database } = dependencies;

  return async function handleSites(request: Request): Promise<Response> {
    try {
      if (!["GET", "POST", "PATCH"].includes(request.method)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "Method not allowed.",
            },
          }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json",
              Allow: "GET, POST, PATCH",
            },
          },
        );
      }

      const authorization =
        dependencies.authorization ??
        await createAdminAuthorization(request);

      if (!authorization.isAuthenticated()) {
        throw new AnalyticsError(
          "UNAUTHORIZED",
          "Authentication required.",
        );
      }

      if (request.method !== "GET") {
        assertSameOrigin(request);
      }

      if (request.method === "POST") {
        const body = await readJsonBody(request);
        const input = validateCreateInput(body);

        const site = await createSite(database, input);

        return successResponse({ item: site }, {});
      }

      if (request.method === "PATCH") {
        const body = await readJsonBody(request);
        const { siteId, input } = validateUpdateInput(body);

        const site = await updateSite(database, siteId, input);

        if (!site) {
          throw new AnalyticsError("INVALID_QUERY", "Site not found.");
        }

        return successResponse({ item: site }, {});
      }

      const url = new URL(request.url);
      const params = url.searchParams;

      for (const key of params.keys()) {
        if (!ALLOWED_QUERY_KEYS.has(key)) {
          throw new AnalyticsError("INVALID_QUERY", `Unknown query parameter: ${key}`);
        }
      }

      for (const key of ALLOWED_QUERY_KEYS) {
        if (params.getAll(key).length > 1) {
          throw new AnalyticsError("INVALID_QUERY", `Duplicate query parameter: ${key}`);
        }
      }

      const pagination = parsePagination({
        page: parseOptionalInteger(params.get("page"), "page"),
        page_size: parseOptionalInteger(params.get("page_size"), "page_size"),
      });

      const allSites = await getAllSites(database);

      const pageItems = allSites.slice(
        pagination.offset,
        pagination.offset + pagination.page_size,
      );

      const pageMeta = paginate(allSites.length, pagination);

      return successResponse(
        { items: pageItems },
        {
          page: pageMeta.page,
          page_size: pageMeta.page_size,
          total: pageMeta.total,
          total_pages: pageMeta.total_pages,
        },
      );
    } catch (error) {
      if (error instanceof AnalyticsError) {
        return errorResponse(error);
      }

      const mappedError = mapDatabaseError(error);

      if (mappedError.code !== "INTERNAL_ERROR") {
        return errorResponse(mappedError);
      }

      console.error("[sites] Unexpected error:", error);

      return errorResponse(mappedError);
    }
  };
}

export default createSitesHandler({
  database: pool,
});

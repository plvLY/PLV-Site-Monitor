import type { Context } from "@netlify/functions";
import { db } from "../../db/client";
import { AnalyticsError, toAnalyticsError } from "./_shared/analytics/errors";
import {
  errorResponse,
  successResponse,
} from "./_shared/analytics/response";
import type { Authorization } from "./_shared/analytics/authorization";
import {
  assertSameOrigin,
  createAdminAuthorization,
} from "./_shared/admin-auth/guard";
import {
  getSystemSettings,
  updateSystemSettings,
} from "./_shared/settings/settings-service";
import { validateSettingsPatch } from "./_shared/settings/settings-validator";

export const config = {
  path: "/api/settings",
};

const MAX_BODY_SIZE = 8 * 1024;

interface SettingsHandlerDependencies {
  database?: typeof db;
  authorization?: Authorization;
}

function jsonNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    throw new AnalyticsError("INVALID_SETTINGS", "Request body is too large.");
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > MAX_BODY_SIZE) {
    throw new AnalyticsError("INVALID_SETTINGS", "Request body is too large.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AnalyticsError("INVALID_SETTINGS", "Request body must be valid JSON.");
  }
}

/**
 * Handler factory allows authorization and database injection.
 * Production always resolves the administrator Session from the current request.
 */
export function createSettingsHandler(
  dependencies: SettingsHandlerDependencies = {},
) {
  const database = dependencies.database ?? db;

  return async function settingsHandler(
    request: Request,
    _context: Context,
  ): Promise<Response> {
    try {
      if (request.method !== "GET" && request.method !== "PATCH") {
        const response = errorResponse(
          new AnalyticsError(
            "METHOD_NOT_ALLOWED",
            "Only GET and PATCH requests are supported.",
          ),
        );
        const headers = new Headers(response.headers);
        headers.set("Allow", "GET, PATCH");

        return jsonNoStore(new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }));
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

      if (request.method === "PATCH") {
        assertSameOrigin(request);
      }

      if (request.method === "GET") {
        const settings = await getSystemSettings(database);
        return jsonNoStore(successResponse(settings, {}));
      }

      const mediaType = (request.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();

      if (mediaType !== "application/json") {
        throw new AnalyticsError(
          "INVALID_SETTINGS",
          "Content-Type must be application/json.",
        );
      }

      const body = await readJsonBody(request);
      const patch = validateSettingsPatch(body);
      const settings = await updateSystemSettings(patch, database);

      return jsonNoStore(successResponse(settings, {}));
    } catch (error) {
      if (!(error instanceof AnalyticsError)) {
        console.error("[settings] Unexpected error:", error);
      }

      return jsonNoStore(errorResponse(toAnalyticsError(error)));
    }
  };
}

const handler = createSettingsHandler();

export default handler;

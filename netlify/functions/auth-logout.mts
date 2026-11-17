
import type { Context } from "@netlify/functions";

import {
  clearSessionCookie,
  getSessionTokenFromCookie,
} from "./_shared/admin-auth/cookie";

import {
  revokeAdminSession,
} from "./_shared/admin-auth/session";

import {
  assertSameOrigin,
} from "./_shared/admin-auth/guard";

import {
  toAnalyticsError,
} from "./_shared/analytics/errors";

import {
  errorResponse,
  successResponse,
} from "./_shared/analytics/response";

export const config = {
  path: "/api/auth/logout",
};

interface AuthLogoutDependencies {
  getSessionToken?: typeof getSessionTokenFromCookie;
  revokeSession?: typeof revokeAdminSession;
  clearCookie?: typeof clearSessionCookie;
  assertOrigin?: typeof assertSameOrigin;
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Only POST requests are supported.",
      },
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Allow: "POST",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

function withClearedCookie(
  response: Response,
  clearCookie: typeof clearSessionCookie,
): Response {
  const headers = new Headers(response.headers);

  headers.set("Set-Cookie", clearCookie());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createAuthLogoutHandler(
  dependencies: AuthLogoutDependencies = {},
) {
  const getSessionToken =
    dependencies.getSessionToken ?? getSessionTokenFromCookie;

  const revokeSession =
    dependencies.revokeSession ?? revokeAdminSession;

  const clearCookie =
    dependencies.clearCookie ?? clearSessionCookie;

  const assertOrigin =
    dependencies.assertOrigin ?? assertSameOrigin;

  return async function handleAuthLogout(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return methodNotAllowed();
    }

    // CSRF validation must happen before any session mutation.
    // Do not clear the cookie when the Origin check fails.
    try {
      assertOrigin(request);
    } catch (error) {
      return noStore(errorResponse(toAnalyticsError(error)));
    }

    try {
      const token = getSessionToken(
        request.headers.get("Cookie"),
      );

      // Missing or malformed cookies are treated as an idempotent
      // logout. No database operation is necessary.
      if (token) {
        await revokeSession(token);
      }

      return withClearedCookie(
        noStore(
          successResponse(
            {
              loggedOut: true,
            },
            {},
          ),
        ),
        clearCookie,
      );
    } catch (error) {
      console.error("[auth-logout] Unexpected error:", error);

      // The browser cookie is cleared, but the server-side session
      // may still be active if revocation failed. Return 500 honestly.
      return withClearedCookie(
        noStore(errorResponse(toAnalyticsError(error))),
        clearCookie,
      );
    }
  };
}

const handler = createAuthLogoutHandler();

export default async function authLogout(
  request: Request,
  _context: Context,
): Promise<Response> {
  return handler(request);
}

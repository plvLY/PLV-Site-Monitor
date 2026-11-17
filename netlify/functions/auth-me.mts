import type { Context } from "@netlify/functions";

import {
  getAdminAuthContext,
  type AdminAuthContext,
} from "./_shared/admin-auth/auth-context";

import {
  AnalyticsError,
  toAnalyticsError,
} from "./_shared/analytics/errors";

import {
  errorResponse,
  successResponse,
} from "./_shared/analytics/response";

export const config = {
  path: "/api/auth/me",
};

interface AuthMeDependencies {
  resolveAuthContext?: (
    request: Request,
  ) => Promise<AdminAuthContext>;
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
        message: "Only GET requests are supported.",
      },
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Allow: "GET",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

export function createAuthMeHandler(
  dependencies: AuthMeDependencies = {},
) {
  const resolveAuthContext =
    dependencies.resolveAuthContext ?? getAdminAuthContext;

  return async function handleAuthMe(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "GET") {
      return methodNotAllowed();
    }

    try {
      const authContext = await resolveAuthContext(request);

      if (
        !authContext ||
        authContext.authenticated !== true ||
        !authContext.admin
      ) {
        throw new AnalyticsError(
          "UNAUTHORIZED",
          "Authentication required.",
        );
      }

      return noStore(
        successResponse(
          {
            authenticated: true,
            admin: {
              id: authContext.admin.adminUserId,
              username: authContext.admin.username,
            },
          },
          {},
        ),
      );
    } catch (error) {
      const mappedError = toAnalyticsError(error);

      if (mappedError.code === "INTERNAL_ERROR") {
        console.error("[auth-me] Unexpected error:", error);
      }

      return noStore(errorResponse(mappedError));
    }
  };
}

const handler = createAuthMeHandler();

export default async function authMe(
  request: Request,
  _context: Context,
): Promise<Response> {
  return handler(request);
}

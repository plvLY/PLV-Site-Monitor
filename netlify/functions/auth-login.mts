import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { adminUsers } from "../../db/auth-schema";

import {
  assertSameOrigin,
} from "./_shared/admin-auth/guard";

import {
  createSessionCookie,
} from "./_shared/admin-auth/cookie";

import {
  verifyPassword,
} from "./_shared/admin-auth/password";

import {
  createAdminSession,
} from "./_shared/admin-auth/session";

import {
  AnalyticsError,
  toAnalyticsError,
} from "./_shared/analytics/errors";

import {
  errorResponse,
  successResponse,
} from "./_shared/analytics/response";

export const config = {
  path: "/api/auth/login",
};

const MAX_BODY_BYTES = 4096;

type LoginDatabase = typeof db;

interface LoginDependencies {
  database?: LoginDatabase;

  verifyPassword?: typeof verifyPassword;

  createSession?: typeof createAdminSession;

  createCookie?: typeof createSessionCookie;

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

function invalidCredentials(): AnalyticsError {
  return new AnalyticsError(
    "UNAUTHORIZED",
    "Invalid username or password.",
  );
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
      },
    },
  );
}

async function readLoginBody(
  request: Request,
): Promise<{ username: string; password: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();

  if (mediaType !== "application/json") {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Content-Type must be application/json.",
    );
  }

  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new AnalyticsError(
        "INVALID_QUERY",
        "Invalid Content-Length header.",
      );
    }

    const declaredLength = Number(contentLength);

    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength > MAX_BODY_BYTES
    ) {
      throw new AnalyticsError(
        "INVALID_QUERY",
        "Request body is too large.",
      );
    }
  }

  if (!request.body) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Invalid JSON request body.",
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let rawBody: string;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors after rejecting the oversized body.
        }

        throw new AnalyticsError(
          "INVALID_QUERY",
          "Request body is too large.",
        );
      }

      chunks.push(value);
    }

    const bytes = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      totalBytes,
    );

    try {
      rawBody = new TextDecoder("utf-8", {
        fatal: true,
      }).decode(bytes);
    } catch {
      throw new AnalyticsError(
        "INVALID_QUERY",
        "Request body must be valid UTF-8.",
      );
    }
  } finally {
    reader.releaseLock();
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Invalid JSON request body.",
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Invalid login request.",
    );
  }

  const input = body as Record<string, unknown>;

  if (
    typeof input.username !== "string" ||
    typeof input.password !== "string"
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Username and password are required.",
    );
  }

  const username = input.username.trim();

  if (
    username.length < 3 ||
    username.length > 64 ||
    !/^[a-z0-9._-]+$/.test(username) ||
    input.password.length === 0 ||
    Buffer.byteLength(input.password, "utf8") > 1024
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Invalid login request.",
    );
  }

  return {
    username,
    password: input.password,
  };
}
export function createAuthLoginHandler(
  dependencies: LoginDependencies = {},
) {
  const database = dependencies.database ?? db;
  const verifyPasswordFn =
    dependencies.verifyPassword ?? verifyPassword;
  const createSessionFn =
    dependencies.createSession ?? createAdminSession;
  const createCookieFn =
    dependencies.createCookie ?? createSessionCookie;
  const assertOriginFn =
    dependencies.assertOrigin ?? assertSameOrigin;

  return async function handleAuthLogin(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return methodNotAllowed();
    }

    try {
      assertOriginFn(request);

      const input = await readLoginBody(request);

      const [admin] = await database
        .select({
          id: adminUsers.id,
          username: adminUsers.username,
          passwordHash: adminUsers.passwordHash,
        })
        .from(adminUsers)
        .where(eq(adminUsers.id, 1))
        .limit(1);

      if (
        !admin ||
        admin.username !== input.username
      ) {
        return noStore(errorResponse(invalidCredentials()));
      }

      const passwordValid = await verifyPasswordFn(
        input.password,
        admin.passwordHash,
      );

      if (!passwordValid) {
        return noStore(errorResponse(invalidCredentials()));
      }

      const session = await createSessionFn(admin.id);

      const response = successResponse(
        {
          authenticated: true,
          admin: {
            id: admin.id,
            username: admin.username,
          },
        },
        {},
      );

      const headers = new Headers(response.headers);

      headers.set(
        "Set-Cookie",
        createCookieFn(session.token),
      );

      headers.set("Cache-Control", "no-store");
      headers.set("Pragma", "no-cache");

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (error) {
      const mappedError = toAnalyticsError(error);

      if (mappedError.code === "INTERNAL_ERROR") {
        console.error("[auth-login] Unexpected error:", error);
      }

      return noStore(errorResponse(mappedError));
    }
  };
}

const handler = createAuthLoginHandler();

export default async function authLogin(
  request: Request,
  _context: Context,
): Promise<Response> {
  return handler(request);
}


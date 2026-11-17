import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
const LOCAL_PORT = "5433";
const LOCAL_DATABASE = "/plv_site_monitor_dev";
interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

async function readApiError(response: Response): Promise<ApiErrorBody> {
  const body: unknown = await response.json();

  if (
    typeof body !== "object" ||
    body === null ||
    !("error" in body)
  ) {
    throw new Error("Invalid API error response");
  }

  const error = body.error;

  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !("message" in error) ||
    typeof error.message !== "string"
  ) {
    throw new Error("Invalid API error response");
  }

  return {
    error: {
      code: error.code,
      message: error.message,
    },
  };
}

let db: typeof import("../../db/client").db;
let pool: typeof import("../../db/client").pool;

let adminUsers: typeof import("../../db/auth-schema").adminUsers;
let adminSessions: typeof import("../../db/auth-schema").adminSessions;

let eq: typeof import("drizzle-orm").eq;

let createAuthLoginHandler:
  typeof import("../../netlify/functions/auth-login.mts").createAuthLoginHandler;

let createAuthMeHandler:
  typeof import("../../netlify/functions/auth-me.mts").createAuthMeHandler;

let createAuthLogoutHandler:
  typeof import("../../netlify/functions/auth-logout.mts").createAuthLogoutHandler;

let createAdminSession:
  typeof import("../../netlify/functions/_shared/admin-auth/session").createAdminSession;

let createSessionCookie:
  typeof import("../../netlify/functions/_shared/admin-auth/cookie").createSessionCookie;

let server: Server | undefined;
let baseUrl = "";
let adminUsername = "";
let originalContext: string | undefined;

const sessionTokens: string[] = [];

const handlers: Record<
  string,
  (request: Request) => Promise<Response>
> = {};

async function startHttpServer(): Promise<void> {
  server = createServer(async (incoming, outgoing) => {
    try {
      const requestUrl = new URL(
        incoming.url ?? "/",
        baseUrl,
      );

      const handler = handlers[requestUrl.pathname];

      if (!handler) {
        outgoing.writeHead(404);
        outgoing.end();
        return;
      }

      const headers = new Headers();

      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value === undefined) {
          continue;
        }

        headers.set(
          key,
          Array.isArray(value) ? value.join(", ") : value,
        );
      }

      const chunks: Buffer[] = [];

      for await (const chunk of incoming) {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        );
      }

      const body = chunks.length
        ? new Uint8Array(Buffer.concat(chunks))
        : undefined;

      const method = incoming.method ?? "GET";

      const init: RequestInit = {
        method,
        headers,
      };

      if (method !== "GET" && method !== "HEAD") {
        init.body = body;
      }

      const request = new Request(requestUrl, init);
      const response = await handler(request);

      response.headers.forEach((value, key) => {
        outgoing.setHeader(key, value);
      });

      outgoing.writeHead(response.status);

      outgoing.end(
        new Uint8Array(await response.arrayBuffer()),
      );
    } catch (error) {
      console.error("[admin-auth-http-test]", error);

      if (!outgoing.headersSent) {
        outgoing.writeHead(500, {
          "Content-Type": "application/json",
        });
      }

      outgoing.end(
        JSON.stringify({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
          },
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);

    server!.listen(0, "127.0.0.1", () => {
      server!.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to obtain HTTP server address.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
}

describe("Admin Authentication API - HTTP integration", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required.");
    }

    const parsed = new URL(databaseUrl);

    if (
      parsed.protocol !== "postgresql:" ||
      !LOCAL_HOSTS.includes(parsed.hostname) ||
      parsed.port !== LOCAL_PORT ||
      parsed.pathname !== LOCAL_DATABASE
    ) {
      throw new Error(
        "Unsafe database target. Only local plv_site_monitor_dev is allowed.",
      );
    }

    originalContext = process.env.CONTEXT;
    process.env.CONTEXT = "dev";

    const [
      clientModule,
      schemaModule,
      drizzleModule,
      loginModule,
      meModule,
      logoutModule,
      sessionModule,
      cookieModule,
    ] = await Promise.all([
      import("../../db/client"),
      import("../../db/auth-schema"),
      import("drizzle-orm"),
      import("../../netlify/functions/auth-login.mts"),
      import("../../netlify/functions/auth-me.mts"),
      import("../../netlify/functions/auth-logout.mts"),
      import("../../netlify/functions/_shared/admin-auth/session"),
      import("../../netlify/functions/_shared/admin-auth/cookie"),
    ]);

    db = clientModule.db;
    pool = clientModule.pool;

    adminUsers = schemaModule.adminUsers;
    adminSessions = schemaModule.adminSessions;
    eq = drizzleModule.eq;

    createAuthLoginHandler = loginModule.createAuthLoginHandler;
    createAuthMeHandler = meModule.createAuthMeHandler;
    createAuthLogoutHandler = logoutModule.createAuthLogoutHandler;

    createAdminSession = sessionModule.createAdminSession;
    createSessionCookie = cookieModule.createSessionCookie;

    const [admin] = await db
      .select({
        id: adminUsers.id,
        username: adminUsers.username,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, 1))
      .limit(1);

    if (!admin) {
      throw new Error(
        "Existing administrator id=1 is required. No account will be created.",
      );
    }

    adminUsername = admin.username;

    handlers["/api/auth/login"] = createAuthLoginHandler({
      database: db,

      // Integration test does not depend on the real administrator password.
      // Actual scrypt verification is covered by unit tests.
      verifyPassword: async (password, passwordHash) => {
        return (
          password === "integration-test-password" &&
          passwordHash.startsWith("scrypt$v1$")
        );
      },

      createSession: (adminUserId) =>
        createAdminSession(adminUserId, {
          database: db,
        }),

      createCookie: (token) =>
        createSessionCookie(token, {
          environment: {
            context: "dev",
          },
        }),
    });

    handlers["/api/auth/me"] = createAuthMeHandler();

    handlers["/api/auth/logout"] = createAuthLogoutHandler();

    await startHttpServer();
  });

  afterAll(async () => {
    if (db && adminSessions && eq) {
      for (const token of sessionTokens) {
        const tokenHash = createHash("sha256")
          .update(token, "utf8")
          .digest("hex");

        await db
          .delete(adminSessions)
          .where(eq(adminSessions.tokenHash, tokenHash));
      }
    }

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
    }

    if (pool) {
      await pool.end();
    }

    if (originalContext === undefined) {
      delete process.env.CONTEXT;
    } else {
      process.env.CONTEXT = originalContext;
    }
  });

  it("completes login -> me -> logout -> me unauthorized", async () => {
    const loginResponse = await fetch(
      `${baseUrl}/api/auth/login`,
      {
        method: "POST",
        headers: {
          Origin: baseUrl,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: adminUsername,
          password: "integration-test-password",
        }),
      },
    );

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("cache-control")).toBe("no-store");
    expect(loginResponse.headers.get("pragma")).toBe("no-cache");

    const loginBody = await loginResponse.json();

    expect(loginBody).toMatchObject({
      success: true,
      data: {
        authenticated: true,
        admin: {
          id: 1,
          username: adminUsername,
        },
      },
    });

    const setCookie = loginResponse.headers.get("set-cookie");

    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("plv_admin_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    const cookiePair = setCookie!.split(";")[0];
    const token = cookiePair.slice("plv_admin_session=".length);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    sessionTokens.push(token);

    const meResponse = await fetch(
      `${baseUrl}/api/auth/me`,
      {
        headers: {
          Cookie: cookiePair,
        },
      },
    );

    expect(meResponse.status).toBe(200);
    expect(meResponse.headers.get("cache-control")).toBe("no-store");

    const meBody = await meResponse.json();

    expect(meBody).toMatchObject({
      success: true,
      data: {
        authenticated: true,
        admin: {
          id: 1,
          username: adminUsername,
        },
      },
    });

    const logoutResponse = await fetch(
      `${baseUrl}/api/auth/logout`,
      {
        method: "POST",
        headers: {
          Origin: baseUrl,
          Cookie: cookiePair,
        },
      },
    );

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("cache-control")).toBe("no-store");

    const logoutCookie = logoutResponse.headers.get("set-cookie");

    expect(logoutCookie).toContain("plv_admin_session=");
    expect(logoutCookie).toContain("Max-Age=0");

    const logoutBody = await logoutResponse.json();

    expect(logoutBody).toMatchObject({
      success: true,
      data: {
        loggedOut: true,
      },
    });

    const afterLogoutResponse = await fetch(
      `${baseUrl}/api/auth/me`,
      {
        headers: {
          Cookie: cookiePair,
        },
      },
    );

    expect(afterLogoutResponse.status).toBe(401);

    const afterLogoutBody = await afterLogoutResponse.json();

    expect(afterLogoutBody).toMatchObject({
      success: false,
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("rejects invalid login credentials", async () => {
    const response = await fetch(
      `${baseUrl}/api/auth/login`,
      {
        method: "POST",
        headers: {
          Origin: baseUrl,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: adminUsername,
          password: "wrong-integration-password",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await readApiError(response);

    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects unsupported login HTTP methods", async () => {
    const response = await fetch(
      `${baseUrl}/api/auth/login`,
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("rejects login requests from a different Origin", async () => {
    const response = await fetch(
      `${baseUrl}/api/auth/login`,
      {
        method: "POST",
        headers: {
          Origin: "http://evil.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: adminUsername,
          password: "integration-test-password",
        }),
      },
    );

    expect(response.status).toBe(403);

    const body = await readApiError(response);

    expect(body.error.code).toBe("CSRF_REJECTED");
  });

  it("rejects logout requests from a different Origin without clearing cookies", async () => {
    const response = await fetch(
      `${baseUrl}/api/auth/logout`,
      {
        method: "POST",
        headers: {
          Origin: "http://evil.example",
          Cookie: "plv_admin_session=invalid",
        },
      },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();

    const body = await readApiError(response);

    expect(body.error.code).toBe("CSRF_REJECTED");
  });

  it("allows idempotent logout without a session cookie", async () => {
    const response = await fetch(
      `${baseUrl}/api/auth/logout`,
      {
        method: "POST",
        headers: {
          Origin: baseUrl,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const setCookie = response.headers.get("set-cookie");

    expect(setCookie).toContain("plv_admin_session=");
    expect(setCookie).toContain("Max-Age=0");
  });
});


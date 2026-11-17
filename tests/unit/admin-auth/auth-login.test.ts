import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../../db/client", () => ({
  db: {},
}));

import { createAuthLoginHandler } from "../../../netlify/functions/auth-login.mts";
import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";
import type { AdminUser } from "../../../db/auth-schema";
import {
  readApiError,
  readApiSuccess,
} from "../../helpers/api-response";

const TEST_TOKEN = Buffer.from(
  new Uint8Array(32).fill(7),
).toString("base64url");

const ADMIN = {
  id: 1,
  username: "plv",
  passwordHash: "scrypt$v1$test",
} as AdminUser;

function createDatabase(admin: AdminUser | null) {
  const limit = vi.fn().mockResolvedValue(
    admin ? [admin] : [],
  );

  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return {
    database: { select } as never,
    select,
    from,
    where,
    limit,
  };
}

function createRequest(
  body: unknown = {
    username: "plv",
    password: "Correct-Password-2026",
  },
  options: {
    method?: string;
    origin?: string | null;
    contentType?: string;
    rawBody?: string;
  } = {},
): Request {
  const headers = new Headers();

  if (options.origin !== null) {
    headers.set(
      "Origin",
      options.origin ?? "http://localhost:8888",
    );
  }

  headers.set(
    "Content-Type",
    options.contentType ?? "application/json",
  );

  const rawBody =
    options.rawBody ?? JSON.stringify(body);

  return new Request(
    "http://localhost:8888/api/auth/login",
    {
      method: options.method ?? "POST",
      headers,
      body: options.method === "GET" ? undefined : rawBody,
    },
  );
}

function createDependencies(
  admin: AdminUser | null = ADMIN,
) {
  const database = createDatabase(admin);

  const verifyPassword = vi.fn().mockResolvedValue(true);

  const createSession = vi.fn().mockResolvedValue({
    sessionId: "00000000-0000-4000-8000-000000000001",
    token: TEST_TOKEN,
    expiresAt: new Date("2026-11-22T00:00:00.000Z"),
  });

  const createCookie = vi.fn().mockReturnValue(
    `plv_admin_session=${TEST_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
  );

  const assertOrigin = vi.fn();

  return {
    database,
    verifyPassword,
    createSession,
    createCookie,
    assertOrigin,
    dependencies: {
      database: database.database,
      verifyPassword,
      createSession,
      createCookie,
      assertOrigin,
    },
  };
}

interface AdminIdentity {
  authenticated: true;
  admin: {
    id: number;
    username: string;
  };
}

function isAdminIdentity(
  value: unknown,
): value is AdminIdentity {
  if (
    typeof value !== "object" ||
    value === null ||
    !("authenticated" in value) ||
    !("admin" in value) ||
    typeof value.admin !== "object" ||
    value.admin === null ||
    !("id" in value.admin) ||
    !("username" in value.admin)
  ) {
    return false;
  }

  return (
    value.authenticated === true &&
    typeof value.admin.id === "number" &&
    typeof value.admin.username === "string"
  );
}

describe("Admin Login API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CONTEXT", "dev");
  });

  it("rejects unsupported HTTP methods", async () => {
    const setup = createDependencies();
    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(
      createRequest(undefined, { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect(setup.database.select).not.toHaveBeenCalled();
  });

  it("rejects requests when Origin validation fails", async () => {
    const setup = createDependencies();

    setup.assertOrigin.mockImplementation(() => {
      throw new AnalyticsError(
        "CSRF_REJECTED",
        "Request origin validation failed.",
      );
    });

    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(createRequest());

    expect(response.status).toBe(403);

    const body = await readApiError(response);

    expect(body.error.code).toBe("CSRF_REJECTED");
    expect(setup.database.select).not.toHaveBeenCalled();
  });

  it("rejects non-JSON content types", async () => {
    const setup = createDependencies();
    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(
      createRequest(
        {},
        { contentType: "text/plain" },
      ),
    );

    expect(response.status).toBe(400);
    expect(setup.database.select).not.toHaveBeenCalled();
  });

    it("rejects Content-Type values that only begin with application/json", async () => {
    const setup = createDependencies();
    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(
      createRequest(
        {},
        { contentType: "application/json-invalid" },
      ),
    );

    expect(response.status).toBe(400);
    expect(setup.database.select).not.toHaveBeenCalled();
  });

  it("rejects request bodies larger than the configured limit", async () => {
    const setup = createDependencies();
    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(
      createRequest(
        {},
        {
          rawBody: JSON.stringify({
            username: "plv",
            password: "x".repeat(5000),
          }),
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(setup.database.select).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const setup = createDependencies();
    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(
      createRequest(
        {},
        { rawBody: "{invalid-json" },
      ),
    );

    expect(response.status).toBe(400);
    expect(setup.database.select).not.toHaveBeenCalled();
  });

  it("rejects invalid login input", async () => {
    const setup = createDependencies();
    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(
      createRequest({
        username: "PLV",
        password: "password",
      }),
    );

    expect(response.status).toBe(400);
    expect(setup.database.select).not.toHaveBeenCalled();
  });

  it("returns the same unauthorized response for a missing administrator", async () => {
    const setup = createDependencies(null);
    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(createRequest());

    expect(response.status).toBe(401);

    const body = await readApiError(response);

    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "Invalid username or password.",
    });

    expect(setup.verifyPassword).not.toHaveBeenCalled();
    expect(setup.createSession).not.toHaveBeenCalled();
  });

  it("rejects an incorrect password without creating a session", async () => {
    const setup = createDependencies();

    setup.verifyPassword.mockResolvedValue(false);

    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(createRequest());

    expect(response.status).toBe(401);

    const body = await readApiError(response);

    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe(
      "Invalid username or password.",
    );

    expect(setup.createSession).not.toHaveBeenCalled();
    expect(setup.createCookie).not.toHaveBeenCalled();
  });

  it("creates a session and sets an HttpOnly cookie after successful login", async () => {
    const setup = createDependencies();

    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(createRequest());

    expect(response.status).toBe(200);

    expect(setup.assertOrigin).toHaveBeenCalledOnce();

    expect(setup.verifyPassword).toHaveBeenCalledWith(
      "Correct-Password-2026",
      ADMIN.passwordHash,
    );

    expect(setup.createSession).toHaveBeenCalledWith(1);

    expect(setup.createCookie).toHaveBeenCalledWith(
      TEST_TOKEN,
    );

    const cookie = response.headers.get("Set-Cookie");

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");

    expect(response.headers.get("Cache-Control")).toBe(
      "no-store",
    );

    const body = await readApiSuccess(
      response,
      isAdminIdentity,
    );

    expect(body).toEqual({
      success: true,
      data: {
        authenticated: true,
        admin: {
          id: 1,
          username: "plv",
        },
      },
      meta: {},
    });

    expect(JSON.stringify(body)).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(body)).not.toContain(
      ADMIN.passwordHash,
    );
  });

  it("does not expose internal database errors", async () => {
    const setup = createDependencies();

    setup.database.select.mockImplementation(() => {
      throw new Error("Sensitive database connection details");
    });

    const handler = createAuthLoginHandler(
      setup.dependencies,
    );

    const response = await handler(createRequest());

    expect(response.status).toBe(500);

    const body = await readApiError(response);

    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain(
      "Sensitive database connection details",
    );

    expect(response.headers.get("Cache-Control")).toBe(
      "no-store",
    );
  });
});

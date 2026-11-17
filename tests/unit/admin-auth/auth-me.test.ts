import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  readApiError,
  readApiSuccess,
} from "../../helpers/api-response";

vi.mock("../../../db/client", () => ({
  db: {},
}));

import {
  createAuthMeHandler,
} from "../../../netlify/functions/auth-me.mts";

import type {
  AdminAuthContext,
} from "../../../netlify/functions/_shared/admin-auth/auth-context";

import type {
  AdminSessionIdentity,
} from "../../../netlify/functions/_shared/admin-auth/session";

const ADMIN: AdminSessionIdentity = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  adminUserId: 1,
  username: "plv",
};

const AUTHENTICATED_CONTEXT: AdminAuthContext = {
  authenticated: true,
  admin: ADMIN,
};

const UNAUTHENTICATED_CONTEXT: AdminAuthContext = {
  authenticated: false,
  admin: null,
};

function createRequest(method = "GET"): Request {
  return new Request(
    "http://localhost:8888/api/auth/me",
    { method },
  );
}

function createResolver(
  result: AdminAuthContext = AUTHENTICATED_CONTEXT,
) {
  return vi.fn(
    async (_request: Request): Promise<AdminAuthContext> => result,
  );
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

describe("Admin Me API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CONTEXT", "dev");
  });

  it("rejects unsupported HTTP methods", async () => {
    const resolveAuthContext = createResolver();

    const handler = createAuthMeHandler({
      resolveAuthContext,
    });

    const response = await handler(createRequest("POST"));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect(resolveAuthContext).not.toHaveBeenCalled();
  });

  it("returns the authenticated administrator identity", async () => {
    const resolveAuthContext = createResolver();

    const handler = createAuthMeHandler({
      resolveAuthContext,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(200);
    expect(resolveAuthContext).toHaveBeenCalledOnce();

    const body = await readApiSuccess(response, isAdminIdentity)

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

    expect(JSON.stringify(body)).not.toContain(ADMIN.sessionId);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });

  it("returns 401 when the administrator is not authenticated", async () => {
    const resolveAuthContext = createResolver(
      UNAUTHENTICATED_CONTEXT,
    );

    const handler = createAuthMeHandler({
      resolveAuthContext,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(401);

    const body = await readApiError(response);

    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "Authentication required.",
    });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 401 when the session has expired or been revoked", async () => {
    const resolveAuthContext = createResolver(
      UNAUTHENTICATED_CONTEXT,
    );

    const handler = createAuthMeHandler({
      resolveAuthContext,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(401);
  });

  it("does not expose internal errors when authentication resolution throws", async () => {
    const resolveAuthContext = vi.fn(
      async (): Promise<AdminAuthContext> => {
        throw new Error("Sensitive database connection details");
      },
    );

    const handler = createAuthMeHandler({
      resolveAuthContext,
    });

    const response = await handler(createRequest());

    expect(response.status).toBe(500);

    const body = await readApiError(response);

    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain(
      "Sensitive database connection details",
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

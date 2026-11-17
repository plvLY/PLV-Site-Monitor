
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  assertSameOrigin,
  createAdminAuthorization,
  requireAdmin,
  type AdminAuthContextResolver,
} from "../../../netlify/functions/_shared/admin-auth/guard";

import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";

import type { AdminAuthContext } from "../../../netlify/functions/_shared/admin-auth/auth-context";
import type { AdminSessionIdentity } from "../../../netlify/functions/_shared/admin-auth/session";

const ADMIN_A: AdminSessionIdentity = {
  sessionId: "session-a",
  adminUserId: 1,
  username: "admin-a",
};

const ADMIN_B: AdminSessionIdentity = {
  sessionId: "session-b",
  adminUserId: 1,
  username: "admin-b",
};

function authenticatedContext(
  admin: AdminSessionIdentity,
): AdminAuthContext {
  return {
    authenticated: true,
    admin,
  };
}

function unauthenticatedContext(): AdminAuthContext {
  return {
    authenticated: false,
    admin: null,
  };
}

function createRequest(
  url = "https://example.com/api/test",
  origin?: string,
): Request {
  const headers = new Headers();

  if (origin !== undefined) {
    headers.set("origin", origin);
  }

  return new Request(url, {
    method: "GET",
    headers,
  });
}

function expectAnalyticsError(
  action: () => unknown,
  code: string,
  status: number,
): void {
  try {
    action();
    throw new Error("Expected AnalyticsError was not thrown.");
  } catch (error) {
    expect(error).toBeInstanceOf(AnalyticsError);
    expect(error).toMatchObject({
      code,
      status,
    });
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireAdmin", () => {
  it("returns the current administrator identity", async () => {
    const request = createRequest();

    const resolveAuthContext = vi.fn().mockResolvedValue(
      authenticatedContext(ADMIN_A),
    );

    await expect(
      requireAdmin(request, { resolveAuthContext }),
    ).resolves.toEqual(ADMIN_A);

    expect(resolveAuthContext).toHaveBeenCalledOnce();
    expect(resolveAuthContext).toHaveBeenCalledWith(request);
  });

  it("rejects unauthenticated requests", async () => {
    const resolveAuthContext = vi.fn().mockResolvedValue(
      unauthenticatedContext(),
    );

    await expect(
      requireAdmin(
        createRequest(),
        { resolveAuthContext },
      ),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("rejects resolver failures with UNAUTHORIZED", async () => {
    const resolveAuthContext = vi.fn().mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      requireAdmin(
        createRequest(),
        { resolveAuthContext },
      ),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("resolves each request independently", async () => {
    const resolveAuthContext: AdminAuthContextResolver = vi
      .fn()
      .mockResolvedValueOnce(authenticatedContext(ADMIN_A))
      .mockResolvedValueOnce(authenticatedContext(ADMIN_B));

    const requestA = createRequest();
    const requestB = createRequest();

    const [adminA, adminB] = await Promise.all([
      requireAdmin(requestA, { resolveAuthContext }),
      requireAdmin(requestB, { resolveAuthContext }),
    ]);

    expect(adminA).toEqual(ADMIN_A);
    expect(adminB).toEqual(ADMIN_B);
    expect(resolveAuthContext).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed unauthenticated contexts", async () => {
    const resolveAuthContext = vi.fn().mockResolvedValue({
      authenticated: true,
      admin: null,
    });

    await expect(
      requireAdmin(
        createRequest(),
        { resolveAuthContext },
      ),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("createAdminAuthorization", () => {
  it("creates an authenticated Authorization for the administrator", async () => {
    const authorization = await createAdminAuthorization(
      createRequest(),
      {
        resolveAuthContext: async () =>
          authenticatedContext(ADMIN_A),
      },
    );

    expect(authorization.isAuthenticated()).toBe(true);
    expect(authorization.getContext()).toEqual({
      userId: "1",
      authenticated: true,
    });
  });

  it("allows the super administrator to access different sites", async () => {
    const authorization = await createAdminAuthorization(
      createRequest(),
      {
        resolveAuthContext: async () =>
          authenticatedContext(ADMIN_A),
      },
    );

    await expect(
      authorization.requireSiteAccess("site-a"),
    ).resolves.toBeUndefined();

    await expect(
      authorization.requireSiteAccess("site-b"),
    ).resolves.toBeUndefined();
  });

  it("rejects unauthenticated requests", async () => {
    await expect(
      createAdminAuthorization(
        createRequest(),
        {
          resolveAuthContext: async () =>
            unauthenticatedContext(),
        },
      ),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("creates separate Authorization instances for separate requests", async () => {
    const resolveAuthContext: AdminAuthContextResolver = vi
      .fn()
      .mockResolvedValueOnce(authenticatedContext(ADMIN_A))
      .mockResolvedValueOnce(authenticatedContext(ADMIN_B));

    const [authorizationA, authorizationB] = await Promise.all([
      createAdminAuthorization(
        createRequest(),
        { resolveAuthContext },
      ),
      createAdminAuthorization(
        createRequest(),
        { resolveAuthContext },
      ),
    ]);

    expect(authorizationA).not.toBe(authorizationB);

    expect(authorizationA.getContext().userId).toBe("1");
    expect(authorizationB.getContext().userId).toBe("1");
  });
});

describe("assertSameOrigin", () => {
  it("accepts an exact HTTPS same-origin request", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => {
      assertSameOrigin(
        createRequest(
          "https://example.com/api/settings",
          "https://example.com",
        ),
      );
    }).not.toThrow();
  });

  it("accepts an exact localhost origin with a development port", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(() => {
      assertSameOrigin(
        createRequest(
          "http://localhost:8888/api/settings",
          "http://localhost:8888",
        ),
      );
    }).not.toThrow();
  });

  it.each([
    ["missing Origin", undefined],
    ["null Origin", "null"],
    ["empty Origin", ""],
    ["invalid protocol", "ftp://example.com"],
    ["Origin with path", "https://example.com/path"],
    ["cross-origin hostname", "https://evil.example"],
    ["cross-origin port", "https://example.com:8443"],
    ["cross-origin protocol", "http://example.com"],
  ])("rejects %s", (_description, origin) => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => {
      assertSameOrigin(
        createRequest(
          "https://example.com/api/settings",
          origin,
        ),
      );
    }).toThrow(
      expect.objectContaining({
        code: "CSRF_REJECTED",
        status: 403,
      }),
    );
  });

  it("rejects a malformed request URL", () => {
    const request = {
      headers: new Headers({
        origin: "https://example.com",
      }),
      url: "not-a-valid-url",
    } as Request;

    expect(() => {
      assertSameOrigin(request);
    }).toThrow(
      expect.objectContaining({
        code: "CSRF_REJECTED",
        status: 403,
      }),
    );
  });
});

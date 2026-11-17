
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getAdminAuthContext,
  type AdminAuthContext,
} from "../../../netlify/functions/_shared/admin-auth/auth-context";

import type {
  AdminSessionIdentity,
} from "../../../netlify/functions/_shared/admin-auth/session";

const TEST_TOKEN = Buffer.from(
  new Uint8Array(32).fill(1),
).toString("base64url");

const TEST_IDENTITY: AdminSessionIdentity = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  adminUserId: 1,
  username: "test-admin",
};

function createRequest(token?: string): Request {
  const headers = new Headers();

  if (token) {
    headers.set(
      "cookie",
      `plv_admin_session=${token}`,
    );
  }

  return new Request("http://localhost:8888/api/test", {
    method: "GET",
    headers,
  });
}

function createVerifier(
  result: AdminSessionIdentity | null,
) {
  return vi.fn(
    async (
      _token: string | null | undefined,
    ): Promise<AdminSessionIdentity | null> => result,
  );
}

describe("getAdminAuthContext", () => {
  beforeEach(() => {
    vi.stubEnv("CONTEXT", "dev");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns unauthenticated context when cookie is missing", async () => {
    const verifySession = createVerifier(TEST_IDENTITY);

    const result = await getAdminAuthContext(
      createRequest(),
      { verifySession },
    );

    expect(result).toEqual({
      authenticated: false,
      admin: null,
    } satisfies AdminAuthContext);

    expect(verifySession).not.toHaveBeenCalled();
  });

  it("returns unauthenticated context for an invalid cookie", async () => {
    const verifySession = createVerifier(TEST_IDENTITY);

    const result = await getAdminAuthContext(
      createRequest("invalid-token"),
      { verifySession },
    );

    expect(result.authenticated).toBe(false);
    expect(result.admin).toBeNull();
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("returns administrator identity for a valid session", async () => {
    const verifySession = createVerifier(TEST_IDENTITY);

    const result = await getAdminAuthContext(
      createRequest(TEST_TOKEN),
      { verifySession },
    );

    expect(result).toEqual({
      authenticated: true,
      admin: TEST_IDENTITY,
    });

    expect(verifySession).toHaveBeenCalledOnce();
    expect(verifySession).toHaveBeenCalledWith(TEST_TOKEN);
  });

  it("returns unauthenticated context when session verification returns null", async () => {
    const verifySession = createVerifier(null);

    const result = await getAdminAuthContext(
      createRequest(TEST_TOKEN),
      { verifySession },
    );

    expect(result.authenticated).toBe(false);
    expect(result.admin).toBeNull();
  });

  it("fails closed when session verification throws", async () => {
    const verifySession = vi.fn(
      async (): Promise<AdminSessionIdentity | null> => {
        throw new Error("Database connection failed");
      },
    );

    const result = await getAdminAuthContext(
      createRequest(TEST_TOKEN),
      { verifySession },
    );

    expect(result.authenticated).toBe(false);
    expect(result.admin).toBeNull();
  });

  it("does not share identity between different requests", async () => {
    const firstIdentity = TEST_IDENTITY;

    const secondIdentity: AdminSessionIdentity = {
      sessionId: "00000000-0000-4000-8000-000000000002",
      adminUserId: 1,
      username: "test-admin",
    };

    const verifySession = vi.fn(
      async (
        token: string | null | undefined,
      ): Promise<AdminSessionIdentity | null> => {
        if (token === TEST_TOKEN) {
          return firstIdentity;
        }

        if (
          token === Buffer.from(
            new Uint8Array(32).fill(2),
          ).toString("base64url")
        ) {
          return secondIdentity;
        }

        return null;
      },
    );

    const secondToken = Buffer.from(
      new Uint8Array(32).fill(2),
    ).toString("base64url");

    const firstResult = await getAdminAuthContext(
      createRequest(TEST_TOKEN),
      { verifySession },
    );

    const secondResult = await getAdminAuthContext(
      createRequest(secondToken),
      { verifySession },
    );

    expect(firstResult.admin).toEqual(firstIdentity);
    expect(secondResult.admin).toEqual(secondIdentity);
    expect(firstResult.admin).not.toBe(secondResult.admin);
  });
});

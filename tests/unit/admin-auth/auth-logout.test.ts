
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnalyticsError,
} from "../../../netlify/functions/_shared/analytics/errors";

import {
  createAuthLogoutHandler,
} from "../../../netlify/functions/auth-logout.mts";

import {
  readApiError,
  readApiSuccess,
} from "../../helpers/api-response";

interface LogoutData {
  loggedOut: true;
}

function isLogoutData(
  value: unknown,
): value is LogoutData {
  return (
    typeof value === "object" &&
    value !== null &&
    "loggedOut" in value &&
    value.loggedOut === true
  );
}

describe("Admin Logout API", () => {
  const token = "test-session-token";

  const revokeSession = vi.fn();
  const getSessionToken = vi.fn();
  const clearCookie = vi.fn();
  const assertOrigin = vi.fn();

  const clearCookieValue =
    "plv_admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";

  function createRequest(
    method = "POST",
    cookie: string | null = `plv_admin_session=${token}`,
  ): Request {
    const headers = new Headers({
      Origin: "http://localhost:8888",
    });

    if (cookie !== null) {
      headers.set("Cookie", cookie);
    }

    return new Request("http://localhost:8888/api/auth/logout", {
      method,
      headers,
    });
  }

  function createHandler() {
    return createAuthLogoutHandler({
      getSessionToken,
      revokeSession,
      clearCookie,
      assertOrigin,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    getSessionToken.mockReturnValue(token);
    revokeSession.mockResolvedValue(true);
    clearCookie.mockReturnValue(clearCookieValue);
    assertOrigin.mockImplementation(() => undefined);
  });

  it("rejects non-POST requests with Allow header", async () => {
    const response = await createHandler()(
      createRequest("GET"),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    expect(assertOrigin).not.toHaveBeenCalled();
    expect(getSessionToken).not.toHaveBeenCalled();
    expect(revokeSession).not.toHaveBeenCalled();
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it("rejects requests when Origin validation fails", async () => {
    assertOrigin.mockImplementation(() => {
      throw new AnalyticsError(
        "CSRF_REJECTED",
        "Request origin is not allowed.",
      );
    });

    const response = await createHandler()(
      createRequest(),
    );

    const body = await readApiError(response);

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("CSRF_REJECTED");

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();

    expect(getSessionToken).not.toHaveBeenCalled();
    expect(revokeSession).not.toHaveBeenCalled();
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it("revokes the current session and clears the cookie", async () => {
    const response = await createHandler()(
      createRequest(),
    );

    const body = await readApiSuccess(response, isLogoutData);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        loggedOut: true,
      },
      meta: {},
    });

    expect(assertOrigin).toHaveBeenCalledOnce();
    expect(getSessionToken).toHaveBeenCalledWith(
      `plv_admin_session=${token}`,
    );
    expect(revokeSession).toHaveBeenCalledWith(token);

    expect(response.headers.get("Set-Cookie")).toBe(
      clearCookieValue,
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });

  it("allows logout when the cookie is missing", async () => {
    getSessionToken.mockReturnValue(null);

    const response = await createHandler()(
      createRequest("POST", null),
    );

    const body = await readApiSuccess(response, isLogoutData);

    expect(response.status).toBe(200);
    expect(body.data.loggedOut).toBe(true);

    expect(revokeSession).not.toHaveBeenCalled();
    expect(clearCookie).toHaveBeenCalledOnce();
    expect(response.headers.get("Set-Cookie")).toBe(
      clearCookieValue,
    );
  });

  it("allows logout when the cookie is invalid", async () => {
    getSessionToken.mockReturnValue(null);

    const response = await createHandler()(
      createRequest("POST", "plv_admin_session=invalid"),
    );

    expect(response.status).toBe(200);
    expect(revokeSession).not.toHaveBeenCalled();
    expect(response.headers.get("Set-Cookie")).toBe(
      clearCookieValue,
    );
  });

  it("allows repeated logout when the session is already revoked", async () => {
    revokeSession.mockResolvedValue(false);

    const response = await createHandler()(
      createRequest(),
    );

    const body = await readApiSuccess(
      response,
      isLogoutData,
    );

    expect(response.status).toBe(200);
    expect(body.data.loggedOut).toBe(true);
    expect(revokeSession).toHaveBeenCalledWith(token);
    expect(response.headers.get("Set-Cookie")).toBe(
      clearCookieValue,
    );
  });

  it("returns 500 and clears the cookie when revocation fails", async () => {
    revokeSession.mockRejectedValue(
      new Error("Sensitive database connection details"),
    );

    const response = await createHandler()(
      createRequest(),
    );

    const body = await readApiError(response);

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");

    expect(body.error.message).not.toContain(
      "Sensitive database connection details",
    );

    expect(response.headers.get("Set-Cookie")).toBe(
      clearCookieValue,
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not expose the session token in the response", async () => {
    const response = await createHandler()(
      createRequest(),
    );

    const responseText = await response.text();

    expect(responseText).not.toContain(token);
    expect(responseText).not.toContain("sessionId");
    expect(responseText).not.toContain("passwordHash");
  });

  it("returns no-store headers for successful logout", async () => {
    const response = await createHandler()(
      createRequest(),
    );

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });
});

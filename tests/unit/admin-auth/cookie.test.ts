
import { describe, expect, it } from "vitest";

import {
  getAdminSessionCookieName,
  createSessionCookie,
  getSessionTokenFromCookie,
  clearSessionCookie,
} from "../../../netlify/functions/_shared/admin-auth/cookie";

const TOKEN = Buffer.alloc(32, 7).toString("base64url");

describe("admin session cookie", () => {
  const production = {
    environment: { context: "production" },
  };

  const local = {
    environment: { context: "dev" },
  };

  it("uses the production __Host cookie name", () => {
    expect(getAdminSessionCookieName(production)).toBe(
      "__Host-plv_admin_session",
    );
  });

  it("uses a separate cookie name in local development", () => {
    expect(getAdminSessionCookieName(local)).toBe(
      "plv_admin_session",
    );
  });

  it("sets secure production cookie attributes", () => {
    const cookie = createSessionCookie(TOKEN, production);

    expect(cookie).toContain("__Host-plv_admin_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=604800");
  });

  it("does not use Secure for local HTTP development", () => {
    const cookie = createSessionCookie(TOKEN, local);

    expect(cookie).toContain("plv_admin_session=");
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("extracts a valid production session token", () => {
    const result = getSessionTokenFromCookie(
      `theme=dark; __Host-plv_admin_session=${TOKEN}`,
      production,
    );

    expect(result).toBe(TOKEN);
  });

  it("extracts a valid local session token", () => {
    const result = getSessionTokenFromCookie(
      `plv_admin_session=${TOKEN}`,
      local,
    );

    expect(result).toBe(TOKEN);
  });

  it("rejects duplicate session cookies", () => {
    const result = getSessionTokenFromCookie(
      `__Host-plv_admin_session=${TOKEN}; __Host-plv_admin_session=${TOKEN}`,
      production,
    );

    expect(result).toBeNull();
  });

  it("rejects malformed and oversized cookie headers", () => {
    expect(
      getSessionTokenFromCookie("__Host-plv_admin_session=invalid", production),
    ).toBeNull();

    expect(
      getSessionTokenFromCookie("a".repeat(8193), production),
    ).toBeNull();

    expect(
      getSessionTokenFromCookie(null, production),
    ).toBeNull();
  });

  it("clears the production cookie with matching security attributes", () => {
    const cookie = clearSessionCookie(production);

    expect(cookie).toContain("__Host-plv_admin_session=");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });

  it("clears the local cookie using the local cookie name", () => {
    const cookie = clearSessionCookie(local);

    expect(cookie).toContain("plv_admin_session=");
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("Max-Age=0");
  });

  it("rejects malformed tokens when creating a cookie", () => {
    expect(() => createSessionCookie("invalid", production)).toThrow(
      "Invalid administrator session token.",
    );
  });
});

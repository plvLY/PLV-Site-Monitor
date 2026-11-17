
const PRODUCTION_COOKIE_NAME = "__Host-plv_admin_session";
const LOCAL_COOKIE_NAME = "plv_admin_session";

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AdminCookieEnvironment {
  context?: string;
}

export interface AdminCookieOptions {
  environment?: AdminCookieEnvironment;
}

function isLocalDevelopment(
  environment: AdminCookieEnvironment,
): boolean {
  return environment.context === "dev";
}

export function getAdminSessionCookieName(
  options: AdminCookieOptions = {},
): string {
  const environment = options.environment ?? {
    context: process.env.CONTEXT,
  };

  return isLocalDevelopment(environment)
    ? LOCAL_COOKIE_NAME
    : PRODUCTION_COOKIE_NAME;
}

function getCookieAttributes(
  options: AdminCookieOptions = {},
): string {
  const environment = options.environment ?? {
    context: process.env.CONTEXT,
  };

  const secure = !isLocalDevelopment(environment);

  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function validateToken(token: string): void {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid administrator session token.");
  }
}

/**
 * Build the Set-Cookie header for a new administrator session.
 */
export function createSessionCookie(
  token: string,
  options: AdminCookieOptions = {},
): string {
  validateToken(token);

  const name = getAdminSessionCookieName(options);
  const attributes = getCookieAttributes(options);

  return `${name}=${token}; ${attributes}`;
}

/**
 * Extract the administrator session token from Cookie header.
 *
 * Duplicate session cookie names are rejected.
 */
export function getSessionTokenFromCookie(
  cookieHeader: string | null | undefined,
  options: AdminCookieOptions = {},
): string | null {
  if (!cookieHeader || cookieHeader.length > 8192) {
    return null;
  }

  const name = getAdminSessionCookieName(options);
  const prefix = `${name}=`;

  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));

  if (matches.length !== 1) {
    return null;
  }

  const token = matches[0].slice(prefix.length);

  if (!SESSION_TOKEN_PATTERN.test(token)) {
    return null;
  }

  const decoded = Buffer.from(token, "base64url");

  if (
    decoded.length !== 32 ||
    decoded.toString("base64url") !== token
  ) {
    return null;
  }

  return token;
}

/**
 * Clear the administrator session cookie.
 */
export function clearSessionCookie(
  options: AdminCookieOptions = {},
): string {
  const name = getAdminSessionCookieName(options);
  const environment = options.environment ?? {
    context: process.env.CONTEXT,
  };

  const secure = !isLocalDevelopment(environment);

  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}


import { getSessionTokenFromCookie } from "./cookie";
import {
  verifyAdminSession,
  type AdminSessionIdentity,
} from "./session";

export interface AdminAuthContext {
  readonly authenticated: boolean;
  readonly admin: AdminSessionIdentity | null;
}

export interface AdminAuthContextOptions {
  verifySession?: typeof verifyAdminSession;
}

const UNAUTHENTICATED_CONTEXT: AdminAuthContext = {
  authenticated: false,
  admin: null,
};

/**
 * Resolve the administrator identity from the current HTTP request.
 *
 * Authentication is request-scoped. No identity is cached between requests.
 * Missing, invalid, expired, revoked sessions and verification failures
 * all result in an unauthenticated context.
 */
export async function getAdminAuthContext(
  request: Request,
  options: AdminAuthContextOptions = {},
): Promise<AdminAuthContext> {
  try {
    const token = getSessionTokenFromCookie(
      request.headers.get("cookie"),
    );

    if (!token) {
      return UNAUTHENTICATED_CONTEXT;
    }

    const verifySession =
      options.verifySession ?? verifyAdminSession;

    const admin = await verifySession(token);

    if (!admin) {
      return UNAUTHENTICATED_CONTEXT;
    }

    return {
      authenticated: true,
      admin,
    };
  } catch {
    // Authentication must fail closed.
    return UNAUTHENTICATED_CONTEXT;
  }
}

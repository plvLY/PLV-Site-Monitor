
import { createHmac } from "node:crypto";

const SECRET_PATTERN = /^[0-9a-fA-F]{64}$/;
const KEY_VERSION_PATTERN = /^[1-9]\d*$/;

export interface AnalyticsIdentityConfig {
  secret: string;
  keyVersion: number;
}

export interface AnalyticsIdentityResult {
  key: string;
  keyVersion: number;
}

function validateIdentifier(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

export function getAnalyticsIdentityConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsIdentityConfig {
  const secret = env.PLV_ANALYTICS_HMAC_SECRET;
  const rawVersion = env.PLV_ANALYTICS_HMAC_KEY_VERSION;

  if (!secret || !SECRET_PATTERN.test(secret)) {
    throw new Error(
      "PLV_ANALYTICS_HMAC_SECRET must be a 64-character hexadecimal string",
    );
  }

  if (!rawVersion || !KEY_VERSION_PATTERN.test(rawVersion)) {
    throw new Error(
      "PLV_ANALYTICS_HMAC_KEY_VERSION must be a positive integer",
    );
  }

  const keyVersion = Number(rawVersion);

  if (!Number.isSafeInteger(keyVersion)) {
    throw new Error(
      "PLV_ANALYTICS_HMAC_KEY_VERSION exceeds the safe integer range",
    );
  }

  return { secret, keyVersion };
}

function createIdentityKey(
  secret: string,
  purpose: "visitor" | "session",
  siteId: string,
  identity: string,
): string {
  validateIdentifier(siteId, "siteId");
  validateIdentifier(identity, "identity");

  const canonical = `plv-sm:${purpose}:v1:${siteId}:${identity}`;

  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(canonical, "utf8")
    .digest("hex");
}

/**
 * Creates purpose-separated, site-scoped Analytics identity keys.
 *
 * sessionIdentity must be determined by the server-side Analytics
 * Session lifecycle. Do not pass the current tab-level session_id.
 */
export function createAnalyticsIdentity(
  config: AnalyticsIdentityConfig = getAnalyticsIdentityConfig(),
) {
  if (!SECRET_PATTERN.test(config.secret)) {
    throw new Error("Analytics HMAC secret must be 64 hexadecimal characters");
  }

  if (
    !Number.isSafeInteger(config.keyVersion) ||
    config.keyVersion <= 0
  ) {
    throw new Error("Analytics HMAC key version must be a positive integer");
  }

  return {
    keyVersion: config.keyVersion,

    createVisitorKey(
      siteId: string,
      visitorId: string,
    ): AnalyticsIdentityResult {
      return {
        key: createIdentityKey(
          config.secret,
          "visitor",
          siteId,
          visitorId,
        ),
        keyVersion: config.keyVersion,
      };
    },

    createSessionKey(
      siteId: string,
      sessionIdentity: string,
    ): AnalyticsIdentityResult {
      return {
        key: createIdentityKey(
          config.secret,
          "session",
          siteId,
          sessionIdentity,
        ),
        keyVersion: config.keyVersion,
      };
    },
  };
}

import { AnalyticsError } from "../analytics/errors";
import { SYSTEM_SETTINGS_LIMITS } from "./settings-defaults";
import type { SystemSettingsPatch } from "./settings-types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowedKeys(
  value: UnknownRecord,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new AnalyticsError("INVALID_SETTINGS", `Unknown settings field: ${key}`);
    }
  }
}

function parseRetentionDays(
  value: unknown,
  field: keyof typeof SYSTEM_SETTINGS_LIMITS,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new AnalyticsError(
      "INVALID_SETTINGS",
      `${field} must be a positive integer.`,
    );
  }

  const days = value as number;
  const { min, max } = SYSTEM_SETTINGS_LIMITS[field];

  if (days < min) {
    throw new AnalyticsError(
      "INVALID_SETTINGS",
      `${field} must be at least ${min} day.`,
    );
  }

  if (days > max) {
    throw new AnalyticsError(
      "RETENTION_LIMIT_EXCEEDED",
      `${field} cannot exceed ${max} days.`,
    );
  }

  return days;
}

/**
 * Validate the public PATCH payload and map snake_case API fields to
 * camelCase service fields. Unknown fields and empty patches are rejected.
 */
export function validateSettingsPatch(value: unknown): SystemSettingsPatch {
  if (!isRecord(value)) {
    throw new AnalyticsError("INVALID_SETTINGS", "Request body must be an object.");
  }

  assertAllowedKeys(value, ["retention", "privacy"]);

  const patch: SystemSettingsPatch = {};

  if (value.retention !== undefined) {
    if (!isRecord(value.retention)) {
      throw new AnalyticsError("INVALID_SETTINGS", "retention must be an object.");
    }

    assertAllowedKeys(value.retention, [
      "event_retention_days",
      "ip_retention_days",
      "user_agent_retention_days",
    ]);

    if ("event_retention_days" in value.retention) {
      patch.eventRetentionDays = parseRetentionDays(
        value.retention.event_retention_days,
        "eventRetentionDays",
      );
    }

    if ("ip_retention_days" in value.retention) {
      patch.ipRetentionDays = parseRetentionDays(
        value.retention.ip_retention_days,
        "ipRetentionDays",
      );
    }

    if ("user_agent_retention_days" in value.retention) {
      patch.userAgentRetentionDays = parseRetentionDays(
        value.retention.user_agent_retention_days,
        "userAgentRetentionDays",
      );
    }
  }

  if (value.privacy !== undefined) {
    if (!isRecord(value.privacy)) {
      throw new AnalyticsError("INVALID_SETTINGS", "privacy must be an object.");
    }

    assertAllowedKeys(value.privacy, ["store_raw_ip"]);

    if ("store_raw_ip" in value.privacy) {
      if (typeof value.privacy.store_raw_ip !== "boolean") {
        throw new AnalyticsError(
          "INVALID_SETTINGS",
          "store_raw_ip must be a boolean.",
        );
      }

      patch.storeRawIp = value.privacy.store_raw_ip;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new AnalyticsError(
      "INVALID_SETTINGS",
      "At least one supported setting must be provided.",
    );
  }

  return patch;
}

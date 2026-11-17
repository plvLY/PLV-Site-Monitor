import type { TrackerConfig, TrackerOptions } from "../types";
import { TrackerConfigError } from "./errors";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeConfig(
  options: TrackerOptions
): TrackerConfig {
  if (!options || typeof options !== "object") {
    throw new TrackerConfigError("Tracker options are required.");
  }

  if (
    typeof options.siteId !== "string" ||
    !UUID_REGEX.test(options.siteId)
  ) {
    throw new TrackerConfigError("Invalid siteId: expected a valid UUID.");
  }

  if (
    typeof options.endpoint !== "string" ||
    options.endpoint.trim() === ""
  ) {
    throw new TrackerConfigError("endpoint is required.");
  }

  let endpoint: URL;

  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new TrackerConfigError("Invalid endpoint URL.");
  }

  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new TrackerConfigError(
      "endpoint must use HTTP or HTTPS."
    );
  }

  if (typeof options.debug !== "undefined" &&
      typeof options.debug !== "boolean") {
    throw new TrackerConfigError("debug must be a boolean.");
  }

  return {
    siteId: options.siteId,
    endpoint: endpoint.toString(),
    debug: options.debug ?? false,
  };
}

export function isSameConfig(
  left: TrackerConfig,
  right: TrackerConfig
): boolean {
  return (
    left.siteId === right.siteId &&
    left.endpoint === right.endpoint &&
    left.debug === right.debug
  );
}

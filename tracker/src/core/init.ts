import type { TrackerInstance, TrackerOptions } from "../types";
import { normalizeConfig, isSameConfig } from "./config";
import { Tracker } from "./tracker";
import { TrackerConfigConflictError } from "./errors";

let trackerInstance: Tracker | null = null;

export function init(options: TrackerOptions): TrackerInstance {
  const config = normalizeConfig(options);

  if (trackerInstance) {
    if (isSameConfig(trackerInstance.config, config)) {
      return trackerInstance;
    }

    throw new TrackerConfigConflictError(
      "PLV Tracker has already been initialized with different configuration."
    );
  }

  trackerInstance = new Tracker(config);

  return trackerInstance;
}

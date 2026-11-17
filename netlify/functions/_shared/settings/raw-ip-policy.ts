
import { getSystemSettings } from "./settings-service";

/**
 * Determine whether raw IP addresses may be persisted.
 *
 * Fail closed: settings read failures must never enable raw IP storage.
 */
export async function isRawIpStorageEnabled(): Promise<boolean> {
  try {
    const settings = await getSystemSettings();
    return settings.privacy.store_raw_ip;
  } catch (error) {
    console.error(
      "[collect] Failed to read privacy settings; raw IP storage is disabled.",
      error,
    );

    return false;
  }
}

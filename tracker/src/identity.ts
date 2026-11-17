import type { Identity, IdentityManager } from "./types";

const VISITOR_STORAGE_KEY = "plv_sm_visitor_id";
const SESSION_STORAGE_KEY = "plv_sm_session_id";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 当前页面生命周期内的降级缓存
const memoryStore = new Map<string, string>();

type StorageType = "localStorage" | "sessionStorage";

function getStorage(type: StorageType): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }

    return window[type] ?? null;
  } catch {
    return null;
  }
}

function generateUuidV4(): string {
  const cryptoApi = globalThis.crypto;

  if (!cryptoApi) {
    throw new Error(
      "PLV Tracker: Secure UUID generation is not supported in this environment."
    );
  }

  if (typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi.getRandomValues !== "function") {
    throw new Error(
      "PLV Tracker: crypto.getRandomValues is not supported."
    );
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));

  // RFC 4122 UUID v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function isValidUuidV4(
  value: string | null | undefined
): value is string {
  return typeof value === "string" && UUID_V4_REGEX.test(value);
}

function resolveId(
  storageType: StorageType,
  storageKey: string
): string {
  const storage = getStorage(storageType);

  if (storage) {
    try {
      const existing = storage.getItem(storageKey);

      if (isValidUuidV4(existing)) {
        memoryStore.set(storageKey, existing);
        return existing;
      }
    } catch {
      // Storage read failed; use in-memory fallback.
    }
  }

  const cached = memoryStore.get(storageKey);

  if (isValidUuidV4(cached)) {
    return cached;
  }

  const id = generateUuidV4();

  memoryStore.set(storageKey, id);

  if (storage) {
    try {
      storage.setItem(storageKey, id);
    } catch {
      // Storage write failed; retain the ID in memory.
    }
  }

  return id;
}

export function createIdentityManager(): IdentityManager {
  let identity: Identity | null = null;

  function getVisitorId(): string {
    return resolveId("localStorage", VISITOR_STORAGE_KEY);
  }

  function getSessionId(): string {
    return resolveId("sessionStorage", SESSION_STORAGE_KEY);
  }

  function getIdentity(): Identity {
    if (!identity) {
      identity = {
        visitorId: getVisitorId(),
        sessionId: getSessionId(),
      };
    }

    return { ...identity };
  }

  return {
    getIdentity,
    getVisitorId,
    getSessionId,
  };
}

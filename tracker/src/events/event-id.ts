const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateEventId(): string {
  const cryptoApi = globalThis.crypto;

  if (!cryptoApi) {
    throw new Error(
      "PLV Tracker: Secure event ID generation is not supported."
    );
  }

  let eventId: string;

  if (typeof cryptoApi.randomUUID === "function") {
    eventId = cryptoApi.randomUUID();
  } else if (typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");

    eventId = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  } else {
    throw new Error(
      "PLV Tracker: Secure UUID generation is not supported."
    );
  }

  if (!UUID_V4_REGEX.test(eventId)) {
    throw new Error(
      "PLV Tracker: Generated event ID is not a valid UUID v4."
    );
  }

  return eventId;
}

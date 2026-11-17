import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({ db: {} }));

vi.mock("../../netlify/functions/_shared/settings/settings-service", () => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}));

import { Authorization } from "../../netlify/functions/_shared/analytics/authorization";
import {
  getSystemSettings,
  updateSystemSettings,
} from "../../netlify/functions/_shared/settings/settings-service";
import { createSettingsHandler } from "../../netlify/functions/settings.mts";

const SETTINGS = {
  retention: {
    event_retention_days: 90,
    ip_retention_days: 30,
    user_agent_retention_days: 30,
  },
  privacy: { store_raw_ip: true },
};

function authenticatedAuthorization() {
  return new Authorization({
    authContext: {
      userId: "test-admin",
      authenticated: true,
    },
  });
}

describe("settings API handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSystemSettings).mockResolvedValue(SETTINGS);
    vi.mocked(updateSystemSettings).mockResolvedValue(SETTINGS);
  });

  it("rejects unauthenticated requests", async () => {
    const handler = createSettingsHandler({
      database: {} as never,
      authorization: new Authorization(),
    });

    const response = await handler(
      new Request("http://localhost/api/settings"),
      {} as never,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getSystemSettings).not.toHaveBeenCalled();
  });

  it("returns persisted settings to an authenticated administrator", async () => {
    const handler = createSettingsHandler({
      database: {} as never,
      authorization: authenticatedAuthorization(),
    });

    const response = await handler(
      new Request("http://localhost/api/settings"),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      success: true,
      data: SETTINGS,
    });
  });

  it("validates and persists a partial PATCH", async () => {
    const handler = createSettingsHandler({
      database: {} as never,
      authorization: authenticatedAuthorization(),
    });

    const response = await handler(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privacy: { store_raw_ip: false },
        }),
      }),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(updateSystemSettings).toHaveBeenCalledWith(
      { storeRawIp: false },
      {},
    );
  });

  it("returns 405 for unsupported methods", async () => {
    const handler = createSettingsHandler({
      database: {} as never,
      authorization: authenticatedAuthorization(),
    });

    const response = await handler(
      new Request("http://localhost/api/settings", { method: "POST" }),
      {} as never,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, PATCH");
  });

  it("rejects a PATCH request with a non-JSON content type", async () => {
    const handler = createSettingsHandler({
      database: {} as never,
      authorization: authenticatedAuthorization(),
    });

    const response = await handler(
      new Request("http://localhost/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
      {} as never,
    );

    expect(response.status).toBe(400);
    expect(updateSystemSettings).not.toHaveBeenCalled();
  });
});

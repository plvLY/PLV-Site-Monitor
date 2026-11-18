
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({ db: {} }));

vi.mock(
  "../../netlify/functions/_shared/settings/settings-service",
  () => ({ getSystemSettings: vi.fn() }),
);

vi.mock(
  "../../netlify/functions/_shared/event-retention",
  () => ({ cleanupExpiredEvents: vi.fn() }),
);

import { getSystemSettings } from "../../netlify/functions/_shared/settings/settings-service";
import { cleanupExpiredEvents } from "../../netlify/functions/_shared/event-retention";
import { createCleanupEventsHandler } from "../../netlify/functions/cleanup-events.mts";

const SETTINGS = {
  retention: {
    event_retention_days: 45,
    ip_retention_days: 30,
    user_agent_retention_days: 12,
  },
  rate_limit: {
    site_rate_limit_max_requests: 600,
  },
  privacy: {
    store_raw_ip: true,
  },
};

describe("cleanup-events scheduled handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getSystemSettings).mockResolvedValue(SETTINGS);

    vi.mocked(cleanupExpiredEvents).mockResolvedValue({
      cutoff: new Date("2026-09-28T12:00:00.000Z"),
      deletedCount: 4,
    });
  });

  it("读取配置中的原始事件保留期限后执行清理", async () => {
    const fixedNow = new Date("2026-11-12T12:00:00.000Z");
    const database = {} as never;

    const handler = createCleanupEventsHandler({
      database,
      now: () => fixedNow,
    });

    const response = await handler(
      new Request("http://localhost/.netlify/functions/cleanup-events"),
      {} as never,
    );

    expect(response.status).toBe(200);

    expect(getSystemSettings).toHaveBeenCalledOnce();

    expect(cleanupExpiredEvents).toHaveBeenCalledWith(
      database,
      45,
      fixedNow,
    );

    expect(await response.json()).toEqual({
      success: true,
      retention_days: 45,
      cutoff: "2026-09-28T12:00:00.000Z",
      deleted_count: 4,
    });
  });

  it("系统配置读取失败时不执行清理", async () => {
    vi.mocked(getSystemSettings).mockRejectedValue(
      new Error("Database unavailable"),
    );

    const handler = createCleanupEventsHandler({
      database: {} as never,
    });

    const response = await handler(
      new Request("http://localhost/.netlify/functions/cleanup-events"),
      {} as never,
    );

    expect(response.status).toBe(500);
    expect(cleanupExpiredEvents).not.toHaveBeenCalled();

    expect(await response.json()).toEqual({
      success: false,
      message: "Event retention cleanup failed.",
    });
  });

  it("清理服务异常时返回 HTTP 500", async () => {
    vi.mocked(cleanupExpiredEvents).mockRejectedValue(
      new Error("Database unavailable"),
    );

    const handler = createCleanupEventsHandler({
      database: {} as never,
    });

    const response = await handler(
      new Request("http://localhost/.netlify/functions/cleanup-events"),
      {} as never,
    );

    expect(response.status).toBe(500);
  });
});

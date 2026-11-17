
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({ db: {} }));

vi.mock(
  "../../netlify/functions/_shared/settings/settings-service",
  () => ({ getSystemSettings: vi.fn() }),
);

vi.mock(
  "../../netlify/functions/_shared/user-agent-retention",
  () => ({ cleanupExpiredUserAgents: vi.fn() }),
);

import { getSystemSettings } from "../../netlify/functions/_shared/settings/settings-service";
import { cleanupExpiredUserAgents } from "../../netlify/functions/_shared/user-agent-retention";
import { createCleanupUserAgentHandler } from "../../netlify/functions/cleanup-user-agent.mts";

const SETTINGS = {
  retention: {
    event_retention_days: 90,
    ip_retention_days: 30,
    user_agent_retention_days: 12,
  },
  privacy: {
    store_raw_ip: true,
  },
};

describe("cleanup-user-agent scheduled handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getSystemSettings).mockResolvedValue(SETTINGS);
    vi.mocked(cleanupExpiredUserAgents).mockResolvedValue(4);
  });

  it("读取配置中的 User-Agent 保留期限后执行清理", async () => {
    const fixedNow = new Date("2026-11-12T12:00:00.000Z");
    const database = {} as never;

    const handler = createCleanupUserAgentHandler({
      database,
      now: () => fixedNow,
    });

    const response = await handler(
      new Request("http://localhost/.netlify/functions/cleanup-user-agent"),
      {} as never,
    );

    expect(response.status).toBe(200);

    expect(getSystemSettings).toHaveBeenCalledOnce();

    expect(cleanupExpiredUserAgents).toHaveBeenCalledWith(
      database,
      12,
      fixedNow,
    );

    expect(await response.json()).toEqual({
      success: true,
      retention_days: 12,
      cleaned_count: 4,
    });
  });

  it("系统配置读取失败时不执行清理", async () => {
    vi.mocked(getSystemSettings).mockRejectedValue(
      new Error("Database unavailable"),
    );

    const handler = createCleanupUserAgentHandler({
      database: {} as never,
    });

    const response = await handler(
      new Request("http://localhost/.netlify/functions/cleanup-user-agent"),
      {} as never,
    );

    expect(response.status).toBe(500);
    expect(cleanupExpiredUserAgents).not.toHaveBeenCalled();

    expect(await response.json()).toEqual({
      success: false,
      message: "User-Agent retention cleanup failed.",
    });
  });

  it("清理服务异常时返回 HTTP 500", async () => {
    vi.mocked(cleanupExpiredUserAgents).mockRejectedValue(
      new Error("Database unavailable"),
    );

    const handler = createCleanupUserAgentHandler({
      database: {} as never,
    });

    const response = await handler(
      new Request("http://localhost/.netlify/functions/cleanup-user-agent"),
      {} as never,
    );

    expect(response.status).toBe(500);
  });
});

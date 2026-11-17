import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({ db: {} }));
vi.mock("../../netlify/functions/_shared/settings/settings-service", () => ({ getSystemSettings: vi.fn() }));
vi.mock("../../netlify/functions/_shared/ip-retention", () => ({ cleanupExpiredIpAddresses: vi.fn() }));

import { getSystemSettings } from "../../netlify/functions/_shared/settings/settings-service";
import { cleanupExpiredIpAddresses } from "../../netlify/functions/_shared/ip-retention";
import { createCleanupIpHandler } from "../../netlify/functions/cleanup-ip.mts";

const SETTINGS = {
  retention: { event_retention_days: 90, ip_retention_days: 12, user_agent_retention_days: 30 },
  privacy: { store_raw_ip: true },
};

describe("cleanup-ip scheduled handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSystemSettings).mockResolvedValue(SETTINGS);
    vi.mocked(cleanupExpiredIpAddresses).mockResolvedValue(4);
  });

  it("读取配置中的 IP 保留期限后执行清理", async () => {
    const fixedNow = new Date("2026-11-12T12:00:00.000Z");
    const database = {} as never;
    const handler = createCleanupIpHandler({ database, now: () => fixedNow });
    const response = await handler(new Request("http://localhost/.netlify/functions/cleanup-ip"), {} as never);

    expect(response.status).toBe(200);
    expect(getSystemSettings).toHaveBeenCalledOnce();
    expect(cleanupExpiredIpAddresses).toHaveBeenCalledWith(database, 12, fixedNow);
    expect(await response.json()).toEqual({ success: true, retention_days: 12, cleaned_count: 4 });
  });

  it("系统配置读取失败时不执行清理", async () => {
    vi.mocked(getSystemSettings).mockRejectedValue(new Error("Database unavailable"));
    const handler = createCleanupIpHandler({ database: {} as never });
    const response = await handler(new Request("http://localhost/.netlify/functions/cleanup-ip"), {} as never);

    expect(response.status).toBe(500);
    expect(cleanupExpiredIpAddresses).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ success: false, message: "IP retention cleanup failed." });
  });
});

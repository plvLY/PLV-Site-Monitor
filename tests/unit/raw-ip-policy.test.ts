
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../netlify/functions/_shared/settings/settings-service", () => ({
  getSystemSettings: vi.fn(),
}));

import { getSystemSettings } from "../../netlify/functions/_shared/settings/settings-service";
import { isRawIpStorageEnabled } from "../../netlify/functions/_shared/settings/raw-ip-policy";

const mockedGetSystemSettings = vi.mocked(getSystemSettings);

describe("isRawIpStorageEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("设置开启时允许保存原始 IP", async () => {
    mockedGetSystemSettings.mockResolvedValue({
      retention: {
        event_retention_days: 90,
        ip_retention_days: 30,
        user_agent_retention_days: 30,
      },
      privacy: {
        store_raw_ip: true,
      },
    });

    await expect(isRawIpStorageEnabled()).resolves.toBe(true);
  });

  it("设置关闭时禁止保存原始 IP", async () => {
    mockedGetSystemSettings.mockResolvedValue({
      retention: {
        event_retention_days: 90,
        ip_retention_days: 30,
        user_agent_retention_days: 30,
      },
      privacy: {
        store_raw_ip: false,
      },
    });

    await expect(isRawIpStorageEnabled()).resolves.toBe(false);
  });

  it("设置读取失败时默认禁止保存原始 IP", async () => {
    const error = new Error("Database unavailable");

    mockedGetSystemSettings.mockRejectedValue(error);

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(isRawIpStorageEnabled()).resolves.toBe(false);

    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

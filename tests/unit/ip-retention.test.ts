import { describe, expect, it } from "vitest";
import { getIpRetentionCutoff, MAX_IP_RETENTION_DAYS } from "../../netlify/functions/_shared/ip-retention";

describe("IP retention policy", () => {
  const now = new Date("2026-11-07T12:00:00.000Z");

  it("IP 保留期限硬上限为 30 天", () => {
    expect(MAX_IP_RETENTION_DAYS).toBe(30);
  });
  it("正确计算 30 天前的截止时间", () => {
    expect(getIpRetentionCutoff(now, 30).toISOString()).toBe("2026-10-08T12:00:00.000Z");
  });
  it("支持从系统设置传入自定义保留天数", () => {
    expect(getIpRetentionCutoff(now, 7).toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });
  it("支持最短 1 天保留期限", () => {
    expect(getIpRetentionCutoff(now, 1).toISOString()).toBe("2026-11-06T12:00:00.000Z");
  });
  it("拒绝超过系统上限的保留期限", () => {
    expect(() => getIpRetentionCutoff(now, 31)).toThrow("retentionDays must be an integer between 1 and 30.");
  });
  it("拒绝非法日期", () => {
    expect(() => getIpRetentionCutoff(new Date("invalid"), 30)).toThrow("Invalid current date.");
  });
  it("拒绝零天或负数保留期限", () => {
    expect(() => getIpRetentionCutoff(now, 0)).toThrow();
    expect(() => getIpRetentionCutoff(now, -1)).toThrow();
  });
  it("拒绝非整数保留期限", () => {
    expect(() => getIpRetentionCutoff(now, 1.5)).toThrow();
  });
});


import { describe, expect, it, vi } from "vitest";
import {
  cleanupExpiredUserAgents,
  getUserAgentRetentionCutoff,
  MAX_USER_AGENT_RETENTION_DAYS,
} from "../../netlify/functions/_shared/user-agent-retention";

describe("User-Agent retention policy", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");

  it("User-Agent 保留期限硬上限为 30 天", () => {
    expect(MAX_USER_AGENT_RETENTION_DAYS).toBe(30);
  });

  it("正确计算 30 天前的截止时间", () => {
    expect(
      getUserAgentRetentionCutoff(now, 30).toISOString(),
    ).toBe("2026-10-13T12:00:00.000Z");
  });

  it("支持自定义保留期限", () => {
    expect(
      getUserAgentRetentionCutoff(now, 7).toISOString(),
    ).toBe("2026-11-05T12:00:00.000Z");
  });

  it("支持最短 1 天保留期限", () => {
    expect(
      getUserAgentRetentionCutoff(now, 1).toISOString(),
    ).toBe("2026-11-11T12:00:00.000Z");
  });

  it("拒绝超过 30 天的保留期限", () => {
    expect(() => getUserAgentRetentionCutoff(now, 31))
      .toThrow(
        "retentionDays must be an integer between 1 and 30.",
      );
  });

  it("拒绝零天和负数", () => {
    expect(() => getUserAgentRetentionCutoff(now, 0)).toThrow();
    expect(() => getUserAgentRetentionCutoff(now, -1)).toThrow();
  });

  it("拒绝非整数", () => {
    expect(() => getUserAgentRetentionCutoff(now, 1.5)).toThrow();
  });

  it("拒绝非法日期", () => {
    expect(() =>
      getUserAgentRetentionCutoff(new Date("invalid"), 30),
    ).toThrow("Invalid current date.");
  });

  it("仅执行 User-Agent 清理并返回清理数量", async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];

    const returning = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });

    const database = { update } as never;

    const result = await cleanupExpiredUserAgents(
      database,
      30,
      now,
    );

    expect(result).toBe(3);
    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ userAgent: null });
    expect(where).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
  });

  it("数据库异常时向上抛出错误", async () => {
    const update = vi.fn().mockImplementation(() => {
      throw new Error("Database unavailable");
    });

    const database = { update } as never;

    await expect(
      cleanupExpiredUserAgents(database, 30, now),
    ).rejects.toThrow("Database unavailable");
  });
});


import { describe, expect, it } from "vitest";
import type { Context } from "@netlify/functions";
import { resolveVisitorMetadata } from "../../netlify/functions/_shared/visitor-metadata";

function createContext(
  overrides: Record<string, unknown> = {},
): Context {
  return {
    ip: "203.0.113.10",
    geo: {
      country: { code: "US" },
      subdivision: { name: "California" },
      city: "San Jose",
    },
    ...overrides,
  } as Context;
}

describe("resolveVisitorMetadata", () => {
  describe("IP 解析", () => {
    it("读取合法 IPv4 地址", () => {
      const result = resolveVisitorMetadata(
        new Request("https://example.com"),
        createContext(),
      );

      expect(result.ipAddress).toBe("203.0.113.10");
    });

    it("读取合法 IPv6 地址", () => {
      const result = resolveVisitorMetadata(
        new Request("https://example.com"),
        createContext({ ip: "2001:db8::1" }),
      );

      expect(result.ipAddress).toBe("2001:db8::1");
    });

    it("非法 IP 返回 null", () => {
      const result = resolveVisitorMetadata(
        new Request("https://example.com"),
        createContext({ ip: "invalid-ip" }),
      );

      expect(result.ipAddress).toBeNull();
    });

    it("缺少 IP 返回 null", () => {
      const result = resolveVisitorMetadata(
        new Request("https://example.com"),
        createContext({ ip: undefined }),
      );

      expect(result.ipAddress).toBeNull();
    });
  });

  describe("Geo 解析", () => {
    it("正确读取国家、地区和城市", () => {
      const result = resolveVisitorMetadata(
        new Request("https://example.com"),
        createContext(),
      );

      expect(result.countryCode).toBe("US");
      expect(result.region).toBe("California");
      expect(result.city).toBe("San Jose");
    });

    it("缺少 Geo 信息时返回 null", () => {
      const result = resolveVisitorMetadata(
        new Request("https://example.com"),
        createContext({ geo: undefined }),
      );

      expect(result.countryCode).toBeNull();
      expect(result.region).toBeNull();
      expect(result.city).toBeNull();
    });
  });

  describe("User-Agent 解析", () => {
    it("没有 User-Agent 时返回 unknown", () => {
      const result = resolveVisitorMetadata(
        new Request("https://example.com"),
        createContext(),
      );

      expect(result.userAgent).toBeNull();
      expect(result.deviceType).toBe("unknown");
      expect(result.browser).toBeNull();
      expect(result.os).toBeNull();
    });

    it("正确识别 Windows Chrome 桌面设备", () => {
      const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Safari/537.36";

      const result = resolveVisitorMetadata(
        new Request("https://example.com", {
          headers: { "user-agent": userAgent },
        }),
        createContext(),
      );

      expect(result.deviceType).toBe("desktop");
      expect(result.browser).toBe("Chrome");
      expect(result.os).toBe("Windows");
    });

    it("正确识别 iPhone Safari 移动设备", () => {
      const userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
        "Version/17.0 Mobile/15E148 Safari/604.1";

      const result = resolveVisitorMetadata(
        new Request("https://example.com", {
          headers: { "user-agent": userAgent },
        }),
        createContext(),
      );

      expect(result.deviceType).toBe("mobile");
      expect(result.browser).toBe("Safari");
      expect(result.os).toBe("iOS");
    });

    it("User-Agent 最长保留 1000 个字符", () => {
      const userAgent = "A".repeat(1200);

      const result = resolveVisitorMetadata(
        new Request("https://example.com", {
          headers: { "user-agent": userAgent },
        }),
        createContext(),
      );

      expect(result.userAgent).toHaveLength(1000);
    });
  });
});

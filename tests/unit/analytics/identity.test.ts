
import { describe, expect, it } from "vitest";
import {
  createAnalyticsIdentity,
  getAnalyticsIdentityConfig,
} from "../../../netlify/functions/_shared/analytics/identity";

const TEST_SECRET = "a".repeat(64);

describe("Analytics Identity", () => {
  describe("getAnalyticsIdentityConfig", () => {
    it("应正确读取密钥和版本", () => {
      const config = getAnalyticsIdentityConfig({
        PLV_ANALYTICS_HMAC_SECRET: TEST_SECRET,
        PLV_ANALYTICS_HMAC_KEY_VERSION: "1",
      });

      expect(config).toEqual({
        secret: TEST_SECRET,
        keyVersion: 1,
      });
    });

    it("密钥缺失时应报错", () => {
      expect(() =>
        getAnalyticsIdentityConfig({
          PLV_ANALYTICS_HMAC_KEY_VERSION: "1",
        }),
      ).toThrow("PLV_ANALYTICS_HMAC_SECRET");
    });

    it("密钥格式错误时应报错", () => {
      expect(() =>
        getAnalyticsIdentityConfig({
          PLV_ANALYTICS_HMAC_SECRET: "invalid-secret",
          PLV_ANALYTICS_HMAC_KEY_VERSION: "1",
        }),
      ).toThrow("PLV_ANALYTICS_HMAC_SECRET");
    });

    it("密钥版本缺失时应报错", () => {
      expect(() =>
        getAnalyticsIdentityConfig({
          PLV_ANALYTICS_HMAC_SECRET: TEST_SECRET,
        }),
      ).toThrow("PLV_ANALYTICS_HMAC_KEY_VERSION");
    });

    it.each(["0", "-1", "1.5", "abc", ""])(
      "密钥版本 %s 无效时应报错",
      (version) => {
        expect(() =>
          getAnalyticsIdentityConfig({
            PLV_ANALYTICS_HMAC_SECRET: TEST_SECRET,
            PLV_ANALYTICS_HMAC_KEY_VERSION: version,
          }),
        ).toThrow("PLV_ANALYTICS_HMAC_KEY_VERSION");
      },
    );
  });

  describe("createAnalyticsIdentity", () => {
    const identity = createAnalyticsIdentity({
      secret: TEST_SECRET,
      keyVersion: 1,
    });

    it("相同 Visitor 输入应生成稳定的 Key", () => {
      const first = identity.createVisitorKey(
        "site-001",
        "visitor-001",
      );
      const second = identity.createVisitorKey(
        "site-001",
        "visitor-001",
      );

      expect(first).toEqual(second);
      expect(first.key).toMatch(/^[0-9a-f]{64}$/);
      expect(first.keyVersion).toBe(1);
    });

    it("不同 Visitor 应生成不同的 Key", () => {
      const first = identity.createVisitorKey(
        "site-001",
        "visitor-001",
      );
      const second = identity.createVisitorKey(
        "site-001",
        "visitor-002",
      );

      expect(first.key).not.toBe(second.key);
    });

    it("不同 Site 的 Visitor 应生成不同的 Key", () => {
      const first = identity.createVisitorKey(
        "site-001",
        "visitor-001",
      );
      const second = identity.createVisitorKey(
        "site-002",
        "visitor-001",
      );

      expect(first.key).not.toBe(second.key);
    });

    it("Visitor Key 和 Session Key 应相互隔离", () => {
      const visitor = identity.createVisitorKey(
        "site-001",
        "identity-001",
      );
      const session = identity.createSessionKey(
        "site-001",
        "identity-001",
      );

      expect(visitor.key).not.toBe(session.key);
    });

    it("相同 Session 输入应生成稳定的 Key", () => {
      const first = identity.createSessionKey(
        "site-001",
        "analytics-session-001",
      );
      const second = identity.createSessionKey(
        "site-001",
        "analytics-session-001",
      );

      expect(first).toEqual(second);
      expect(first.key).toMatch(/^[0-9a-f]{64}$/);
      expect(first.keyVersion).toBe(1);
    });

    it("不同 Session 应生成不同的 Key", () => {
      const first = identity.createSessionKey(
        "site-001",
        "analytics-session-001",
      );
      const second = identity.createSessionKey(
        "site-001",
        "analytics-session-002",
      );

      expect(first.key).not.toBe(second.key);
    });

    it("不同 Site 的 Session 应生成不同的 Key", () => {
      const first = identity.createSessionKey(
        "site-001",
        "analytics-session-001",
      );
      const second = identity.createSessionKey(
        "site-002",
        "analytics-session-001",
      );

      expect(first.key).not.toBe(second.key);
    });

    it("Site ID 为空时应报错", () => {
      expect(() =>
        identity.createVisitorKey("", "visitor-001"),
      ).toThrow("siteId must not be empty");
    });

    it("Visitor ID 为空时应报错", () => {
      expect(() =>
        identity.createVisitorKey("site-001", " "),
      ).toThrow("identity must not be empty");
    });

    it("Session Identity 为空时应报错", () => {
      expect(() =>
        identity.createSessionKey("site-001", ""),
      ).toThrow("identity must not be empty");
    });

    it("密钥格式错误时应拒绝创建 Identity", () => {
      expect(() =>
        createAnalyticsIdentity({
          secret: "invalid",
          keyVersion: 1,
        }),
      ).toThrow("Analytics HMAC secret");
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      "密钥版本 %s 无效时应拒绝创建 Identity",
      (keyVersion) => {
        expect(() =>
          createAnalyticsIdentity({
            secret: TEST_SECRET,
            keyVersion,
          }),
        ).toThrow("Analytics HMAC key version");
      },
    );
  });
});

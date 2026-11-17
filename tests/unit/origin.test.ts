
import { afterEach, describe, expect, it } from "vitest";
import { parseOrigin } from "../../netlify/functions/_shared/origin";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("parseOrigin", () => {
  describe("基础校验", () => {
    it.each([null, "", "null"])(
      "拒绝无效 Origin：%s",
      (origin) => {
        expect(parseOrigin(origin)).toBeNull();
      },
    );

    it("接受合法 HTTPS Origin", () => {
      process.env.NODE_ENV = "production";

      expect(parseOrigin("https://example.com")).toEqual({
        origin: "https://example.com",
        hostname: "example.com",
      });
    });

    it("统一 hostname 大小写", () => {
      process.env.NODE_ENV = "production";

      expect(parseOrigin("https://EXAMPLE.COM")).toEqual({
        origin: "https://example.com",
        hostname: "example.com",
      });
    });
  });

  describe("协议校验", () => {
    it("拒绝非 HTTP/HTTPS 协议", () => {
      expect(parseOrigin("ftp://example.com")).toBeNull();
    });
  });

  describe("非法 Origin", () => {
    it.each([
      "https://user:password@example.com",
      "https://example.com/path",
      "https://example.com?token=123",
      "https://example.com#section",
    ])("拒绝非法 Origin：%s", (origin) => {
      expect(parseOrigin(origin)).toBeNull();
    });
  });

  describe("端口校验", () => {
    it("生产环境拒绝非标准端口", () => {
      process.env.NODE_ENV = "production";

      expect(parseOrigin("https://example.com:8443")).toBeNull();
    });

    it("开发环境允许 localhost 自定义端口", () => {
      process.env.NODE_ENV = "development";

      expect(parseOrigin("http://localhost:5173")).toEqual({
        origin: "http://localhost:5173",
        hostname: "localhost",
      });
    });

    it("开发环境拒绝普通域名自定义端口", () => {
      process.env.NODE_ENV = "development";

      expect(parseOrigin("https://example.com:8443")).toBeNull();
    });

    it("生产环境允许标准 HTTPS 端口", () => {
      process.env.NODE_ENV = "production";

      expect(parseOrigin("https://example.com:443")).toEqual({
        origin: "https://example.com",
        hostname: "example.com",
      });
    });

    it("开发环境允许 localhost 子域名使用自定义端口", () => {
      process.env.NODE_ENV = "development";

      expect(parseOrigin("http://site-b.localhost:5173")).toEqual({
        origin: "http://site-b.localhost:5173",
        hostname: "site-b.localhost",
      });
    });

    it("生产环境拒绝 localhost 子域名使用自定义端口", () => {
      process.env.NODE_ENV = "production";

      expect(parseOrigin("http://site-b.localhost:5173")).toBeNull();
    });
  });
});

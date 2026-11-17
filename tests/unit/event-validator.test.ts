
import { describe, expect, it } from "vitest";
import {
  EventValidationError,
  validateCollectEvent,
} from "../../netlify/functions/_shared/event-validator";

const SITE_ID = "accb07ee-6504-4855-b25b-4a5bf22d8164";
const EVENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VISITOR_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const HOSTNAME = "example.com";

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    site_id: SITE_ID,
    event_id: EVENT_ID,
    event_type: "page_view",
    visitor_id: VISITOR_ID,
    session_id: SESSION_ID,
    page_url: "https://example.com/products",
    page_path: "/fake-path",
    page_title: "Products",
    referrer: "https://google.com/",
    occurred_at: "2026-11-05T10:00:00.000Z",
    utm_source: "google",
    utm_medium: "organic",
    utm_campaign: "campaign-01",
    utm_term: "coffee",
    utm_content: "banner",
    ...overrides,
  };
}

function expectValidationError(
  payload: Record<string, unknown>,
  expectedCode: string,
) {
  try {
    validateCollectEvent(payload, SITE_ID, HOSTNAME);
    throw new Error("Expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(EventValidationError);
    expect((error as EventValidationError).code).toBe(expectedCode);
  }
}

describe("validateCollectEvent", () => {
  describe("正常数据", () => {
    it("接受合法 page_view 事件", () => {
      const result = validateCollectEvent(
        createPayload(),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.event_type).toBe("page_view");
      expect(result.site_id).toBe(SITE_ID);
      expect(result.event_id).toBe(EVENT_ID);
      expect(result.page_url).toBe("https://example.com/products");
      expect(result.page_path).toBe("/products");
      expect(result.page_title).toBe("Products");
      expect(result.referrer_host).toBe("google.com");
      expect(result.utm_source).toBe("google");
      expect(result.occurred_at).toBeInstanceOf(Date);
    });

    it("UUID 统一转换为小写", () => {
      const result = validateCollectEvent(
        createPayload({
          event_id: EVENT_ID.toUpperCase(),
        }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.event_id).toBe(EVENT_ID);
    });

    it("忽略客户端传入的 page_path", () => {
      const result = validateCollectEvent(
        createPayload({ page_path: "/client-fake-path" }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.page_path).toBe("/products");
    });
  });

  describe("UUID 校验", () => {
    it.each([
      ["site_id", "INVALID_SITE_ID"],
      ["event_id", "INVALID_EVENT_ID"],
      ["visitor_id", "INVALID_VISITOR_ID"],
      ["session_id", "INVALID_SESSION_ID"],
    ])("拒绝非法 %s", (field, code) => {
      expectValidationError(
        createPayload({ [field]: "invalid-uuid" }),
        code,
      );
    });

    it("拒绝站点 ID 不匹配", () => {
      expectValidationError(
        createPayload({
          site_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
        "SITE_ID_MISMATCH",
      );
    });
  });

  describe("事件类型", () => {
    it("拒绝不支持的事件类型", () => {
      expectValidationError(
        createPayload({ event_type: "click" }),
        "UNSUPPORTED_EVENT_TYPE",
      );
    });
  });

  describe("页面 URL", () => {
    it("删除敏感查询参数", () => {
      const result = validateCollectEvent(
        createPayload({
          page_url:
            "https://example.com/products?utm_source=google&token=abc&password=123&access_token=xyz&refresh_token=456&code=789&email=test@example.com&phone=123456",
        }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.page_url).toContain("utm_source=google");

      for (const key of [
        "token",
        "password",
        "access_token",
        "refresh_token",
        "code",
        "email",
        "phone",
      ]) {
        expect(result.page_url.toLowerCase()).not.toContain(`${key}=`);
      }
    });

    it("删除 URL Fragment", () => {
      const result = validateCollectEvent(
        createPayload({
          page_url: "https://example.com/products#section-1",
        }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.page_url).toBe("https://example.com/products");
    });

    it("拒绝非 HTTP/HTTPS URL", () => {
      expectValidationError(
        createPayload({ page_url: "ftp://example.com/file" }),
        "INVALID_PAGE_URL",
      );
    });

    it("拒绝包含用户名密码的 URL", () => {
      expectValidationError(
        createPayload({
          page_url: "https://user:password@example.com/products",
        }),
        "INVALID_PAGE_URL",
      );
    });

    it("拒绝页面 URL 域名不匹配", () => {
      expectValidationError(
        createPayload({
          page_url: "https://other.com/products",
        }),
        "PAGE_URL_DOMAIN_MISMATCH",
      );
    });

    it("拒绝超过 4096 字符的 URL", () => {
      expectValidationError(
        createPayload({
          page_url: "https://example.com/" + "a".repeat(4100),
        }),
        "INVALID_PAGE_URL",
      );
    });
  });

  describe("Referrer", () => {
    it("清理 Referrer 敏感参数", () => {
      const result = validateCollectEvent(
        createPayload({
          referrer: "https://google.com/?email=test@example.com&source=search",
        }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.referrer).toContain("source=search");
      expect(result.referrer).not.toContain("email=");
      expect(result.referrer_host).toBe("google.com");
    });

    it("允许 Referrer 为空", () => {
      const result = validateCollectEvent(
        createPayload({ referrer: null }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.referrer).toBeNull();
      expect(result.referrer_host).toBeNull();
    });

    it("拒绝非法 Referrer URL", () => {
      expectValidationError(
        createPayload({ referrer: "not-a-url" }),
        "INVALID_REFERRER",
      );
    });
  });

  describe("时间校验", () => {
    it.each([undefined, null, "", "invalid-date"])(
      "拒绝非法 occurred_at：%s",
      (value) => {
        expectValidationError(
          createPayload({ occurred_at: value }),
          "INVALID_OCCURRED_AT",
        );
      },
    );
  });

  describe("UTM 校验", () => {
    it("正确保留全部 UTM 字段", () => {
      const result = validateCollectEvent(
        createPayload(),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.utm_source).toBe("google");
      expect(result.utm_medium).toBe("organic");
      expect(result.utm_campaign).toBe("campaign-01");
      expect(result.utm_term).toBe("coffee");
      expect(result.utm_content).toBe("banner");
    });

    it("UTM 字段超过 255 字符时拒绝", () => {
      expectValidationError(
        createPayload({
          utm_source: "a".repeat(256),
        }),
        "INVALID_UTM_SOURCE",
      );
    });

    it("UTM 字段移除控制字符并去除首尾空格", () => {
      const result = validateCollectEvent(
        createPayload({
          utm_source: "  goo\u0000gle  ",
        }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.utm_source).toBe("google");
    });
  });

  describe("文本字段校验", () => {
    it("page_title 超过 500 字符时拒绝", () => {
      expectValidationError(
        createPayload({
          page_title: "a".repeat(501),
        }),
        "INVALID_PAGE_TITLE",
      );
    });

    it("page_title 为 null 时允许通过", () => {
      const result = validateCollectEvent(
        createPayload({ page_title: null }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.page_title).toBeNull();
    });

    it("page_title 移除控制字符并去除首尾空格", () => {
      const result = validateCollectEvent(
        createPayload({
          page_title: "  Product\u0000 Page  ",
        }),
        SITE_ID,
        HOSTNAME,
      );

      expect(result.page_title).toBe("Product Page");
    });
  });
});

describe("SEC-01：URL 敏感参数隐私测试", () => {
  it("SEC-01-01：敏感参数名称大小写不敏感", () => {
    const result = validateCollectEvent(
      createPayload({
        page_url:
          "https://example.com/products?TOKEN=abc&PASSWORD=123&Email=test@example.com&utm_source=google",
      }),
      SITE_ID,
      HOSTNAME,
    );

    const url = new URL(result.page_url);

    expect(url.searchParams.has("TOKEN")).toBe(false);
    expect(url.searchParams.has("PASSWORD")).toBe(false);
    expect(url.searchParams.has("Email")).toBe(false);
    expect(url.searchParams.get("utm_source")).toBe("google");
  });

  it("SEC-01-02：重复敏感参数应全部删除", () => {
    const result = validateCollectEvent(
      createPayload({
        page_url:
          "https://example.com/products?token=abc&token=def&email=a@test.com&email=b@test.com",
      }),
      SITE_ID,
      HOSTNAME,
    );

    const url = new URL(result.page_url);

    expect(url.searchParams.getAll("token")).toHaveLength(0);
    expect(url.searchParams.getAll("email")).toHaveLength(0);
  });

  it("SEC-01-03：URL 编码的敏感参数名称应删除", () => {
    const result = validateCollectEvent(
      createPayload({
        page_url:
          "https://example.com/products?%74oken=abc&%65mail=test@example.com&source=google",
      }),
      SITE_ID,
      HOSTNAME,
    );

    const url = new URL(result.page_url);

    expect(url.searchParams.has("token")).toBe(false);
    expect(url.searchParams.has("email")).toBe(false);
    expect(url.searchParams.get("source")).toBe("google");
  });

  it("SEC-01-04：普通查询参数应保留", () => {
    const result = validateCollectEvent(
      createPayload({
        page_url:
          "https://example.com/products?id=100&category=coffee&page=2",
      }),
      SITE_ID,
      HOSTNAME,
    );

    const url = new URL(result.page_url);

    expect(url.searchParams.get("id")).toBe("100");
    expect(url.searchParams.get("category")).toBe("coffee");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("SEC-01-05：所有已定义的敏感参数均应删除", () => {
    const sensitiveKeys = [
      "token",
      "password",
      "access_token",
      "refresh_token",
      "code",
      "email",
      "phone",
    ];

    const query = sensitiveKeys
      .map((key) => `${key}=sensitive-value`)
      .join("&");

    const result = validateCollectEvent(
      createPayload({
        page_url: `https://example.com/products?${query}`,
      }),
      SITE_ID,
      HOSTNAME,
    );

    const url = new URL(result.page_url);

    for (const key of sensitiveKeys) {
      expect(url.searchParams.has(key)).toBe(false);
    }
  });
});

describe("SEC-02：URL Fragment 隐私测试", () => {
  it("SEC-02-01：Fragment 中包含敏感信息时应全部删除", () => {
    const result = validateCollectEvent(
      createPayload({
        page_url:
          "https://example.com/products?id=100#access_token=abc123&email=test@example.com",
      }),
      SITE_ID,
      HOSTNAME,
    );

    const url = new URL(result.page_url);

    expect(url.hash).toBe("");
    expect(result.page_url).not.toContain("access_token");
    expect(result.page_url).not.toContain("email");
    expect(url.searchParams.get("id")).toBe("100");
  });

  it("SEC-02-02：Fragment 不应影响 page_path", () => {
    const result = validateCollectEvent(
      createPayload({
        page_url:
          "https://example.com/products/detail#section-2",
      }),
      SITE_ID,
      HOSTNAME,
    );

    expect(result.page_path).toBe("/products/detail");
    expect(result.page_url).not.toContain("#");
  });
});

describe("SEC-03：UTM 隐私与字段边界测试", () => {
  it("SEC-03-01：UTM 非字符串类型应拒绝", () => {
    expectValidationError(
      createPayload({
        utm_source: 123,
      }),
      "INVALID_UTM_SOURCE",
    );
  });

  it("SEC-03-02：UTM null 和 undefined 应允许", () => {
    const result = validateCollectEvent(
      createPayload({
        utm_source: null,
        utm_medium: undefined,
      }),
      SITE_ID,
      HOSTNAME,
    );

    expect(result.utm_source).toBeNull();
    expect(result.utm_medium).toBeNull();
  });

  it("SEC-03-03：UTM 正好 255 个字符应允许", () => {
    const value = "a".repeat(255);

    const result = validateCollectEvent(
      createPayload({
        utm_source: value,
      }),
      SITE_ID,
      HOSTNAME,
    );

    expect(result.utm_source).toBe(value);
  });

  it("SEC-03-04：Referrer 同时清理敏感参数和 Fragment", () => {
    const result = validateCollectEvent(
      createPayload({
        referrer:
          "https://google.com/search?email=test@example.com&source=google#token=abc",
      }),
      SITE_ID,
      HOSTNAME,
    );

    const url = new URL(result.referrer!);

    expect(url.searchParams.has("email")).toBe(false);
    expect(url.searchParams.get("source")).toBe("google");
    expect(url.hash).toBe("");
    expect(result.referrer_host).toBe("google.com");
  });
});

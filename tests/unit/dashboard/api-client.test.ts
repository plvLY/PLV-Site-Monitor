import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ApiClient,
  ApiClientError,
} from "../../../dashboard/src/services/api/client";

import { ApiError } from "../../../dashboard/src/types/api";

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function successBody(
  data: unknown = { pv: 10 },
  meta: unknown = { site_id: "test-site" },
) {
  return {
    success: true,
    data,
    meta,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ApiClient", () => {
  describe("正常请求", () => {
    it("发送 GET 请求并解析成功响应", async () => {
      const body = successBody(
        { pv: 100, uv: 50 },
        { range: "7d" },
      );

      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(body));

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      const result = await client.get<
        { pv: number; uv: number },
        { range: string }
      >("/api/analytics/overview");

      expect(result).toEqual(body);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];

      expect(url).toBe("/api/analytics/overview");
      expect(options?.method).toBe("GET");
      expect(options?.headers).toEqual({
        Accept: "application/json",
      });
      expect(options?.credentials).toBe("same-origin");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    });

    it("正确拼接 Base URL 和请求路径", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(successBody()));

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient({
        baseUrl: "https://api.example.com///",
      });

      await client.get("/api/analytics/overview");

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/analytics/overview",
      );
    });
  });

  describe("查询参数", () => {
    it("正确序列化字符串、数字和布尔值", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(successBody()));

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      await client.get("/api/analytics/pages", {
        site_id: "site-001",
        page: 2,
        page_size: 20,
        enabled: false,
        keyword: "coffee & tea",
      });

      const url = new URL(
        String(fetchMock.mock.calls[0][0]),
        "http://localhost",
      );

      expect(url.searchParams.get("site_id")).toBe("site-001");
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("page_size")).toBe("20");
      expect(url.searchParams.get("enabled")).toBe("false");
      expect(url.searchParams.get("keyword")).toBe("coffee & tea");
    });

    it("过滤 null 和 undefined，但保留空字符串与零", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(successBody()));

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      await client.get("/api/analytics/pages", {
        empty: "",
        zero: 0,
        nullValue: null,
        undefinedValue: undefined,
      });

      const url = new URL(
        String(fetchMock.mock.calls[0][0]),
        "http://localhost",
      );

      expect(url.searchParams.has("empty")).toBe(true);
      expect(url.searchParams.get("empty")).toBe("");
      expect(url.searchParams.get("zero")).toBe("0");
      expect(url.searchParams.has("nullValue")).toBe(false);
      expect(url.searchParams.has("undefinedValue")).toBe(false);
    });
  });

  describe("后端错误处理", () => {
    it("解析 HTTP 错误及后端错误信息", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(
            {
              success: false,
              error: {
                code: "SITE_ACCESS_DENIED",
                message: "Access denied.",
              },
            },
            403,
          ),
        );

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      await expect(
        client.get("/api/analytics/overview"),
      ).rejects.toMatchObject({
        name: "ApiError",
        code: "SITE_ACCESS_DENIED",
        message: "Access denied.",
        status: 403,
      });
    });

    it("未知错误码回退为 INTERNAL_ERROR", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(
            {
              success: false,
              error: {
                code: "UNKNOWN_ERROR",
                message: "Unknown failure.",
              },
            },
            500,
          ),
        );

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      try {
        await client.get("/api/analytics/overview");
        throw new Error("Expected request to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("INTERNAL_ERROR");
        expect((error as ApiError).status).toBe(500);
      }
    });

    it("HTTP 错误响应格式不正确时使用默认错误信息", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ message: "failure" }, 500),
        );

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      await expect(
        client.get("/api/analytics/overview"),
      ).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
        message: "Request failed with HTTP 500.",
        status: 500,
      });
    });
  });

  describe("响应格式校验", () => {
    it("非法 JSON 返回 INVALID_RESPONSE", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(
          new Response("{invalid-json", {
            status: 200,
          }),
        );

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      await expect(
        client.get("/api/analytics/overview"),
      ).rejects.toMatchObject({
        name: "ApiClientError",
        kind: "INVALID_RESPONSE",
        message: "Server returned invalid JSON.",
      });
    });

    it("缺少 data 或 meta 时拒绝响应", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({
            success: true,
            data: { pv: 10 },
          }),
        );

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      await expect(
        client.get("/api/analytics/overview"),
      ).rejects.toMatchObject({
        name: "ApiClientError",
        kind: "INVALID_RESPONSE",
        message: "Server returned an invalid API response.",
      });
    });

    it("空响应体返回 INVALID_RESPONSE", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(
          new Response("", { status: 200 }),
        );

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      await expect(
        client.get("/api/analytics/overview"),
      ).rejects.toMatchObject({
        kind: "INVALID_RESPONSE",
      });
    });
  });

  describe("网络异常", () => {
    it("网络请求失败返回 NETWORK_ERROR", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockRejectedValue(new TypeError("Network unavailable."));

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();

      await expect(
        client.get("/api/analytics/overview"),
      ).rejects.toMatchObject({
        name: "ApiClientError",
        kind: "NETWORK_ERROR",
        message: "Network unavailable.",
      });
    });
  });

  describe("超时与取消", () => {
    
it("超过请求超时时间返回 TIMEOUT", async () => {
  vi.useFakeTimers();

  const fetchMock = vi.fn<typeof fetch>()
    .mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(
                new DOMException("Aborted", "AbortError"),
              );
            },
            { once: true },
          );
        }),
    );

  vi.stubGlobal("fetch", fetchMock);

  const client = new ApiClient({ timeout: 50 });

  const request = client.get("/api/analytics/overview");

  // 先注册 rejection 处理，再推进虚拟时间
  const assertion = expect(request).rejects.toMatchObject({
    name: "ApiClientError",
    kind: "TIMEOUT",
    message: "Request timed out after 50ms.",
  });

  await vi.advanceTimersByTimeAsync(50);

  await assertion;
});


    it("主动取消请求返回 ABORTED", async () => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockImplementation(
          (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  reject(
                    new DOMException("Aborted", "AbortError"),
                  );
                },
                { once: true },
              );
            }),
        );

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();
      const controller = new AbortController();

      const request = client.get(
        "/api/analytics/overview",
        undefined,
        { signal: controller.signal },
      );

      controller.abort();

      await expect(request).rejects.toMatchObject({
        name: "ApiClientError",
        kind: "ABORTED",
        message: "Request was cancelled.",
      });
    });

    it("请求发出前已经取消时不调用 fetch", async () => {
      const fetchMock = vi.fn<typeof fetch>();

      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient();
      const controller = new AbortController();

      controller.abort();

      await expect(
        client.get(
          "/api/analytics/overview",
          undefined,
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({
        kind: "ABORTED",
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

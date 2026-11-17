import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { PageViewEvent } from "../../src/events/types";
import type { IdentityManager } from "../../src/types";

const mocks = vi.hoisted(() => ({
  startAutoPageTracking: vi.fn(),
  createIdentityManager: vi.fn(),
}));

vi.mock("../../src/events/auto-page-tracking", () => ({
  startAutoPageTracking: mocks.startAutoPageTracking,
}));

vi.mock("../../src/identity", () => ({
  createIdentityManager: mocks.createIdentityManager,
}));

import { Tracker } from "../../src/core/tracker";

const ENDPOINT = "https://example.com/api/collect";

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mockIdentityManager: IdentityManager = {
  getIdentity: () => ({
    visitorId: "22222222-2222-4222-8222-222222222222",
    sessionId: "33333333-3333-4333-8333-333333333333",
  }),

  getVisitorId: () =>
    "22222222-2222-4222-8222-222222222222",

  getSessionId: () =>
    "33333333-3333-4333-8333-333333333333",
};

const mockEvent: PageViewEvent = {
  event_id: "accb07ee-6504-4855-b25b-4a5bf22d8164",
  event_type: "page_view",
  visitor_id: "22222222-2222-4222-8222-222222222222",
  session_id: "33333333-3333-4333-8333-333333333333",
  page_url: "https://example.com/products",
  page_title: "Products",
  page_path: "/products",
  referrer: null,
  referrer_host: null,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_term: null,
  utm_content: null,
  occurred_at: "2026-11-07T10:00:00.000Z",
};

function createTracker() {
  return new Tracker({
    siteId: SITE_ID,
    endpoint: ENDPOINT,
    debug: false,
  });
}

describe("Tracker PageView integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.startAutoPageTracking.mockReset();
    mocks.createIdentityManager.mockReset();
  });

  it("TRACK-01: should initialize IdentityManager", () => {
    mocks.createIdentityManager.mockReturnValue(
      mockIdentityManager
    );

    createTracker();

    expect(mocks.createIdentityManager).toHaveBeenCalled();
  });

  it("TRACK-02: should start automatic page tracking", () => {
  mocks.createIdentityManager.mockReturnValue(
    mockIdentityManager
  );

  const unsubscribe = vi.fn();

  mocks.startAutoPageTracking.mockReturnValue(unsubscribe);

  const tracker = createTracker();
  const stop = tracker.startPageTracking();

  expect(mocks.startAutoPageTracking).toHaveBeenCalledWith(
    mockIdentityManager,
    expect.any(Function)
  );

  // 返回停止控制函数
  expect(stop).toBeTypeOf("function");

  // 启动追踪时不应立即取消订阅
  expect(unsubscribe).not.toHaveBeenCalled();

  // 第一次停止应执行底层取消订阅
  stop();

  expect(unsubscribe).toHaveBeenCalledTimes(1);

  // 重复停止不应重复执行底层取消订阅
  stop();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

  it("TRACK-03: should send PageViewEvent with configured site_id", async () => {
    mocks.createIdentityManager.mockReturnValue(
      mockIdentityManager
    );

    mocks.startAutoPageTracking.mockImplementation(
      (_identity, callback) => {
        callback(mockEvent);
        return vi.fn();
      }
    );

    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, { status: 202 })
    );

    vi.stubGlobal("fetch", fetcher);

    const tracker = createTracker();

    tracker.startPageTracking();

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    const [url, options] = fetcher.mock.calls[0];

    expect(url).toBe(ENDPOINT);
    expect(options.method).toBe("POST");

    expect(JSON.parse(options.body)).toEqual({
      site_id: SITE_ID,
      ...mockEvent,
    });
  });

  it("TRACK-04: should return accepted result to callback", async () => {
    mocks.createIdentityManager.mockReturnValue(
      mockIdentityManager
    );

    mocks.startAutoPageTracking.mockImplementation(
      (_identity, callback) => {
        callback(mockEvent);
        return vi.fn();
      }
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, { status: 202 })
      )
    );

    const onSendResult = vi.fn();
    const tracker = createTracker();

    tracker.startPageTracking(onSendResult);

    await vi.waitFor(() => {
      expect(onSendResult).toHaveBeenCalledWith(
        mockEvent,
        {
          status: "accepted",
          httpStatus: 202,
        }
      );
    });
  });

  it("TRACK-05: should return duplicate result to callback", async () => {
    mocks.createIdentityManager.mockReturnValue(
      mockIdentityManager
    );

    mocks.startAutoPageTracking.mockImplementation(
      (_identity, callback) => {
        callback(mockEvent);
        return vi.fn();
      }
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, { status: 200 })
      )
    );

    const onSendResult = vi.fn();
    const tracker = createTracker();

    tracker.startPageTracking(onSendResult);

    await vi.waitFor(() => {
      expect(onSendResult).toHaveBeenCalledWith(
        mockEvent,
        {
          status: "duplicate",
          httpStatus: 200,
        }
      );
    });
  });

  it("TRACK-06: should not throw when network request fails", async () => {
    mocks.createIdentityManager.mockReturnValue(
      mockIdentityManager
    );

    mocks.startAutoPageTracking.mockImplementation(
      (_identity, callback) => {
        callback(mockEvent);
        return vi.fn();
      }
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new TypeError("Failed to fetch")
      )
    );

    const onSendResult = vi.fn();
    const tracker = createTracker();

    expect(() => {
      tracker.startPageTracking(onSendResult);
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(onSendResult).toHaveBeenCalledWith(
        mockEvent,
        {
          status: "network_error",
          httpStatus: null,
          errorCode: "NETWORK_ERROR",
        }
      );
    });
  });

  it("TRACK-07: should stop tracking through returned function", () => {
    mocks.createIdentityManager.mockReturnValue(
      mockIdentityManager
    );

    const unsubscribe = vi.fn();

    mocks.startAutoPageTracking.mockReturnValue(unsubscribe);

    const tracker = createTracker();
    const stop = tracker.startPageTracking();

    stop();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
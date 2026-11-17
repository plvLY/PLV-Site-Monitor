
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  subscribeRouteChange,
} from "../../src/events/route-listener";

describe("subscribeRouteChange", () => {
  let currentUrl: string;

  let originalPushState: ReturnType<typeof vi.fn>;
  let originalReplaceState: ReturnType<typeof vi.fn>;

  let mockHistory: {
    pushState: ReturnType<typeof vi.fn>;
    replaceState: ReturnType<typeof vi.fn>;
  };

  let listeners: Map<string, Set<EventListener>>;

  function createMockWindow() {
    listeners = new Map();

    mockHistory = {
      pushState: vi.fn((_state, _title, url) => {
        if (url !== null && url !== undefined) {
          currentUrl = new URL(String(url), currentUrl).href;
        }
      }),

      replaceState: vi.fn((_state, _title, url) => {
        if (url !== null && url !== undefined) {
          currentUrl = new URL(String(url), currentUrl).href;
        }
      }),
    };

    originalPushState = mockHistory.pushState;
    originalReplaceState = mockHistory.replaceState;

    const mockWindow = {
      get location() {
        return {
          get href() {
            return currentUrl;
          },
        };
      },

      history: mockHistory,

      addEventListener: vi.fn(
        (type: string, callback: EventListener) => {
          if (!listeners.has(type)) {
            listeners.set(type, new Set());
          }

          listeners.get(type)!.add(callback);
        }
      ),

      removeEventListener: vi.fn(
        (type: string, callback: EventListener) => {
          listeners.get(type)?.delete(callback);
        }
      ),

      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((callback) => {
          callback.call(mockWindow as unknown as Window, event);
        });

        return true;
      },
    };

    vi.stubGlobal("window", mockWindow);
  }

  function dispatchWindowEvent(type: string) {
    const event = new Event(type);

    window.dispatchEvent(event);
  }

  beforeEach(() => {
    currentUrl = "https://example.com/";

    createMockWindow();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ROUTE-01: detects pushState URL changes", () => {
    const callback = vi.fn();

    const unsubscribe = subscribeRouteChange(callback);

    window.history.pushState({}, "", "/products");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      "https://example.com/products"
    );

    unsubscribe();
  });

  it("ROUTE-02: detects replaceState URL changes", () => {
    const callback = vi.fn();

    const unsubscribe = subscribeRouteChange(callback);

    window.history.replaceState({}, "", "/cart");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      "https://example.com/cart"
    );

    unsubscribe();
  });

  it("ROUTE-03: detects popstate events", () => {
    const callback = vi.fn();

    const unsubscribe = subscribeRouteChange(callback);

    currentUrl = "https://example.com/previous";

    dispatchWindowEvent("popstate");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      "https://example.com/previous"
    );

    unsubscribe();
  });

  it("ROUTE-04: detects hashchange events", () => {
    const callback = vi.fn();

    const unsubscribe = subscribeRouteChange(callback);

    currentUrl = "https://example.com/#details";

    dispatchWindowEvent("hashchange");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      "https://example.com/#details"
    );

    unsubscribe();
  });

  it("ROUTE-05: ignores unchanged URLs", () => {
    const callback = vi.fn();

    const unsubscribe = subscribeRouteChange(callback);

    window.history.pushState({}, "", "/");

    expect(callback).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("ROUTE-06: notifies multiple subscribers", () => {
    const callbackA = vi.fn();
    const callbackB = vi.fn();

    const unsubscribeA = subscribeRouteChange(callbackA);
    const unsubscribeB = subscribeRouteChange(callbackB);

    window.history.pushState({}, "", "/products");

    expect(callbackA).toHaveBeenCalledTimes(1);
    expect(callbackB).toHaveBeenCalledTimes(1);

    unsubscribeA();
    unsubscribeB();
  });

  it("ROUTE-07: stops notifying after unsubscribe", () => {
    const callback = vi.fn();

    const unsubscribe = subscribeRouteChange(callback);

    unsubscribe();

    window.history.pushState({}, "", "/products");

    expect(callback).not.toHaveBeenCalled();
  });

  it("ROUTE-08: restores original History methods after last unsubscribe", () => {
    const callback = vi.fn();

    const unsubscribe = subscribeRouteChange(callback);

    expect(window.history.pushState).not.toBe(
      originalPushState
    );

    expect(window.history.replaceState).not.toBe(
      originalReplaceState
    );

    unsubscribe();

    expect(window.history.pushState).toBe(
      originalPushState
    );

    expect(window.history.replaceState).toBe(
      originalReplaceState
    );
  });
});

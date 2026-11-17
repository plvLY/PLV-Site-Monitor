
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { IdentityManager } from "../../src/types";

import { startAutoPageTracking } from "../../src/events/auto-page-tracking";

describe("startAutoPageTracking", () => {
  let currentUrl: string;
  let currentTitle: string;
  let currentReferrer: string;

  let listeners: Map<string, Set<EventListener>>;

  let identityManager: IdentityManager;
  let getIdentity: ReturnType<typeof vi.fn>;

  const cleanupCallbacks: Array<() => void> = [];

  function createMockBrowser() {
    listeners = new Map();

    const history = {
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

    const mockWindow = {
      get location() {
        return {
          get href() {
            return currentUrl;
          },
        };
      },

      history,

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

    const mockDocument = {
      get title() {
        return currentTitle;
      },

      get referrer() {
        return currentReferrer;
      },
    };

    vi.stubGlobal("window", mockWindow);
    vi.stubGlobal("document", mockDocument);
  }

  function startTracking(
  callback: Parameters<typeof startAutoPageTracking>[1]
): () => void {
  const unsubscribe = startAutoPageTracking(
    identityManager,
    callback
  );

  cleanupCallbacks.push(unsubscribe);

  return unsubscribe;
}

  function dispatchWindowEvent(type: string) {
    window.dispatchEvent(new Event(type));
  }

  beforeEach(() => {
    currentUrl = "https://example.com/";
    currentTitle = "Home";
    currentReferrer = "https://google.com/";

    createMockBrowser();

    getIdentity = vi.fn(() => ({
      visitorId: "accb07ee-6504-4855-b25b-4a5bf22d8164",
      sessionId: "22222222-2222-4222-8222-222222222222",
    }));

    identityManager = {
      getIdentity,
      getVisitorId: vi.fn(),
      getSessionId: vi.fn(),
    };
  });

  afterEach(() => {
    cleanupCallbacks.splice(0).reverse().forEach((cleanup) => {
      cleanup();
    });

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("AUTO-01: tracks the initial page automatically", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    expect(callback).toHaveBeenCalledTimes(1);

    expect(callback.mock.calls[0][0]).toMatchObject({
      event_type: "page_view",
      page_url: "https://example.com/",
      page_title: "Home",
      page_path: "/",
      referrer: "https://google.com/",
      referrer_host: "google.com",
    });

    unsubscribe();
  });

  it("AUTO-02: tracks pushState navigation", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    currentTitle = "Products";

    window.history.pushState({}, "", "/products");

    expect(callback).toHaveBeenCalledTimes(2);

    expect(callback.mock.calls[1][0]).toMatchObject({
      page_url: "https://example.com/products",
      page_title: "Products",
      referrer: "https://example.com/",
      referrer_host: "example.com",
    });

    unsubscribe();
  });

  it("AUTO-03: tracks replaceState navigation", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    currentTitle = "Cart";

    window.history.replaceState({}, "", "/cart");

    expect(callback).toHaveBeenCalledTimes(2);

    expect(callback.mock.calls[1][0].page_url).toBe(
      "https://example.com/cart"
    );

    unsubscribe();
  });

  it("AUTO-04: tracks popstate navigation", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    currentUrl = "https://example.com/previous";
    currentTitle = "Previous";

    dispatchWindowEvent("popstate");

    expect(callback).toHaveBeenCalledTimes(2);

    expect(callback.mock.calls[1][0]).toMatchObject({
      page_url: "https://example.com/previous",
      page_title: "Previous",
    });

    unsubscribe();
  });

  it("AUTO-05: tracks hashchange navigation", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    currentUrl = "https://example.com/#details";

    dispatchWindowEvent("hashchange");

    expect(callback).toHaveBeenCalledTimes(2);

    expect(callback.mock.calls[1][0]).toMatchObject({
      page_url: "https://example.com/",
      page_path: "/",
    });

    unsubscribe();
  });

  it("AUTO-06: uses previous page URL as SPA referrer", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    window.history.pushState({}, "", "/products");

    window.history.pushState({}, "", "/cart");

    expect(callback).toHaveBeenCalledTimes(3);

    expect(callback.mock.calls[1][0].referrer).toBe(
      "https://example.com/"
    );

    expect(callback.mock.calls[2][0].referrer).toBe(
      "https://example.com/products"
    );

    unsubscribe();
  });

  it("AUTO-07: keeps visitor and session identity unchanged", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    window.history.pushState({}, "", "/products");

    const firstEvent = callback.mock.calls[0][0];
    const secondEvent = callback.mock.calls[1][0];

    expect(firstEvent.visitor_id).toBe(secondEvent.visitor_id);
    expect(firstEvent.session_id).toBe(secondEvent.session_id);

    expect(getIdentity).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("AUTO-08: generates unique event IDs for each page view", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    window.history.pushState({}, "", "/products");
    window.history.pushState({}, "", "/cart");

    const eventIds = callback.mock.calls.map(
      ([event]) => event.event_id
    );

    expect(new Set(eventIds).size).toBe(3);

    unsubscribe();
  });

  it("AUTO-09: stops tracking after unsubscribe", () => {
    const callback = vi.fn();

    const unsubscribe = startTracking(callback);

    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();

    window.history.pushState({}, "", "/products");

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

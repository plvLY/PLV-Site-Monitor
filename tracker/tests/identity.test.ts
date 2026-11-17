import { beforeEach, describe, expect, it, vi } from "vitest";

class MockStorage {
  private data = new Map<string, string>();
  shouldThrowOnGet = false;
  shouldThrowOnSet = false;

  getItem(key: string): string | null {
    if (this.shouldThrowOnGet) throw new Error("Storage read failed");
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.shouldThrowOnSet) throw new Error("Storage write failed");
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

const localStorageMock = new MockStorage();
const sessionStorageMock = new MockStorage();

async function loadManager() {
  vi.resetModules();
  const module = await import("../src/identity");
  return module.createIdentityManager();
}

function installWindow() {
  vi.stubGlobal("window", {
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
  });
}

beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
  localStorageMock.shouldThrowOnGet = false;
  localStorageMock.shouldThrowOnSet = false;
  sessionStorageMock.shouldThrowOnGet = false;
  sessionStorageMock.shouldThrowOnSet = false;
  installWindow();
});

describe("Identity Manager", () => {
  it("ID-01: 首次获取身份时生成两个 UUID v4", async () => {
    const manager = await loadManager();
    const identity = manager.getIdentity();

    expect(identity.visitorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(identity.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(identity.visitorId).not.toBe(identity.sessionId);
  });

  it("ID-02: 重复获取身份时保持不变", async () => {
    const manager = await loadManager();

    expect(manager.getIdentity()).toEqual(manager.getIdentity());
  });

  it("ID-03: Visitor ID 保存到 localStorage", async () => {
    const manager = await loadManager();
    const visitorId = manager.getVisitorId();

    expect(localStorageMock.getItem("plv_sm_visitor_id")).toBe(visitorId);
  });

  it("ID-04: Session ID 保存到 sessionStorage", async () => {
    const manager = await loadManager();
    const sessionId = manager.getSessionId();

    expect(sessionStorageMock.getItem("plv_sm_session_id")).toBe(sessionId);
  });

  it("ID-05: 重新初始化后读取原有身份", async () => {
    const first = await loadManager();
    const original = first.getIdentity();

    const second = await loadManager();

    expect(second.getIdentity()).toEqual(original);
  });

  it("ID-06: 不同标签页使用不同 sessionStorage 时生成新 Session ID", async () => {
    const first = await loadManager();
    const firstIdentity = first.getIdentity();

    const anotherTabSession = new MockStorage();
    vi.stubGlobal("window", {
      localStorage: localStorageMock,
      sessionStorage: anotherTabSession,
    });

    const second = await loadManager();
    const secondIdentity = second.getIdentity();

    expect(secondIdentity.visitorId).toBe(firstIdentity.visitorId);
    expect(secondIdentity.sessionId).not.toBe(firstIdentity.sessionId);
  });

  it("ID-07: 非法 Visitor ID 会被重新生成", async () => {
    localStorageMock.setItem("plv_sm_visitor_id", "invalid-id");

    const manager = await loadManager();
    const visitorId = manager.getVisitorId();

    expect(visitorId).not.toBe("invalid-id");
    expect(localStorageMock.getItem("plv_sm_visitor_id")).toBe(visitorId);
  });

  it("ID-08: 非法 Session ID 会被重新生成", async () => {
    sessionStorageMock.setItem("plv_sm_session_id", "invalid-id");

    const manager = await loadManager();
    const sessionId = manager.getSessionId();

    expect(sessionId).not.toBe("invalid-id");
    expect(sessionStorageMock.getItem("plv_sm_session_id")).toBe(sessionId);
  });

  it("ID-09: localStorage 不可用时降级到内存", async () => {
    localStorageMock.shouldThrowOnGet = true;
    localStorageMock.shouldThrowOnSet = true;

    const manager = await loadManager();
    const first = manager.getVisitorId();

    expect(manager.getVisitorId()).toBe(first);
  });

  it("ID-10: sessionStorage 不可用时降级到内存", async () => {
    sessionStorageMock.shouldThrowOnGet = true;
    sessionStorageMock.shouldThrowOnSet = true;

    const manager = await loadManager();
    const first = manager.getSessionId();

    expect(manager.getSessionId()).toBe(first);
  });

  it("ID-11: 安全 UUID 生成能力不可用时抛出明确异常", async () => {
    const originalCrypto = globalThis.crypto;

    vi.stubGlobal("crypto", undefined);

    try {
      const manager = await loadManager();

      expect(() => manager.getVisitorId()).toThrow(
        "Secure UUID generation is not supported"
      );
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });
});

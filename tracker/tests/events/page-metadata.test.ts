
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectPageMetadata } from "../../src/events/page-metadata";

describe("collectPageMetadata", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/products?page=1",
      },
    });

    vi.stubGlobal("document", {
      title: "Example Products",
      referrer: "",
    });
  });

  it("PM-01: collects basic page metadata", () => {
    const result = collectPageMetadata();

    expect(result).toEqual({
      page_url: "https://example.com/products",
      page_title: "Example Products",
      page_path: "/products",
      referrer: null,
      referrer_host: null,
    });
  });

  it("PM-02: filters non-allowlisted query parameters", () => {
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/products?id=123&source=test",
      },
    });

    const result = collectPageMetadata();

    expect(result.page_url).toBe(
      "https://example.com/products"
    );
  });

  it("PM-03: removes hash and non-allowlisted query parameters", () => {
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/products?id=123#details",
      },
    });

    const result = collectPageMetadata();

    expect(result.page_url).toBe(
      "https://example.com/products"
    );
    expect(result.page_path).toBe("/products");
  });

  it("PM-04: extracts external referrer host", () => {
    vi.stubGlobal("document", {
      title: "Example Products",
      referrer: "https://google.com/search?q=example",
    });

    const result = collectPageMetadata();

    expect(result.referrer).toBe(
      "https://google.com/search?q=example"
    );
    expect(result.referrer_host).toBe("google.com");
  });

  it("PM-05: returns null when referrer is empty", () => {
    const result = collectPageMetadata();

    expect(result.referrer).toBeNull();
    expect(result.referrer_host).toBeNull();
  });

  it("PM-06: handles invalid referrer URL", () => {
    vi.stubGlobal("document", {
      title: "Example Products",
      referrer: "invalid-url",
    });

    const result = collectPageMetadata();

    expect(result.referrer).toBeNull();
    expect(result.referrer_host).toBeNull();
  });
});

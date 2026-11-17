
import { describe, expect, it } from "vitest";
import { collectUtmParams } from "../../src/events/utm";

describe("collectUtmParams", () => {
  it("UTM-01: extracts all five UTM parameters", () => {
    const result = collectUtmParams(
      "https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_term=coffee&utm_content=banner"
    );

    expect(result).toEqual({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "spring",
      utm_term: "coffee",
      utm_content: "banner",
    });
  });

  it("UTM-02: returns null for missing parameters", () => {
    const result = collectUtmParams("https://example.com/");

    expect(result).toEqual({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
    });
  });

  it("UTM-03: supports partially provided parameters", () => {
    const result = collectUtmParams(
      "https://example.com/?utm_source=google&utm_campaign=spring"
    );

    expect(result.utm_source).toBe("google");
    expect(result.utm_campaign).toBe("spring");
    expect(result.utm_medium).toBeNull();
    expect(result.utm_term).toBeNull();
    expect(result.utm_content).toBeNull();
  });

  it("UTM-04: converts empty values to null", () => {
    const result = collectUtmParams(
      "https://example.com/?utm_source=&utm_medium=cpc"
    );

    expect(result.utm_source).toBeNull();
    expect(result.utm_medium).toBe("cpc");
  });

  it("UTM-05: preserves parameter values", () => {
    const result = collectUtmParams(
      "https://example.com/?utm_source=Google%20Ads&utm_campaign=Spring%202026"
    );

    expect(result.utm_source).toBe("Google Ads");
    expect(result.utm_campaign).toBe("Spring 2026");
  });

  it("UTM-06: ignores unrelated query parameters", () => {
    const result = collectUtmParams(
      "https://example.com/?id=123&token=abc&utm_source=google"
    );

    expect(result).toEqual({
      utm_source: "google",
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
    });
  });
});

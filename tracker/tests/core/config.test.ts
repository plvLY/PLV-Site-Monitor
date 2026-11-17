import { describe, it, expect } from "vitest";
import {
  normalizeConfig,
  isSameConfig,
} from "../../src/core/config";
import {
  TrackerConfigError,
} from "../../src/core/errors";
import type {
  TrackerConfig,
} from "../../src/types";

const validOptions = {
  siteId: "accb07ee-6504-4855-b25b-4a5bf22d8164",
  endpoint: "https://monitor.example.com/api/collect",
};

describe("normalizeConfig", () => {
  it("CFG-01: should normalize valid configuration", () => {
    const config = normalizeConfig(validOptions);

    expect(config).toEqual({
      ...validOptions,
      debug: false,
    });
  });

  it("CFG-02: should preserve debug=true", () => {
    const config = normalizeConfig({
      ...validOptions,
      debug: true,
    });

    expect(config.debug).toBe(true);
  });

  it("CFG-03: should reject invalid siteId", () => {
    expect(() =>
      normalizeConfig({
        ...validOptions,
        siteId: "invalid",
      })
    ).toThrow(TrackerConfigError);
  });

  it("CFG-04: should reject missing siteId", () => {
    expect(() =>
      normalizeConfig({
        endpoint: validOptions.endpoint,
      } as never)
    ).toThrow(TrackerConfigError);
  });

  it("CFG-05: should reject missing endpoint", () => {
    expect(() =>
      normalizeConfig({
        siteId: validOptions.siteId,
      } as never)
    ).toThrow(TrackerConfigError);
  });

  it("CFG-06: should reject malformed endpoint", () => {
    expect(() =>
      normalizeConfig({
        ...validOptions,
        endpoint: "not-a-url",
      })
    ).toThrow(TrackerConfigError);
  });

  it("CFG-07: should reject unsupported protocol", () => {
    expect(() =>
      normalizeConfig({
        ...validOptions,
        endpoint: "ftp://monitor.example.com",
      })
    ).toThrow(TrackerConfigError);
  });

  it("CFG-08: should accept HTTP endpoint", () => {
    const config = normalizeConfig({
      ...validOptions,
      endpoint: "http://localhost:8888/api/collect",
    });

    expect(config.endpoint).toBe(
      "http://localhost:8888/api/collect"
    );
  });

  it("CFG-09: should reject non-boolean debug", () => {
    expect(() =>
      normalizeConfig({
        ...validOptions,
        debug: "true",
      } as never)
    ).toThrow(TrackerConfigError);
  });

  it("CFG-10: should reject null options", () => {
    expect(() =>
      normalizeConfig(null as never)
    ).toThrow(TrackerConfigError);
  });
});

describe("isSameConfig", () => {
  const configA: TrackerConfig = {
    ...validOptions,
    debug: false,
  };

  it("CFG-11: should return true for identical configurations", () => {
    expect(isSameConfig(configA, { ...configA })).toBe(true);
  });

  it("CFG-12: should return false for different siteId", () => {
    expect(
      isSameConfig(configA, {
        ...configA,
        siteId: "22222222-2222-4222-8222-222222222222",
      })
    ).toBe(false);
  });

  it("CFG-13: should return false for different endpoint", () => {
    expect(
      isSameConfig(configA, {
        ...configA,
        endpoint: "https://other.example.com/api/collect",
      })
    ).toBe(false);
  });

  it("CFG-14: should return false for different debug", () => {
    expect(
      isSameConfig(configA, {
        ...configA,
        debug: true,
      })
    ).toBe(false);
  });
});

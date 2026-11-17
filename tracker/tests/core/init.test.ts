import { describe, it, expect } from "vitest";
import { init } from "../../src/core/init";
import {
  TrackerConfigError,
  TrackerConfigConflictError,
} from "../../src/core/errors";

const validOptions = {
  siteId: "accb07ee-6504-4855-b25b-4a5bf22d8164",
  endpoint: "https://monitor.example.com/api/collect",
};

describe("Tracker init", () => {
  it("INIT-01: should create a Tracker instance", () => {
    const tracker = init(validOptions);

    expect(tracker).toBeDefined();
    expect(typeof tracker.getIdentity).toBe("function");
  });

  it("INIT-02: should return the same instance for identical config", () => {
    const first = init(validOptions);
    const second = init({ ...validOptions, debug: false });

    expect(second).toBe(first);
  });

  it("INIT-03: should reject different siteId", () => {
    expect(() =>
      init({
        ...validOptions,
        siteId: "22222222-2222-4222-8222-222222222222",
      })
    ).toThrow(TrackerConfigConflictError);
  });

  it("INIT-04: should reject different endpoint", () => {
    expect(() =>
      init({
        ...validOptions,
        endpoint: "https://other.example.com/api/collect",
      })
    ).toThrow(TrackerConfigConflictError);
  });

  it("INIT-05: should reject different debug", () => {
    expect(() =>
      init({
        ...validOptions,
        debug: true,
      })
    ).toThrow(TrackerConfigConflictError);
  });

  it("INIT-06: should reject invalid configuration", () => {
    expect(() =>
      init({
        ...validOptions,
        siteId: "invalid",
      })
    ).toThrow(TrackerConfigError);
  });
});

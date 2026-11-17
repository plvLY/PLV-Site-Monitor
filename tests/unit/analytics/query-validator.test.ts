import { describe, expect, it } from "vitest";

import { QueryValidator } from "../../../netlify/functions/_shared/analytics/query-validator";
import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";

describe("QueryValidator", () => {
  describe("URLSearchParams parsing", () => {
    it("parses query string", () => {
      const validator = new QueryValidator("site_id=abc&range=7d");

      expect(validator.getString("site_id")).toBe("abc");
      expect(validator.getString("range")).toBe("7d");
    });

    it("parses URLSearchParams instance", () => {
      const params = new URLSearchParams("page=1&page_size=20");
      const validator = new QueryValidator(params);

      expect(validator.getString("page")).toBe("1");
      expect(validator.getString("page_size")).toBe("20");
    });

    it("returns null for missing optional parameter", () => {
      const validator = new QueryValidator("page=1");

      expect(validator.getString("page_size")).toBeNull();
    });

    it("throws INVALID_QUERY for missing required parameter", () => {
      const validator = new QueryValidator("page=1");

      expect(() =>
        validator.getString("site_id", { required: true }),
      ).toThrow(AnalyticsError);
    });
  });

  describe("duplicate parameter rejection", () => {
    it("rejects duplicate key parameters by default", () => {
      const validator = new QueryValidator("page=1&page=2");

      expect(() => validator.parse()).toThrow(AnalyticsError);
    });

    it("rejects duplicate key in getString", () => {
      const validator = new QueryValidator("range=7d&range=30d");

      expect(() => validator.getString("range")).toThrow(AnalyticsError);
    });

    it("allows duplicates when strict is disabled", () => {
      const validator = new QueryValidator("tag=a&tag=b", { strict: false });

      const parsed = validator.parse();

      expect(parsed.tag).toEqual(["a", "b"]);
    });
  });

  describe("getEnum", () => {
    it("returns null for missing optional enum parameter", () => {
      const validator = new QueryValidator("range=7d");

      expect(validator.getEnum("range", ["today", "7d"])).toBe("7d");
    });

    it("throws INVALID_QUERY for value outside enum", () => {
      const validator = new QueryValidator("range=99d");

      expect(() =>
        validator.getEnum("range", ["today", "7d"]),
      ).toThrow(AnalyticsError);
    });

    it("throws INVALID_QUERY for missing required enum parameter", () => {
      const validator = new QueryValidator("");

      expect(() =>
        validator.getEnum("range", ["today", "7d"], { required: true }),
      ).toThrow(AnalyticsError);
    });
  });

  describe("getPositiveInt", () => {
    it("parses positive integer", () => {
      const validator = new QueryValidator("page=5");

      expect(validator.getPositiveInt("page")).toBe(5);
    });

    it("throws INVALID_QUERY for zero or negative", () => {
      const validator = new QueryValidator("page=0");

      expect(() => validator.getPositiveInt("page")).toThrow(AnalyticsError);

      const negative = new QueryValidator("page=-3");

      expect(() => negative.getPositiveInt("page")).toThrow(AnalyticsError);
    });

    it("throws INVALID_QUERY for non-integer", () => {
      const validator = new QueryValidator("page=1.5");

      expect(() => validator.getPositiveInt("page")).toThrow(AnalyticsError);
    });
  });

  describe("getIntInRange", () => {
    it("parses integer within range", () => {
      const validator = new QueryValidator("page_size=50");

      expect(
        validator.getIntInRange("page_size", { min: 1, max: 100 }),
      ).toBe(50);
    });

    it("throws INVALID_QUERY below min", () => {
      const validator = new QueryValidator("page_size=0");

      expect(() =>
        validator.getIntInRange("page_size", { min: 1, max: 100 }),
      ).toThrow(AnalyticsError);
    });

    it("throws INVALID_QUERY above max", () => {
      const validator = new QueryValidator("page_size=101");

      expect(() =>
        validator.getIntInRange("page_size", { min: 1, max: 100 }),
      ).toThrow(AnalyticsError);
    });
  });

  describe("has and getAll", () => {
    it("checks parameter presence", () => {
      const validator = new QueryValidator("a=1");

      expect(validator.has("a")).toBe(true);
      expect(validator.has("b")).toBe(false);
    });

    it("returns all values for a key", () => {
      const validator = new QueryValidator("tag=a&tag=b&tag=c");

      expect(validator.getAll("tag")).toEqual(["a", "b", "c"]);
    });
  });
});

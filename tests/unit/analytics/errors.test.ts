import { describe, expect, it } from "vitest";

import { AnalyticsError, ERROR_STATUS, toAnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";

describe("errors", () => {
  describe("ERROR_STATUS mapping", () => {
    it.each([
      ["INVALID_QUERY", 400],
      ["INVALID_DATE_RANGE", 400],
      ["INVALID_TIMEZONE", 400],
      ["UNAUTHORIZED", 401],
      ["SITE_ACCESS_DENIED", 403],
      ["SITE_NOT_FOUND", 404],
      ["INTERNAL_ERROR", 500],
    ])("maps %s to %d", (code, status) => {
      expect(ERROR_STATUS[code as keyof typeof ERROR_STATUS]).toBe(status);
    });
  });

  describe("AnalyticsError", () => {
    it("sets code, status and message", () => {
      const error = new AnalyticsError("INVALID_QUERY", "Bad query.");

      expect(error.code).toBe("INVALID_QUERY");
      expect(error.status).toBe(400);
      expect(error.message).toBe("Bad query.");
      expect(error.name).toBe("AnalyticsError");
      expect(error.isOperational).toBe(true);
    });

    it("supports non-operational flag", () => {
      const error = new AnalyticsError("INTERNAL_ERROR", "Failed.", false);

      expect(error.isOperational).toBe(false);
    });
  });

  describe("toAnalyticsError", () => {
    it("returns AnalyticsError unchanged", () => {
      const original = new AnalyticsError("SITE_NOT_FOUND", "Not found.");
      const converted = toAnalyticsError(original);

      expect(converted).toBe(original);
      expect(converted.code).toBe("SITE_NOT_FOUND");
    });

    it("converts unknown Error to INTERNAL_ERROR", () => {
      const converted = toAnalyticsError(new Error("Something broke."));

      expect(converted.code).toBe("INTERNAL_ERROR");
      expect(converted.status).toBe(500);
      expect(converted.message).toBe("An internal server error occurred.");
    });

    it("converts non-Error value to INTERNAL_ERROR", () => {
      const converted = toAnalyticsError("string error");

      expect(converted.code).toBe("INTERNAL_ERROR");
      expect(converted.status).toBe(500);
    });
  });
});

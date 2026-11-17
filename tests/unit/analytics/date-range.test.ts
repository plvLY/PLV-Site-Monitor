import { describe, expect, it } from "vitest";

import {
  parseDateRange,
  isValidTimeZone,
} from "../../../netlify/functions/_shared/analytics/date-range";
import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";

describe("isValidTimeZone", () => {
  it("accepts valid IANA timezones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
  });

  it("rejects invalid timezones", () => {
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Invalid/Zone")).toBe(false);
    expect(isValidTimeZone("NotATimezone")).toBe(false);
  });
});

describe("parseDateRange", () => {
  describe("default range", () => {
    it("defaults to 7d when range is omitted", () => {
      const result = parseDateRange({});

      expect(result.range).toBe("7d");
      expect(result.start.getTime()).toBeLessThan(result.end.getTime());
    });
  });

  describe("preset ranges", () => {
    it("today produces [start, end) within the same local day", () => {
      const result = parseDateRange({ range: "today", timeZone: "UTC" });

      expect(result.range).toBe("today");
      expect(result.start.getTime()).toBeLessThan(result.end.getTime());
      expect(result.end.getTime() - result.start.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it("yesterday produces [start, end) on the previous local day", () => {
      const result = parseDateRange({ range: "yesterday", timeZone: "UTC" });

      expect(result.range).toBe("yesterday");
      expect(result.end.getTime() - result.start.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it("7d covers 7 local days", () => {
      const result = parseDateRange({ range: "7d", timeZone: "UTC" });

      expect(result.range).toBe("7d");
      expect(result.end.getTime() - result.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("30d covers 30 local days", () => {
      const result = parseDateRange({ range: "30d", timeZone: "UTC" });

      expect(result.range).toBe("30d");
      expect(result.end.getTime() - result.start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it.each([
      "today",
      "yesterday",
      "7d",
      "30d",
    ])("%s end is exclusive (start < end)", (range) => {
      const result = parseDateRange({ range, timeZone: "UTC" });

      expect(result.start.getTime()).toBeLessThan(result.end.getTime());
    });
  });

  describe("custom range", () => {
    it("parses explicit start and end dates", () => {
      const result = parseDateRange({
        range: "custom",
        start: "2026-11-01",
        end: "2026-11-02",
        timeZone: "UTC",
      });

      expect(result.range).toBe("custom");
      expect(result.startIso).toBe("2026-11-01T00:00:00.000Z");
      expect(result.endIso).toBe("2026-11-02T00:00:00.000Z");
    });

    it("requires both start and end for custom", () => {
      expect(() =>
        parseDateRange({ range: "custom", start: "2026-11-01", timeZone: "UTC" }),
      ).toThrow(AnalyticsError);

      expect(() =>
        parseDateRange({ range: "custom", end: "2026-11-02", timeZone: "UTC" }),
      ).toThrow(AnalyticsError);

      expect(() =>
        parseDateRange({ range: "custom", timeZone: "UTC" }),
      ).toThrow(AnalyticsError);
    });

    it("rejects start >= end", () => {
      expect(() =>
        parseDateRange({
          range: "custom",
          start: "2026-11-02",
          end: "2026-11-01",
          timeZone: "UTC",
        }),
      ).toThrow(AnalyticsError);

      expect(() =>
        parseDateRange({
          range: "custom",
          start: "2026-11-01",
          end: "2026-11-01",
          timeZone: "UTC",
        }),
      ).toThrow(AnalyticsError);
    });

    it("rejects invalid dates", () => {
      expect(() =>
        parseDateRange({
          range: "custom",
          start: "not-a-date",
          end: "2026-11-02",
          timeZone: "UTC",
        }),
      ).toThrow(AnalyticsError);

      expect(() =>
        parseDateRange({
          range: "custom",
          start: "2026-11-01",
          end: "not-a-date",
          timeZone: "UTC",
        }),
      ).toThrow(AnalyticsError);
    });

    it.each([
      "2026-02-31",
      "2026-13-01",
      "2026-00-10",
      "2026-02-29",
      "2026-04-31",
      "2026-11-00",
    ])("rejects invalid calendar date: %s", (date) => {
      expect(() =>
        parseDateRange({
          range: "custom",
          start: date,
          end: "2026-12-01",
          timeZone: "UTC",
        }),
      ).toThrow(AnalyticsError);

      expect(() =>
        parseDateRange({
          range: "custom",
          start: "2026-11-01",
          end: date,
          timeZone: "UTC",
        }),
      ).toThrow(AnalyticsError);
    });

    it.each([
      ["2024-02-29", "2024-03-01"],
      ["2026-02-28", "2026-03-01"],
      ["2026-04-30", "2026-05-01"],
    ])(
      "accepts valid calendar dates: %s to %s",
      (start, end) => {
        const result = parseDateRange({
          range: "custom",
          start,
          end,
          timeZone: "UTC",
        });

        expect(result.start.getTime()).toBeLessThan(
          result.end.getTime(),
        );
      },
    );

  });

  describe("timezone", () => {
    it("rejects invalid IANA timezone", () => {
      expect(() =>
        parseDateRange({
          range: "today",
          timeZone: "Invalid/Zone",
        }),
      ).toThrow(AnalyticsError);
    });

    it("uses default timezone UTC when not provided", () => {
      const result = parseDateRange({ range: "today" });

      expect(result.timeZone).toBe("UTC");
    });
  });

  describe("DST boundaries (America/New_York)", () => {
    it("handles spring forward: local midnight exists after gap", () => {
      // 2026-03-08 is the spring-forward date in America/New_York.
      // 2:00 AM does not exist; clocks jump from 1:59 to 3:00.
      const result = parseDateRange({
        range: "custom",
        start: "2026-03-08",
        end: "2026-03-09",
        timeZone: "America/New_York",
      });

      expect(result.range).toBe("custom");
      expect(result.start.getTime()).toBeLessThan(result.end.getTime());
    });

    it("handles fall back: repeated local hour", () => {
      // 2026-11-01 is the fall-back date in America/New_York.
      // Clocks fall back from 2:00 AM to 1:00 AM.
      const result = parseDateRange({
        range: "custom",
        start: "2026-11-01",
        end: "2026-11-02",
        timeZone: "America/New_York",
      });

      expect(result.range).toBe("custom");
      expect(result.start.getTime()).toBeLessThan(result.end.getTime());
    });

    it("distinguishes local date boundary from UTC timestamp", () => {
      // America/New_York in November: DST ends Nov 1 at 2 AM EDT → EST.
      // Midnight Nov 1 is still EDT (UTC-4 → 04:00Z).
      // Midnight Nov 2 is EST (UTC-5 → 05:00Z).
      const result = parseDateRange({
        range: "custom",
        start: "2026-11-01",
        end: "2026-11-02",
        timeZone: "America/New_York",
      });

      expect(result.startIso).toBe("2026-11-01T04:00:00.000Z");
      expect(result.endIso).toBe("2026-11-02T05:00:00.000Z");
    });
  });

  describe("range validity", () => {
    it("rejects unknown range values", () => {
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parseDateRange({ range: "90d" as any, timeZone: "UTC" }),
      ).toThrow(AnalyticsError);
    });
  });
});

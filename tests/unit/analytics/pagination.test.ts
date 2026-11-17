import { describe, expect, it } from "vitest";

import {
  parsePagination,
  paginate,
} from "../../../netlify/functions/_shared/analytics/pagination";
import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";

describe("parsePagination", () => {
  describe("defaults", () => {
    it("defaults page to 1 and page_size to 10", () => {
      const result = parsePagination({});

      expect(result.page).toBe(1);
      expect(result.page_size).toBe(10);
      expect(result.offset).toBe(0);
    });
  });

  describe("page validation", () => {
    it("accepts page >= 1", () => {
      expect(parsePagination({ page: 1 }).page).toBe(1);
      expect(parsePagination({ page: 5 }).page).toBe(5);
    });

    it("rejects page < 1", () => {
      expect(() => parsePagination({ page: 0 })).toThrow(AnalyticsError);
      expect(() => parsePagination({ page: -1 })).toThrow(AnalyticsError);
    });

    it("rejects non-integer page", () => {
      expect(() => parsePagination({ page: 1.5 })).toThrow(AnalyticsError);
      expect(() => parsePagination({ page: "1" as unknown as number })).toThrow(
        AnalyticsError,
      );
    });
  });

  describe("page_size validation", () => {
    it("accepts page_size between 1 and 100", () => {
      expect(parsePagination({ page_size: 1 }).page_size).toBe(1);
      expect(parsePagination({ page_size: 10 }).page_size).toBe(10);
      expect(parsePagination({ page_size: 100 }).page_size).toBe(100);
    });

    it("rejects page_size < 1", () => {
      expect(() => parsePagination({ page_size: 0 })).toThrow(AnalyticsError);
      expect(() => parsePagination({ page_size: -1 })).toThrow(AnalyticsError);
    });

    it("rejects page_size > 100", () => {
      expect(() => parsePagination({ page_size: 101 })).toThrow(AnalyticsError);
    });

    it("rejects non-integer page_size", () => {
      expect(() => parsePagination({ page_size: 10.5 })).toThrow(AnalyticsError);
    });
  });

  describe("offset calculation", () => {
    it("computes offset = (page - 1) * page_size", () => {
      expect(parsePagination({ page: 1, page_size: 10 }).offset).toBe(0);
      expect(parsePagination({ page: 2, page_size: 10 }).offset).toBe(10);
      expect(parsePagination({ page: 3, page_size: 20 }).offset).toBe(40);
      expect(parsePagination({ page: 5, page_size: 50 }).offset).toBe(200);
    });
  });
});

describe("paginate", () => {
  it("fills total and total_pages", () => {
    const base = parsePagination({ page: 2, page_size: 10 });

    const result = paginate(25, base);

    expect(result.page).toBe(2);
    expect(result.page_size).toBe(10);
    expect(result.offset).toBe(10);
    expect(result.total).toBe(25);
    expect(result.total_pages).toBe(3);
  });

  it("total_pages is 0 when no data", () => {
    const base = parsePagination({});

    const result = paginate(0, base);

    expect(result.total).toBe(0);
    expect(result.total_pages).toBe(0);
  });

  it("computes total_pages exactly", () => {
    const base = parsePagination({ page: 1, page_size: 10 });

    expect(paginate(10, base).total_pages).toBe(1);
    expect(paginate(11, base).total_pages).toBe(2);
    expect(paginate(20, base).total_pages).toBe(2);
    expect(paginate(100, base).total_pages).toBe(10);
  });

  it("rejects negative total", () => {
    const base = parsePagination({});

    expect(() => paginate(-1, base)).toThrow(AnalyticsError);
  });
});

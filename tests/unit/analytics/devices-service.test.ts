import { describe, expect, it, vi } from "vitest";
import {
  getDevicesStats,
} from "../../../netlify/functions/_shared/analytics/devices-service";

const siteId = "accb07ee-6504-4855-b25b-4a5bf22d8164";

const start = new Date("2026-11-05T00:00:00.000Z");
const end = new Date("2026-11-09T00:00:00.000Z");

const pagination = {
  browser: { page: 1, pageSize: 10 },
  os: { page: 1, pageSize: 10 },
};

function createDatabase() {
  return {
    query: vi.fn().mockImplementation(async (query: string) => {
      if (query.includes("AS total")) {
        return {
          rows: [{ total: "2" }],
        };
      }

      if (query.includes("AS device")) {
        if (query.includes("GROUP BY browser")) {
          return {
            rows: [
              { device: "Chrome", pv: "9", uv: "1" },
              { device: "Mozilla", pv: "3", uv: "3" },
            ],
          };
        }

        return {
          rows: [
            { device: "Windows", pv: "12", uv: "4" },
              { device: null, pv: "1", uv: "1" },
          ],
        };
      }

      throw new Error("Unexpected SQL");
    }),
  };
}

describe("Devices Service", () => {
  it("should return browser and OS statistics", async () => {
    const database = createDatabase();

    const result = await getDevicesStats({
      database,
      siteId,
      start,
      end,
      pagination,
    });

    expect(result.browser.items).toEqual([
      { device: "Chrome", pv: 9, uv: 1 },
      { device: "Mozilla", pv: 3, uv: 3 },
    ]);

    expect(result.os.items).toEqual([
      { device: "Windows", pv: 12, uv: 4 },
      { device: null, pv: 1, uv: 1 },
    ]);

    expect(result.browser.total).toBe(2);
    expect(result.os.total).toBe(2);
  });

  it("should preserve NULL device groups", async () => {
    const database = createDatabase();

    const result = await getDevicesStats({
      database,
      siteId,
      start,
      end,
      pagination,
    });

    expect(result.os.items).toContainEqual({
      device: null,
      pv: 1,
      uv: 1,
    });
  });

  it("should use independent pagination for browser and OS", async () => {
    const database = createDatabase();

    const result = await getDevicesStats({
      database,
      siteId,
      start,
      end,
      pagination: {
        browser: { page: 2, pageSize: 1 },
        os: { page: 1, pageSize: 10 },
      },
    });

    expect(result.browser.page).toBe(2);
    expect(result.browser.pageSize).toBe(1);
    expect(result.os.page).toBe(1);
    expect(result.os.pageSize).toBe(10);
  });

  it("should calculate total pages correctly", async () => {
    const database = createDatabase();

    const result = await getDevicesStats({
      database,
      siteId,
      start,
      end,
      pagination: {
        browser: { page: 1, pageSize: 1 },
        os: { page: 1, pageSize: 10 },
      },
    });

    expect(result.browser.totalPages).toBe(2);
    expect(result.os.totalPages).toBe(1);
  });

  it("should reject invalid siteId", async () => {
    const database = createDatabase();

    await expect(
      getDevicesStats({
        database,
        siteId: "",
        start,
        end,
        pagination,
      }),
    ).rejects.toThrow("Invalid siteId");
  });

  it("should reject invalid date range", async () => {
    const database = createDatabase();

    await expect(
      getDevicesStats({
        database,
        siteId,
        start: end,
        end: start,
        pagination,
      }),
    ).rejects.toThrow("Invalid date range");
  });

  it("should reject invalid page", async () => {
    const database = createDatabase();

    await expect(
      getDevicesStats({
        database,
        siteId,
        start,
        end,
        pagination: {
          browser: { page: 0, pageSize: 10 },
          os: { page: 1, pageSize: 10 },
        },
      }),
    ).rejects.toThrow("Invalid page");
  });

  it("should reject pageSize greater than 100", async () => {
    const database = createDatabase();

    await expect(
      getDevicesStats({
        database,
        siteId,
        start,
        end,
        pagination: {
          browser: { page: 1, pageSize: 101 },
          os: { page: 1, pageSize: 10 },
        },
      }),
    ).rejects.toThrow("Invalid pageSize");
  });
});
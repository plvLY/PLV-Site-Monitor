
import { describe, expect, it, vi } from "vitest";
import {
  getSourcesStats,
  type SourceDimension,
} from "../../../netlify/functions/_shared/analytics/sources-service";

const siteA = "accb07ee-6504-4855-b25b-4a5bf22d8164";

const start = new Date("2026-11-05T00:00:00.000Z");
const end = new Date("2026-11-09T00:00:00.000Z");

const dimensions: SourceDimension[] = [
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
];

function createPagination() {
  return {
    referrer_host: { page: 1, pageSize: 10 },
    utm_source: { page: 1, pageSize: 10 },
    utm_medium: { page: 1, pageSize: 10 },
    utm_campaign: { page: 1, pageSize: 10 },
  };
}

function createDatabaseMock() {
  const query = vi.fn()
    .mockResolvedValue({ rows: [{ total: 1 }] });

  return {
    database: { query },
    query,
  };
}

function mockSourceQueries(
  query: ReturnType<typeof vi.fn>,
  options: {
    total?: number;
    referrerRows?: Array<{
      source: string | null;
      pv: string | number;
      uv: string | number;
    }>;
  } = {},
) {
  query.mockImplementation(async (sql) => {
    const statement = String(sql);

    // COUNT 查询
    if (statement.includes("SELECT COUNT(*) AS total")) {
      return {
        rows: [{ total: options.total ?? 0 }],
      };
    }

    // referrer_host 统计查询
    if (
      statement.includes("referrer_host AS source") &&
      options.referrerRows
    ) {
      return {
        rows: options.referrerRows,
      };
    }

    // 其他维度默认无数据
    return {
      rows: [],
    };
  });
}

describe("Sources Service", () => {
  it("should query all four source dimensions independently", async () => {
    const { database, query } = createDatabaseMock();

    await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start,
      end,
      pagination: createPagination(),
    });

    expect(query).toHaveBeenCalledTimes(8);
  });

  it("should use the correct source dimension columns", async () => {
    const { database, query } = createDatabaseMock();

    await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start,
      end,
      pagination: createPagination(),
    });

    const sqlStatements = query.mock.calls.map(
      (call) => String(call[0]),
    );

    for (const dimension of dimensions) {
      expect(
        sqlStatements.some((sql) =>
          sql.includes(`GROUP BY ${dimension}`),
        ),
      ).toBe(true);
    }
  });

  it("should preserve NULL source groups", async () => {
    const { database, query } = createDatabaseMock();

    mockSourceQueries(query, {
      total: 1,
      referrerRows: [
        { source: null, pv: "6", uv: "3" },
      ],
    });

    const result = await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start,
      end,
      pagination: createPagination(),
    });

    expect(result.referrer_host.items).toEqual([
      {
        source: null,
        pv: 6,
        uv: 3,
      },
    ]);
  });

  it("should convert PostgreSQL numeric values to numbers", async () => {
    const { database, query } = createDatabaseMock();

    mockSourceQueries(query, {
      total: 2,
      referrerRows: [
        { source: "localhost", pv: "5", uv: "1" },
      ],
    });

    const result = await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start,
      end,
      pagination: createPagination(),
    });

    expect(result.referrer_host.items[0]).toEqual({
      source: "localhost",
      pv: 5,
      uv: 1,
    });
  });

  it("should preserve independent pagination for each dimension", async () => {
    const { database } = createDatabaseMock();

    const pagination = createPagination();

    pagination.referrer_host = { page: 2, pageSize: 5 };
    pagination.utm_source = { page: 1, pageSize: 20 };
    pagination.utm_medium = { page: 3, pageSize: 2 };
    pagination.utm_campaign = { page: 1, pageSize: 10 };

    const result = await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start,
      end,
      pagination,
    });

    expect(result.referrer_host).toMatchObject({
      page: 2,
      pageSize: 5,
    });

    expect(result.utm_source).toMatchObject({
      page: 1,
      pageSize: 20,
    });

    expect(result.utm_medium).toMatchObject({
      page: 3,
      pageSize: 2,
    });
  });

  it("should preserve total when requested page has no records", async () => {
    const { database, query } = createDatabaseMock();

    mockSourceQueries(query, {
      total: 3,
      referrerRows: [],
    });

    const pagination = createPagination();
    pagination.referrer_host = { page: 5, pageSize: 2 };

    const result = await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start,
      end,
      pagination,
    });

    expect(result.referrer_host).toMatchObject({
      items: [],
      total: 3,
      page: 5,
      pageSize: 2,
      totalPages: 2,
    });
  });

  
  it("should return zero totalPages when no groups exist", async () => {
    const { database, query } = createDatabaseMock();

    query.mockImplementation(async (sql) => {
      const statement = String(sql);

      if (statement.includes("COUNT(DISTINCT visitor_id)")) {
        return { rows: [] } as never;
      }

      return { rows: [{ total: 0 }] } as never;
    });

    const result = await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start: new Date("2026-11-20T00:00:00.000Z"),
      end: new Date("2026-11-21T00:00:00.000Z"),
      pagination: createPagination(),
    });

    for (const dimension of dimensions) {
      expect(result[dimension]).toMatchObject({
        items: [],
        total: 0,
        totalPages: 0,
      });
    }
  });


  it("should reject invalid date range", async () => {
    const { database } = createDatabaseMock();

    await expect(
      getSourcesStats({
        database: database as never,
        siteId: siteA,
        start: end,
        end: start,
        pagination: createPagination(),
      }),
    ).rejects.toThrow("Invalid date range");
  });

  it("should reject invalid page number", async () => {
    const { database } = createDatabaseMock();
    const pagination = createPagination();

    pagination.utm_source = { page: 0, pageSize: 10 };

    await expect(
      getSourcesStats({
        database: database as never,
        siteId: siteA,
        start,
        end,
        pagination,
      }),
    ).rejects.toThrow("Invalid page");
  });

  it("should reject pageSize greater than 100", async () => {
    const { database } = createDatabaseMock();
    const pagination = createPagination();

    pagination.utm_campaign = { page: 1, pageSize: 101 };

    await expect(
      getSourcesStats({
        database: database as never,
        siteId: siteA,
        start,
        end,
        pagination,
      }),
    ).rejects.toThrow("Invalid pageSize");
  });

  it("should reject unsafe pagination offset", async () => {
    const { database } = createDatabaseMock();
    const pagination = createPagination();

    pagination.referrer_host = {
      page: Number.MAX_SAFE_INTEGER,
      pageSize: 100,
    };

    await expect(
      getSourcesStats({
        database: database as never,
        siteId: siteA,
        start,
        end,
        pagination,
      }),
    ).rejects.toThrow("Invalid pagination offset");
  });

  it("should reject empty siteId", async () => {
    const { database } = createDatabaseMock();

    await expect(
      getSourcesStats({
        database: database as never,
        siteId: "",
        start,
        end,
        pagination: createPagination(),
      }),
    ).rejects.toThrow("Invalid siteId");
  });

  it("should use parameterized SQL for values", async () => {
    const { database, query } = createDatabaseMock();

    await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start,
      end,
      pagination: createPagination(),
    });

    for (const call of query.mock.calls) {
      const params = call[1] as unknown[];

      expect(params[0]).toBe(siteA);
      expect(params[1]).toBe(start);
      expect(params[2]).toBe(end);
    }
  });

  it("should use deterministic source ordering", async () => {
    const { database, query } = createDatabaseMock();

    await getSourcesStats({
      database: database as never,
      siteId: siteA,
      start,
      end,
      pagination: createPagination(),
    });

    const statsQueries = query.mock.calls
      .filter((call) => String(call[0]).includes("COUNT(DISTINCT visitor_id)"));

    expect(statsQueries).toHaveLength(4);

    for (const [sql] of statsQueries) {
      expect(String(sql)).toContain("COUNT(*) DESC");
      expect(String(sql)).toContain("ASC NULLS LAST");
    }
  });
});

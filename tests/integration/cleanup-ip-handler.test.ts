import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

const LOCAL_DATABASE_URL =
  "postgresql://plv_dev:plv_local_dev_2026@localhost:5433/plv_site_monitor_dev";

let handler: typeof import("../../netlify/functions/cleanup-ip.mts").default;
let pool: typeof import("../../db/client").pool;

beforeAll(async () => {
  process.env.DATABASE_URL ||= LOCAL_DATABASE_URL;

  const databaseUrl = new URL(process.env.DATABASE_URL);

  if (
    !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname !== "/plv_site_monitor_dev"
  ) {
    throw new Error(
      "Cleanup integration tests require the local test database.",
    );
  }

  // 数据库地址通过校验后，才允许加载 Handler
  const handlerModule = await import(
    "../../netlify/functions/cleanup-ip.mts"
  );

  handler = handlerModule.default;

  const databaseModule = await import("../../db/client");

  pool = databaseModule.pool;
});

afterAll(async () => {
  await pool?.end();
});

describe("cleanup-ip scheduled function", () => {
  it("should execute IP cleanup and return cleaned count", async () => {
    const request = new Request(
      "http://localhost/.netlify/functions/cleanup-ip",
      { method: "POST" },
    );

    const response = await handler(request, {} as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const rawResult: unknown = await response.json();

    if (
      typeof rawResult !== "object" ||
      rawResult === null ||
      !("success" in rawResult) ||
      typeof rawResult.success !== "boolean" ||
      !("cleaned_count" in rawResult) ||
      typeof rawResult.cleaned_count !== "number"
    ) {
      throw new Error("Invalid cleanup-ip response");
    }

    const result = rawResult;

    expect(result.success).toBe(true);
    expect(Number.isInteger(result.cleaned_count)).toBe(true);
    expect(result.cleaned_count).toBeGreaterThanOrEqual(0);

    console.log("Cleanup function result:", result);
  });
});

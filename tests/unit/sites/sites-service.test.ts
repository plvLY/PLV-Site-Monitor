
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";
import { updateSite } from "../../../netlify/functions/_shared/sites/sites-service";

const SITE_ID = "accb07ee-6504-4855-b25b-4a5bf22d8164";

type SiteStatus = "active" | "disabled" | "archived";

function createTestDatabase(initialStatus: SiteStatus | null) {
  const query = vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (normalized.includes("SELECT id, status FROM sites")) {
      return {
        rows: initialStatus
          ? [{ id: SITE_ID, status: initialStatus }]
          : [],
        rowCount: initialStatus ? 1 : 0,
      };
    }

    if (normalized.includes("UPDATE sites")) {
      return { rows: [], rowCount: 1 };
    }

    if (normalized.includes("FROM sites s")) {
      return {
        rows: [
          {
            id: SITE_ID,
            name: "Test Site",
            status: initialStatus,
            timezone: "UTC",
            created_at: new Date("2026-01-01T00:00:00.000Z"),
            updated_at: new Date("2026-01-01T00:00:00.000Z"),
            domain_id: null,
            domain: null,
            is_primary: null,
          },
        ],
        rowCount: 1,
      };
    }

    throw new Error(`Unexpected SQL: ${normalized}`);
  });

  const release = vi.fn();

  const client = {
    query,
    release,
  } as unknown as PoolClient;

  const database = {
    connect: vi.fn().mockResolvedValue(client),
  } as never;

  return { database, query, release };
}

describe("updateSite status transitions", () => {
  it.each([
    ["active", "disabled"],
    ["active", "archived"],
    ["disabled", "active"],
    ["disabled", "archived"],
    ["archived", "active"],
  ] as const)(
    "allows %s -> %s",
    async (currentStatus, nextStatus) => {
      const { database, query, release } =
        createTestDatabase(currentStatus);

      const result = await updateSite(database, SITE_ID, {
        status: nextStatus,
      });

      expect(result).not.toBeNull();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE sites"),
        [nextStatus, SITE_ID],
      );

      expect(query).toHaveBeenCalledWith("COMMIT");

      expect(release).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["active", "active"],
    ["disabled", "disabled"],
    ["archived", "archived"],
    ["archived", "disabled"],
  ] as const)(
    "rejects %s -> %s",
    async (currentStatus, nextStatus) => {
      const { database, query, release } =
        createTestDatabase(currentStatus);

      await expect(
        updateSite(database, SITE_ID, {
          status: nextStatus,
        }),
      ).rejects.toMatchObject({
        name: "AnalyticsError",
        code: "INVALID_QUERY",
        status: 400,
      });

      const updateCalled = query.mock.calls.some(
        ([sql]) => sql.includes("UPDATE sites"),
      );

      expect(updateCalled).toBe(false);
      expect(query).toHaveBeenCalledWith("ROLLBACK");
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it("returns null when site does not exist", async () => {
    const { database, query, release } =
      createTestDatabase(null);

    const result = await updateSite(database, SITE_ID, {
      status: "archived",
    });

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("allows editing archived site information without changing status", async () => {
    const { database, query, release } =
      createTestDatabase("archived");

    const result = await updateSite(database, SITE_ID, {
      name: "Archived Site Updated",
    });

    expect(result).not.toBeNull();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE sites"),
      ["Archived Site Updated", SITE_ID],
    );

    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
});


import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({ db: {} }));

vi.mock("drizzle-orm", () => ({
  lt: vi.fn((column, value) => ({ column, value })),
}));

vi.mock("../../db/schema", () => ({
  pageEvents: {
    id: "page_events.id",
    receivedAt: "page_events.received_at",
  },
}));

import { lt } from "drizzle-orm";
import {
  cleanupExpiredEvents,
  MAX_EVENT_RETENTION_DAYS,
  MIN_EVENT_RETENTION_DAYS,
} from "../../netlify/functions/_shared/event-retention";

describe("Event Retention", () => {
  const fixedNow = new Date("2026-11-12T12:00:00.000Z");

  let database: {
    delete: ReturnType<typeof vi.fn>;
  };

  let returning: ReturnType<typeof vi.fn>;
  let where: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    returning = vi.fn().mockResolvedValue([
      { id: 1 },
      { id: 2 },
    ]);

    where = vi.fn().mockReturnValue({ returning });

    database = {
      delete: vi.fn().mockReturnValue({ where }),
    };
  });

  it("uses the configured 90-day retention period", async () => {
    const result = await cleanupExpiredEvents(
      database as never,
      90,
      fixedNow,
    );

    expect(result.cutoff.toISOString()).toBe(
      "2026-08-14T12:00:00.000Z",
    );
    expect(result.deletedCount).toBe(2);
  });

  it("uses the configured 30-day retention period", async () => {
    const result = await cleanupExpiredEvents(
      database as never,
      30,
      fixedNow,
    );

    expect(result.cutoff.toISOString()).toBe(
      "2026-10-13T12:00:00.000Z",
    );
  });

  it("accepts the minimum and maximum retention periods", async () => {
    await expect(
      cleanupExpiredEvents(database as never, MIN_EVENT_RETENTION_DAYS, fixedNow),
    ).resolves.toBeDefined();

    await expect(
      cleanupExpiredEvents(database as never, MAX_EVENT_RETENTION_DAYS, fixedNow),
    ).resolves.toBeDefined();
  });

  it.each([0, 91, -1, 1.5, NaN, Infinity])(
    "rejects invalid retention period: %s",
    async (retentionDays) => {
      await expect(
        cleanupExpiredEvents(
          database as never,
          retentionDays,
          fixedNow,
        ),
      ).rejects.toThrow("Invalid event retention days");

      expect(database.delete).not.toHaveBeenCalled();
    },
  );

  it("deletes only events strictly earlier than the cutoff", async () => {
    const result = await cleanupExpiredEvents(
      database as never,
      30,
      fixedNow,
    );

    expect(database.delete).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();

    expect(lt).toHaveBeenCalledWith(
      "page_events.received_at",
      result.cutoff,
    );
  });

  it("propagates database cleanup errors", async () => {
    where.mockImplementation(() => {
      throw new Error("Database unavailable");
    });

    await expect(
      cleanupExpiredEvents(database as never, 30, fixedNow),
    ).rejects.toThrow("Database unavailable");
  });
});

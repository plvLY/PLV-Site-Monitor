import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({ db: {} }));

import {
  getSystemSettings,
  updateSystemSettings,
} from "../../netlify/functions/_shared/settings/settings-service";

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    eventRetentionDays: 90,
    ipRetentionDays: 30,
    userAgentRetentionDays: 30,
    siteRateLimitMaxRequests: 600,
    storeRawIp: true,
    createdAt: new Date("2026-11-12T00:00:00.000Z"),
    updatedAt: new Date("2026-11-12T00:00:00.000Z"),
    ...overrides,
  };
}

function createDatabase(row = createRow()) {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([row]),
  };

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([row]),
  };

  const insert = vi.fn(() => insertChain);

  return {
    database: {
      insert,
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    } as never,
    insert,
    insertChain,
    selectChain,
    updateChain,
  };
}

describe("system settings service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes the singleton row idempotently and returns the persisted settings", async () => {
    const fake = createDatabase();

    const result = await getSystemSettings(fake.database);

    expect(fake.insert).toHaveBeenCalledOnce();
    expect(fake.insertChain.values).toHaveBeenCalledWith({
      id: 1,
      eventRetentionDays: 90,
      ipRetentionDays: 30,
      userAgentRetentionDays: 30,
      siteRateLimitMaxRequests: 600,
      storeRawIp: true,
    });
    expect(fake.insertChain.onConflictDoNothing).toHaveBeenCalledOnce();
    expect(result).toEqual({
      retention: {
        event_retention_days: 90,
        ip_retention_days: 30,
        user_agent_retention_days: 30,
      },
      privacy: { store_raw_ip: true },
      rate_limit: {
        site_rate_limit_max_requests: 600,
      },
    });
  });

  it("updates only fields included in a partial patch", async () => {
    const updatedRow = createRow({ ipRetentionDays: 14, storeRawIp: false });
    const fake = createDatabase(updatedRow);

    const result = await updateSystemSettings(
      { ipRetentionDays: 14, storeRawIp: false },
      fake.database,
    );

    expect(fake.updateChain.set).toHaveBeenCalledOnce();
    const values = fake.updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.ipRetentionDays).toBe(14);
    expect(values.storeRawIp).toBe(false);
    expect(values).not.toHaveProperty("eventRetentionDays");
    expect(values).not.toHaveProperty("userAgentRetentionDays");
    expect(values.updatedAt).toBeInstanceOf(Date);
    expect(result.retention.ip_retention_days).toBe(14);
    expect(result.privacy.store_raw_ip).toBe(false);
  });
});


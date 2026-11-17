
import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  verifyAdminSession,
  revokeAdminSession,
  type AdminSessionRepository,
} from "../../../netlify/functions/_shared/admin-auth/session";

const NOW = new Date("2026-11-14T12:00:00.000Z");


function createFakeRepository(): AdminSessionRepository & {
  readonly stored: {
    adminUserId: number;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  } | null;
  readonly revoked: boolean;
  readonly lastSeenAt: Date | null;
} {
  const state = {
    stored: null as {
      adminUserId: number;
      tokenHash: string;
      expiresAt: Date;
      createdAt: Date;
    } | null,
    revoked: false,
    lastSeenAt: null as Date | null,
  };

  return {
    get stored() {
      return state.stored;
    },

    get revoked() {
      return state.revoked;
    },

    get lastSeenAt() {
      return state.lastSeenAt;
    },

    async create(input) {
      state.stored = input;
      state.revoked = false;

      return { id: "test-session-id" };
    },

    async findActive(tokenHash, now) {
      if (
        !state.stored ||
        state.stored.tokenHash !== tokenHash ||
        state.revoked ||
        state.stored.expiresAt <= now
      ) {
        return null;
      }

      return {
        sessionId: "test-session-id",
        adminUserId: state.stored.adminUserId,
        username: "admin",
      };
    },

    async touch(sessionId, now) {
      if (
        sessionId !== "test-session-id" ||
        !state.stored ||
        state.revoked ||
        state.stored.expiresAt <= now
      ) {
        return false;
      }

      state.lastSeenAt = now;
      return true;
    },

    async revoke(tokenHash) {
      if (
        !state.stored ||
        state.stored.tokenHash !== tokenHash ||
        state.revoked
      ) {
        return false;
      }

      state.revoked = true;
      return true;
    },
  };
}


describe("admin session", () => {
  it("creates a random 32-byte token and stores only its SHA-256 hash", async () => {
    const repository = createFakeRepository();

    const result = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    expect(Buffer.from(result.token, "base64url")).toHaveLength(32);
    expect(result.sessionId).toBe("test-session-id");

    expect(repository.stored).not.toBeNull();
    expect(repository.stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repository.stored!.tokenHash).not.toBe(result.token);
  });

  it("sets the session expiration to seven days", async () => {
    const repository = createFakeRepository();

    const result = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    expect(result.expiresAt.getTime() - NOW.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it("generates different tokens for separate sessions", async () => {
    const firstRepository = createFakeRepository();
    const secondRepository = createFakeRepository();

    const first = await createAdminSession(1, {
      now: NOW,
      repository: firstRepository,
    });

    const second = await createAdminSession(1, {
      now: NOW,
      repository: secondRepository,
    });

    expect(first.token).not.toBe(second.token);
  });

  it("verifies a valid session and updates lastSeenAt", async () => {
    const repository = createFakeRepository();

    const created = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    const identity = await verifyAdminSession(created.token, {
      now: new Date(NOW.getTime() + 1000),
      repository,
    });

    expect(identity).toEqual({
      sessionId: "test-session-id",
      adminUserId: 1,
      username: "admin",
    });

    expect(repository.lastSeenAt).toEqual(
      new Date(NOW.getTime() + 1000),
    );
  });

  it("rejects an invalid token", async () => {
    const repository = createFakeRepository();

    await expect(
      verifyAdminSession("invalid", {
        now: NOW,
        repository,
      }),
    ).resolves.toBeNull();
  });

  it("rejects a revoked session", async () => {
    const repository = createFakeRepository();

    const created = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    await revokeAdminSession(created.token, {
      now: NOW,
      repository,
    });

    await expect(
      verifyAdminSession(created.token, {
        now: NOW,
        repository,
      }),
    ).resolves.toBeNull();
  });

  it("rejects an expired session", async () => {
    const repository = createFakeRepository();

    const created = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    await expect(
      verifyAdminSession(created.token, {
        now: new Date(created.expiresAt.getTime()),
        repository,
      }),
    ).resolves.toBeNull();
  });

  it("revokes only the matching session token", async () => {
    const repository = createFakeRepository();

    const created = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    await expect(
      revokeAdminSession("invalid", {
        now: NOW,
        repository,
      }),
    ).resolves.toBe(false);

    await expect(
      revokeAdminSession(created.token, {
        now: NOW,
        repository,
      }),
    ).resolves.toBe(true);
  });

  it("fails closed when the repository throws during verification", async () => {
    const repository = createFakeRepository();

    const created = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    const failingRepository: AdminSessionRepository = {
      create: repository.create.bind(repository),
      async findActive() {
        throw new Error("Database unavailable");
      },
      touch: repository.touch.bind(repository),
      revoke: repository.revoke.bind(repository),
    };

    await expect(
      verifyAdminSession(created.token, {
        now: NOW,
        repository: failingRepository,
      }),
    ).resolves.toBeNull();
  });

  it("rejects an invalid administrator ID", async () => {
    const repository = createFakeRepository();

    await expect(
      createAdminSession(0, {
        now: NOW,
        repository,
      }),
    ).rejects.toThrow("Invalid administrator ID.");
  });
    it("rejects a session when repository touch returns false", async () => {
    const repository = createFakeRepository();

    const created = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    const failingTouchRepository: AdminSessionRepository = {
      create: repository.create.bind(repository),
      findActive: repository.findActive.bind(repository),
      async touch() {
        return false;
      },
      revoke: repository.revoke.bind(repository),
    };

    await expect(
      verifyAdminSession(created.token, {
        now: NOW,
        repository: failingTouchRepository,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed when repository touch throws", async () => {
    const repository = createFakeRepository();

    const created = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    const failingTouchRepository: AdminSessionRepository = {
      create: repository.create.bind(repository),
      findActive: repository.findActive.bind(repository),
      async touch() {
        throw new Error("Database unavailable during touch");
      },
      revoke: repository.revoke.bind(repository),
    };

    await expect(
      verifyAdminSession(created.token, {
        now: NOW,
        repository: failingTouchRepository,
      }),
    ).resolves.toBeNull();
  });

  it("propagates repository errors during session revocation", async () => {
    const repository = createFakeRepository();

    const created = await createAdminSession(1, {
      now: NOW,
      repository,
    });

    const failingRevokeRepository: AdminSessionRepository = {
      create: repository.create.bind(repository),
      findActive: repository.findActive.bind(repository),
      touch: repository.touch.bind(repository),
      async revoke() {
        throw new Error("Database unavailable during revoke");
      },
    };

    await expect(
      revokeAdminSession(created.token, {
        now: NOW,
        repository: failingRevokeRepository,
      }),
    ).rejects.toThrow("Database unavailable during revoke");
  });
});

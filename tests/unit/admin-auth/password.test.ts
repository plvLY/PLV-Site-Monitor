
import { describe, expect, it } from "vitest";

import {
  hashPassword,
  verifyPassword,
} from "../../../netlify/functions/_shared/admin-auth/password";

describe("admin password security", () => {
  const password = "PLV-Site-Monitor-Test-Password-2026";

  it("hashes a password successfully", async () => {
    const encodedHash = await hashPassword(password);

    expect(encodedHash).toMatch(
      /^scrypt\$v1\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/,
    );

    expect(encodedHash).not.toContain(password);
  });

  it("verifies the correct password", async () => {
    const encodedHash = await hashPassword(password);

    await expect(
      verifyPassword(password, encodedHash),
    ).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const encodedHash = await hashPassword(password);

    await expect(
      verifyPassword("Wrong-Password-2026", encodedHash),
    ).resolves.toBe(false);
  });

  it("generates different salts for identical passwords", async () => {
    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    expect(firstHash).not.toBe(secondHash);

    const firstParts = firstHash.split("$");
    const secondParts = secondHash.split("$");

    expect(firstParts[5]).not.toBe(secondParts[5]);
  });

  it("rejects an empty password when hashing", async () => {
    await expect(hashPassword("")).rejects.toThrow(
      "Password must not be empty.",
    );
  });

  it("rejects passwords exceeding the maximum length", async () => {
    const oversizedPassword = "a".repeat(1025);

    await expect(
      hashPassword(oversizedPassword),
    ).rejects.toThrow(
      "Password exceeds the maximum allowed length.",
    );
  });

  it.each([
    "",
    "invalid",
    "bcrypt$v1$32768$8$1$salt$hash",
    "scrypt$v2$32768$8$1$salt$hash",
    "scrypt$v1$16384$8$1$salt$hash",
    "scrypt$v1$32768$8$1$invalid$invalid",
    "scrypt$v1$32768$8$1",
  ])("rejects malformed password hash: %s", async (encodedHash) => {
    await expect(
      verifyPassword(password, encodedHash),
    ).resolves.toBe(false);
  });

  it("rejects a corrupted stored hash", async () => {
    const encodedHash = await hashPassword(password);
    const parts = encodedHash.split("$");

    parts[6] = Buffer.alloc(64, 0).toString("base64url");

    await expect(
      verifyPassword(password, parts.join("$")),
    ).resolves.toBe(false);
  });

  it("rejects an empty password during verification", async () => {
    const encodedHash = await hashPassword(password);

    await expect(
      verifyPassword("", encodedHash),
    ).resolves.toBe(false);
  });
});

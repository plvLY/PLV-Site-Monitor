
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

/**
 * Administrator password hashing.
 *
 * Format:
 * scrypt$v1$N$r$p$salt$hash
 *
 * All binary values use base64url encoding.
 */

const ALGORITHM = "scrypt";
const VERSION = "v1";

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

// Node's default scrypt maxmem may be insufficient for our parameters.
const MAX_MEMORY = 64 * 1024 * 1024;

// Prevent unexpectedly large password inputs.
const MAX_PASSWORD_BYTES = 1024;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

interface ParsedPasswordHash {
  salt: Buffer;
  hash: Buffer;
}

/**
 * Derive a password key using Node.js scrypt.
 */
function deriveKey(
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey as Buffer);
      },
    );
  });
}

function validatePasswordInput(password: string): void {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must not be empty.");
  }

  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new Error("Password exceeds the maximum allowed length.");
  }
}

/**
 * Hash a password using scrypt.
 *
 * Every invocation generates a new random salt.
 */
export async function hashPassword(
  password: string,
): Promise<string> {
  validatePasswordInput(password);

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(password, salt);

  return [
    ALGORITHM,
    VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

/**
 * Parse and validate the encoded password hash.
 *
 * Only the currently approved parameters are accepted.
 * This prevents an attacker-controlled hash string from
 * requesting excessive computational resources.
 */
function parsePasswordHash(
  encodedHash: string,
): ParsedPasswordHash | null {
  if (typeof encodedHash !== "string") {
    return null;
  }

  const parts = encodedHash.split("$");

  if (parts.length !== 7) {
    return null;
  }

  const [
    algorithm,
    version,
    n,
    r,
    p,
    encodedSalt,
    encodedKey,
  ] = parts;

  if (
    algorithm !== ALGORITHM ||
    version !== VERSION ||
    n !== String(SCRYPT_N) ||
    r !== String(SCRYPT_R) ||
    p !== String(SCRYPT_P)
  ) {
    return null;
  }

  if (
    !BASE64URL_PATTERN.test(encodedSalt) ||
    !BASE64URL_PATTERN.test(encodedKey)
  ) {
    return null;
  }

  const salt = Buffer.from(encodedSalt, "base64url");
  const hash = Buffer.from(encodedKey, "base64url");

  if (
    salt.length !== SALT_LENGTH ||
    hash.length !== KEY_LENGTH ||
    salt.toString("base64url") !== encodedSalt ||
    hash.toString("base64url") !== encodedKey
  ) {
    return null;
  }

  return { salt, hash };
}

/**
 * Verify a password against a stored password hash.
 *
 * Returns false for invalid or corrupted hash data.
 */
export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES
  ) {
    return false;
  }

  const parsed = parsePasswordHash(encodedHash);

  if (!parsed) {
    return false;
  }

  try {
    const derivedKey = await deriveKey(password, parsed.salt);

    return timingSafeEqual(derivedKey, parsed.hash);
  } catch {
    return false;
  }
}

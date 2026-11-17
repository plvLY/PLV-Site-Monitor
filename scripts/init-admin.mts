import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { hashPassword } from "../netlify/functions/_shared/admin-auth/password.ts";

const MIGRATION_NAME = "20261114134732_add_admin_auth";
const CONTAINER_NAME = "plv-site-monitor-postgres";

function assertLocalDockerContainer(): void {
  let container: any;

  try {
    const output = execFileSync(
      "docker",
      ["inspect", CONTAINER_NAME],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    container = JSON.parse(output)[0];
  } catch {
    throw new Error("DOCKER_CONTAINER_VERIFICATION_FAILED");
  }

  if (
    !container ||
    container.State?.Running !== true ||
    container.Config?.Image !== "postgres:17"
  ) {
    throw new Error("DOCKER_CONTAINER_NOT_APPROVED");
  }

  const mappings = container.NetworkSettings?.Ports?.["5432/tcp"];

  if (
    !Array.isArray(mappings) ||
    mappings.length !== 1 ||
    mappings[0]?.HostIp !== "127.0.0.1" ||
    mappings[0]?.HostPort !== "5433"
  ) {
    throw new Error("DOCKER_PORT_MAPPING_NOT_APPROVED");
  }
}

function validateArguments(): boolean {
  const args = process.argv.slice(2);

  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    throw new Error("INVALID_ARGUMENTS");
  }

  return args[0] === "--apply";
}

async function promptLine(message: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

function promptHidden(message: string): Promise<string> {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    typeof process.stdin.setRawMode !== "function"
  ) {
    throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const decoder = new StringDecoder("utf8");

    let value = "";
    let settled = false;
    let rawModeEnabled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;

      stdin.off("data", onData);
      stdin.off("error", onError);

      try {
        if (rawModeEnabled && stdin.isTTY) {
          stdin.setRawMode(false);
        }
      } catch {
        // Best-effort terminal restoration.
      }

      try {
        process.stdout.write("\n");
      } catch {
        // Ignore terminal output errors during cleanup.
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error("PROMPT_INPUT_FAILED"));
    };

    const onData = (chunk: Buffer) => {
      const input = decoder.write(chunk);

      for (const char of input) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("PROMPT_CANCELLED"));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }

        if (char === "\u007f" || char === "\b") {
          const characters = Array.from(value);
          characters.pop();
          value = characters.join("");
          continue;
        }

        if (char >= " " && char !== "\u007f") {
          value += char;
        }
      }
    };

    try {
      process.stdout.write(message);
      stdin.setRawMode(true);
      rawModeEnabled = true;
      stdin.resume();
      stdin.on("data", onData);
      stdin.once("error", onError);
    } catch {
      cleanup();
      reject(new Error("PROMPT_INPUT_FAILED"));
    }
  });
}

async function main(): Promise<void> {
  const apply = validateArguments();

  const username = (await promptLine("管理员用户名（3-64 位）：")).trim();
  const password = await promptHidden("管理员密码（隐藏输入）：");
  const confirmPassword = await promptHidden("再次输入管理员密码：");

  if (password !== confirmPassword) {
    throw new Error("ADMIN_PASSWORD_MISMATCH");
  }

  if (apply) {
    const confirmation = await promptLine(
      "即将创建超级管理员。输入 CREATE ADMIN 确认：",
    );

    if (confirmation !== "CREATE ADMIN") {
      throw new Error("ADMIN_CREATION_NOT_CONFIRMED");
    }
  }

  if (!username || !password) {
    throw new Error("ADMIN_CREDENTIALS_MISSING");
  }

  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error("INVALID_ADMIN_USERNAME");
  }

  const passwordBytes = Buffer.byteLength(password, "utf8");

  if (passwordBytes < 12 || passwordBytes > 1024) {
    throw new Error("INVALID_ADMIN_PASSWORD_LENGTH");
  }

  const envPath = new URL("../.env", import.meta.url);
  const envFile = fs.readFileSync(envPath, "utf8");

  // dotenv.parse avoids loading or printing any environment secrets.
  const dotenv = await import("dotenv");
  const parsed = dotenv.parse(envFile);

  if (!parsed.DATABASE_URL) {
    throw new Error("DATABASE_URL_MISSING");
  }

  const databaseUrl = new URL(parsed.DATABASE_URL);

  if (
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    Number(databaseUrl.port) !== 5433
  ) {
    throw new Error("DATABASE_TARGET_NOT_APPROVED");
  }

  assertLocalDockerContainer();

  const expectedDatabase = decodeURIComponent(databaseUrl.pathname.slice(1));
  const expectedUser = decodeURIComponent(databaseUrl.username);

  const pool = new Pool({
    connectionString: parsed.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    max: 1,
    application_name: "plv-site-monitor-admin-init",
  });

  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();

    const identity = await client.query(`
      SELECT
        current_database() AS database_name,
        current_user AS username,
        inet_server_port() AS server_port,
        current_setting('server_version') AS server_version
    `);

    const db = identity.rows[0];

    if (
      db.database_name !== expectedDatabase ||
      db.username !== expectedUser ||
      Number(db.server_port) !== 5432 ||
      !db.server_version.startsWith("17.")
    ) {
      throw new Error("DATABASE_IDENTITY_CHECK_FAILED");
    }

    const tables = await client.query(`
      SELECT
        to_regclass('public.admin_users') IS NOT NULL AS users_exists,
        to_regclass('public.admin_sessions') IS NOT NULL AS sessions_exists,
        to_regclass('drizzle.__drizzle_migrations') IS NOT NULL
          AS migration_table_exists
    `);

    const tableState = tables.rows[0];

    if (
      !tableState.users_exists ||
      !tableState.sessions_exists ||
      !tableState.migration_table_exists
    ) {
      throw new Error("ADMIN_AUTH_SCHEMA_NOT_READY");
    }

    const migration = await client.query(
      `SELECT EXISTS (
        SELECT 1
        FROM drizzle.__drizzle_migrations
        WHERE name = $1
      ) AS applied`,
      [MIGRATION_NAME],
    );

    if (!migration.rows[0].applied) {
      throw new Error("ADMIN_AUTH_MIGRATION_NOT_APPLIED");
    }

    const passwordHash = await hashPassword(password);

    if (apply) {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(
        "LOCK TABLE public.admin_users IN EXCLUSIVE MODE",
      );
    } else {
      await client.query("BEGIN READ ONLY");
      transactionStarted = true;
    }

    const existing = await client.query(
      "SELECT id FROM public.admin_users WHERE id = 1",
    );

    if (existing.rowCount !== 0) {
      throw new Error("ADMIN_ALREADY_EXISTS");
    }

    if (!apply) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      console.log("Admin initialization preflight: PASS");
      console.log("Mode: DRY-RUN");
      console.log("Database identity: PASS");
      console.log("Docker container verification: PASS");
      console.log("Admin auth migration: PASS");
      console.log("Admin account available: YES");
      console.log("Password hashing: PASS");
      console.log("Database write: NOT EXECUTED");
      return;
    }

    await client.query(
      `INSERT INTO public.admin_users
        (id, username, password_hash, password_changed_at, created_at, updated_at)
       VALUES (1, $1, $2, NOW(), NOW(), NOW())`,
      [username, passwordHash],
    );

    await client.query("COMMIT");
    transactionStarted = false;

    console.log("Admin account initialization: PASS");
    console.log("Account ID: 1");
    console.log("Database write: COMMITTED");
  } finally {
    if (client) {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => {});
      }
      client.release();
    }

    await pool.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: any) => {
    const safeErrors = new Set([
      "INVALID_ARGUMENTS",
      "ADMIN_CREDENTIALS_MISSING",
      "ADMIN_PASSWORD_MISMATCH",
      "ADMIN_CREATION_NOT_CONFIRMED",
      "INTERACTIVE_TERMINAL_REQUIRED",
      "PROMPT_CANCELLED",
      "PROMPT_INPUT_FAILED",
      "INVALID_ADMIN_USERNAME",
      "INVALID_ADMIN_PASSWORD_LENGTH",
      "DATABASE_URL_MISSING",
      "DATABASE_TARGET_NOT_APPROVED",
      "DOCKER_CONTAINER_VERIFICATION_FAILED",
      "DOCKER_CONTAINER_NOT_APPROVED",
      "DOCKER_PORT_MAPPING_NOT_APPROVED",
      "DATABASE_IDENTITY_CHECK_FAILED",
      "ADMIN_AUTH_SCHEMA_NOT_READY",
      "ADMIN_AUTH_MIGRATION_NOT_APPLIED",
      "ADMIN_ALREADY_EXISTS",
    ]);

    const message = typeof error?.message === "string"
      ? error.message
      : "";

    console.error(
      "Admin initialization failed:",
      safeErrors.has(message) ? message : "INTERNAL_ERROR",
    );

    process.exitCode = 1;
  });
}

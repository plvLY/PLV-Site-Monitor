
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as analyticsSchema from "./analytics-schema";
import * as systemSettingsSchema from "./system-settings-schema";
import * as authSchema from "./auth-schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not configured");
}

export const pool = new Pool({
  connectionString,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle({
  client: pool,
  schema: {
    ...schema,
    ...analyticsSchema,
    ...systemSettingsSchema,
    ...authSchema,
  },
});

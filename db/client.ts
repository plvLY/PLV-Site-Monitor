
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as analyticsSchema from "./analytics-schema";
import * as systemSettingsSchema from "./system-settings-schema";
import * as authSchema from "./auth-schema";
import { getConnectionString } from "@netlify/database";
import { resolveDatabaseConnectionString } from "./connection";

const connectionString = resolveDatabaseConnectionString({
  context: process.env.CONTEXT,
  databaseUrl: process.env.DATABASE_URL,
  netlifyDatabaseUrl: process.env.NETLIFY_DB_URL,
  getNetlifyConnectionString: getConnectionString,
});

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

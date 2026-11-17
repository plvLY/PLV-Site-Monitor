import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured. Please check .env");
}

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./db/schema.ts",
    "./db/analytics-schema.ts",
    "./db/system-settings-schema.ts",
    "./db/auth-schema.ts",
  ],
  out: "netlify/database/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
});

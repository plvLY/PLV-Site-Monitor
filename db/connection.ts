
export interface DatabaseConnectionOptions {
  context: string | undefined;
  databaseUrl: string | undefined;
  netlifyDatabaseUrl?: string | undefined;
  getNetlifyConnectionString: () => string;
}

/**
 * Select the database connection string for the current runtime.
 *
 * - Netlify deployed contexts use Netlify Database.
 * - Netlify runtime with NETLIFY_DB_URL uses Netlify Database.
 * - Local development and Netlify dev use DATABASE_URL.
 */
export function resolveDatabaseConnectionString(
  options: DatabaseConnectionOptions,
): string {
  const {
    context,
    databaseUrl,
    netlifyDatabaseUrl,
    getNetlifyConnectionString,
  } = options;

  if (context === "dev") {
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL environment variable is not configured",
      );
    }

    return databaseUrl;
  }

  if (context && context !== "dev") {
    return getNetlifyConnectionString();
  }

  if (netlifyDatabaseUrl) {
    return getNetlifyConnectionString();
  }

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is not configured",
    );
  }

  return databaseUrl;
}

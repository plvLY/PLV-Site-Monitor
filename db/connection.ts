
export interface DatabaseConnectionOptions {
  context: string | undefined;
  databaseUrl: string | undefined;
  getNetlifyConnectionString: () => string;
}

/**
 * Select the database connection string for the current runtime.
 *
 * - Netlify deployed contexts use Netlify Database.
 * - Local development and tests use DATABASE_URL.
 * - Netlify dev uses the local DATABASE_URL.
 */
export function resolveDatabaseConnectionString(
  options: DatabaseConnectionOptions,
): string {
  const {
    context,
    databaseUrl,
    getNetlifyConnectionString,
  } = options;

  if (context && context !== "dev") {
    return getNetlifyConnectionString();
  }

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is not configured",
    );
  }

  return databaseUrl;
}

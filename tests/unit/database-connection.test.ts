
import { describe, expect, it, vi } from "vitest";

import {
  resolveDatabaseConnectionString,
} from "../../db/connection";

describe("resolveDatabaseConnectionString", () => {
  it("uses DATABASE_URL in local environment", () => {
    const getNetlifyConnectionString = vi.fn();

    const result = resolveDatabaseConnectionString({
      context: undefined,
      databaseUrl: "postgres://localhost/local",
      getNetlifyConnectionString,
    });

    expect(result).toBe("postgres://localhost/local");
    expect(getNetlifyConnectionString).not.toHaveBeenCalled();
  });

  it("uses DATABASE_URL in Netlify dev context", () => {
    const getNetlifyConnectionString = vi.fn();

    const result = resolveDatabaseConnectionString({
      context: "dev",
      databaseUrl: "postgres://localhost/local",
      netlifyDatabaseUrl: "postgres://netlify/local",
      getNetlifyConnectionString,
    });

    expect(result).toBe("postgres://localhost/local");
    expect(getNetlifyConnectionString).not.toHaveBeenCalled();
  });

  it("uses Netlify Database in production context", () => {
    const getNetlifyConnectionString = vi.fn(
      () => "postgres://netlify/production",
    );

    const result = resolveDatabaseConnectionString({
      context: "production",
      databaseUrl: "postgres://localhost/local",
      getNetlifyConnectionString,
    });

    expect(result).toBe("postgres://netlify/production");
    expect(getNetlifyConnectionString).toHaveBeenCalledOnce();
  });

  it("uses Netlify Database in deploy preview context", () => {
    const getNetlifyConnectionString = vi.fn(
      () => "postgres://netlify/preview",
    );

    const result = resolveDatabaseConnectionString({
      context: "deploy-preview",
      databaseUrl: "postgres://localhost/local",
      getNetlifyConnectionString,
    });

    expect(result).toBe("postgres://netlify/preview");
    expect(getNetlifyConnectionString).toHaveBeenCalledOnce();
  });

  it("uses Netlify Database when context is missing but NETLIFY_DB_URL exists", () => {
    const getNetlifyConnectionString = vi.fn(
      () => "postgres://netlify/production",
    );

    const result = resolveDatabaseConnectionString({
      context: undefined,
      databaseUrl: undefined,
      netlifyDatabaseUrl: "postgres://netlify/production",
      getNetlifyConnectionString,
    });

    expect(result).toBe("postgres://netlify/production");
    expect(getNetlifyConnectionString).toHaveBeenCalledOnce();
  });

  it("prefers Netlify Database over DATABASE_URL when context is missing", () => {
    const getNetlifyConnectionString = vi.fn(
      () => "postgres://netlify/production",
    );

    const result = resolveDatabaseConnectionString({
      context: undefined,
      databaseUrl: "postgres://localhost/local",
      netlifyDatabaseUrl: "postgres://netlify/production",
      getNetlifyConnectionString,
    });

    expect(result).toBe("postgres://netlify/production");
    expect(getNetlifyConnectionString).toHaveBeenCalledOnce();
  });

  it("throws when local DATABASE_URL is missing", () => {
    expect(() =>
      resolveDatabaseConnectionString({
        context: undefined,
        databaseUrl: undefined,
        getNetlifyConnectionString: vi.fn(),
      }),
    ).toThrow("DATABASE_URL environment variable is not configured");
  });

  it("does not fall back to DATABASE_URL in deployed contexts", () => {
    const getNetlifyConnectionString = vi.fn(() => {
      throw new Error("Netlify Database connection is unavailable");
    });

    expect(() =>
      resolveDatabaseConnectionString({
        context: "production",
        databaseUrl: "postgres://localhost/local",
        getNetlifyConnectionString,
      }),
    ).toThrow("Netlify Database connection is unavailable");
  });
});

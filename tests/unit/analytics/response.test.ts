import { describe, expect, it } from "vitest";

import {
  errorResponse,
  jsonError,
  jsonSuccess,
  successResponse,
  methodNotAllowedResponse,
} from "../../../netlify/functions/_shared/analytics/response";
import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";

async function bodyText(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

describe("response", () => {
  describe("jsonSuccess", () => {
    it("builds unified success JSON", () => {
      const result = JSON.parse(jsonSuccess({ id: 1 }, { page: 1 }));

      expect(result).toEqual({
        success: true,
        data: { id: 1 },
        meta: { page: 1 },
      });
    });
  });

  describe("jsonError", () => {
    it("builds unified error JSON without stack", () => {
      const error = new AnalyticsError("INVALID_QUERY", "Bad query.");

      const result = JSON.parse(jsonError(error));

      expect(result).toEqual({
        success: false,
        error: {
          code: "INVALID_QUERY",
          message: "Bad query.",
        },
      });
      expect(result.error).not.toHaveProperty("stack");
    });
  });

  describe("successResponse", () => {
    it("sets JSON Content-Type and status", async () => {
      const response = successResponse({ ok: true }, { version: 1 }, 201);

      expect(response.status).toBe(201);
      expect(response.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );

      const body = await bodyText(response);

      expect(body).toEqual({
        success: true,
        data: { ok: true },
        meta: { version: 1 },
      });
    });
  });

  describe("errorResponse", () => {
    it("maps error code to HTTP status", async () => {
      const error = new AnalyticsError("UNAUTHORIZED", "Auth required.");
      const response = errorResponse(error);

      expect(response.status).toBe(401);
      expect(response.headers.get("Content-Type")).toBe(
        "application/json; charset=utf-8",
      );

      const body = (await bodyText(response)) as { success: boolean; error: { code: string; message: string } };

      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("Auth required.");
    });

    it.each([
      ["INVALID_QUERY", 400],
      ["INVALID_DATE_RANGE", 400],
      ["INVALID_TIMEZONE", 400],
      ["UNAUTHORIZED", 401],
      ["SITE_ACCESS_DENIED", 403],
      ["SITE_NOT_FOUND", 404],
      ["INTERNAL_ERROR", 500],
    ])("maps %s to status %d", async (code, status) => {
      const error = new AnalyticsError(code as any, "message");
      const response = errorResponse(error);

      expect(response.status).toBe(status);
    });
  });
});

describe("methodNotAllowedResponse", () => {
  it("should return HTTP 405", () => {
    const response = methodNotAllowedResponse();

    expect(response.status).toBe(405);
  });

  it("should return JSON content type", () => {
    const response = methodNotAllowedResponse();

    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("should return the unified error body", async () => {
    const response = methodNotAllowedResponse();

    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: "INVALID_QUERY",
        message: "Only GET requests are supported.",
      },
    });
  });
});

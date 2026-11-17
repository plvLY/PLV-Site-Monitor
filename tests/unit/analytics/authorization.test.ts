import { describe, expect, it, vi } from "vitest";

import {
  Authorization,
  DEFAULT_SITE_AUTHORIZATION,
  UNAUTHENTICATED_CONTEXT,
} from "../../../netlify/functions/_shared/analytics/authorization";
import { AnalyticsError } from "../../../netlify/functions/_shared/analytics/errors";

describe("Authorization", () => {
  describe("defaults", () => {
    it("defaults to unauthenticated context", () => {
      const auth = new Authorization();

      expect(auth.getContext()).toBe(UNAUTHENTICATED_CONTEXT);
      expect(auth.isAuthenticated()).toBe(false);
    });

    it("defaults site authorization to deny all", async () => {
      const auth = new Authorization();

      await expect(auth.canAccessSite("any-site")).resolves.toBe(false);
    });

    it("rejects unauthenticated site access with UNAUTHORIZED", async () => {
      const auth = new Authorization();

      await expect(auth.requireSiteAccess("site-1")).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("custom auth context", () => {
    it("uses injected authenticated context", () => {
      const auth = new Authorization({
        authContext: { userId: "user-1", authenticated: true },
      });

      expect(auth.isAuthenticated()).toBe(true);
      expect(auth.getContext().userId).toBe("user-1");
    });
  });

  describe("mock site authorization", () => {
    it("allows access when mock grants permission", async () => {
      const auth = new Authorization({
        authContext: { userId: "user-1", authenticated: true },
        siteAuthorization: {
          checkSiteAccess: () => true,
        },
      });

      await expect(auth.canAccessSite("site-1")).resolves.toBe(true);
      await expect(auth.requireSiteAccess("site-1")).resolves.toBeUndefined();
    });

    it("denies access when mock rejects permission", async () => {
      const auth = new Authorization({
        authContext: { userId: "user-1", authenticated: true },
        siteAuthorization: {
          checkSiteAccess: () => false,
        },
      });

      await expect(auth.canAccessSite("site-1")).resolves.toBe(false);
      await expect(auth.requireSiteAccess("site-1")).rejects.toMatchObject({
        code: "SITE_ACCESS_DENIED",
      });
    });

    it("supports async mock authorization", async () => {
      const checkSiteAccess = vi.fn().mockResolvedValue(true);

      const auth = new Authorization({
        authContext: { userId: "user-1", authenticated: true },
        siteAuthorization: { checkSiteAccess },
      });

      await expect(auth.canAccessSite("site-1")).resolves.toBe(true);
      expect(checkSiteAccess).toHaveBeenCalledWith(
        "site-1",
        expect.objectContaining({ userId: "user-1" }),
      );
    });

    it("denies access when authenticated but site authorization throws", async () => {
      const auth = new Authorization({
        authContext: { userId: "user-1", authenticated: true },
        siteAuthorization: {
          checkSiteAccess: () => {
            throw new Error("boom");
          },
        },
      });

      await expect(auth.requireSiteAccess("site-1")).rejects.toThrow("boom");
    });
  });

  describe("DEFAULT_SITE_AUTHORIZATION", () => {
    it("denies all sites by default", () => {
      expect(
        DEFAULT_SITE_AUTHORIZATION.checkSiteAccess(
          "any",
          UNAUTHENTICATED_CONTEXT,
        ),
      ).toBe(false);
    });
  });
});


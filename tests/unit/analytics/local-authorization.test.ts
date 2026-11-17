import { afterEach, describe, expect, it, vi } from "vitest";

import { createAnalyticsAuthorization } from "../../../netlify/functions/_shared/analytics/local-authorization";

const ALLOWED_SITE_ID = "accb07ee-6504-4855-b25b-4a5bf22d8164";
const SECOND_SITE_ID = "33333333-3333-4333-8333-333333333333";
const DENIED_SITE_ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createAnalyticsAuthorization", () => {
  it("allows a whitelisted site in explicitly enabled local dev", async () => {
    vi.stubEnv("CONTEXT", "dev");
    vi.stubEnv("PLV_ANALYTICS_LOCAL_AUTH", "true");
    vi.stubEnv(
      "PLV_ANALYTICS_LOCAL_SITE_IDS",
      ` ${ALLOWED_SITE_ID}, ${SECOND_SITE_ID} `,
    );

    const auth = createAnalyticsAuthorization();

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getContext().userId).toBe("local-analytics-test");

    await expect(auth.requireSiteAccess(ALLOWED_SITE_ID)).resolves.toBeUndefined();
    await expect(auth.requireSiteAccess(SECOND_SITE_ID)).resolves.toBeUndefined();
  });

  it("denies a site outside the local whitelist", async () => {
    vi.stubEnv("CONTEXT", "dev");
    vi.stubEnv("PLV_ANALYTICS_LOCAL_AUTH", "true");
    vi.stubEnv("PLV_ANALYTICS_LOCAL_SITE_IDS", ALLOWED_SITE_ID);

    const auth = createAnalyticsAuthorization();

    await expect(auth.requireSiteAccess(DENIED_SITE_ID)).rejects.toMatchObject({
      code: "SITE_ACCESS_DENIED",
    });
  });

  it("rejects access when local authorization is not enabled", async () => {
    vi.stubEnv("CONTEXT", "dev");
    vi.stubEnv("PLV_ANALYTICS_LOCAL_AUTH", "false");
    vi.stubEnv("PLV_ANALYTICS_LOCAL_SITE_IDS", ALLOWED_SITE_ID);

    const auth = createAnalyticsAuthorization();

    expect(auth.isAuthenticated()).toBe(false);

    await expect(auth.requireSiteAccess(ALLOWED_SITE_ID)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it.each(["production", "deploy-preview"])(
    "rejects local authorization in %s context",
    async (context) => {
      vi.stubEnv("CONTEXT", context);
      vi.stubEnv("PLV_ANALYTICS_LOCAL_AUTH", "true");
      vi.stubEnv("PLV_ANALYTICS_LOCAL_SITE_IDS", ALLOWED_SITE_ID);

      const auth = createAnalyticsAuthorization();

      expect(auth.isAuthenticated()).toBe(false);

      await expect(auth.requireSiteAccess(ALLOWED_SITE_ID)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    },
  );

  it("rejects access when Netlify context is empty", async () => {
    vi.stubEnv("CONTEXT", "");
    vi.stubEnv("PLV_ANALYTICS_LOCAL_AUTH", "true");
    vi.stubEnv("PLV_ANALYTICS_LOCAL_SITE_IDS", ALLOWED_SITE_ID);

    const auth = createAnalyticsAuthorization();

    await expect(auth.requireSiteAccess(ALLOWED_SITE_ID)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

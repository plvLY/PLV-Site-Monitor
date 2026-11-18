import { describe, expect, it } from "vitest";
import { AnalyticsError } from "../../netlify/functions/_shared/analytics/errors";
import { validateSettingsPatch } from "../../netlify/functions/_shared/settings/settings-validator";

describe("system settings validator", () => {
  it("accepts a valid partial retention update", () => {
    expect(
      validateSettingsPatch({
        retention: {
          event_retention_days: 60,
        },
      }),
    ).toEqual({
      eventRetentionDays: 60,
    });
  });

  it("accepts disabling raw IP storage without changing Geo settings", () => {
    expect(
      validateSettingsPatch({
        privacy: {
          store_raw_ip: false,
        },
      }),
    ).toEqual({
      storeRawIp: false,
    });
  });

  it.each([
    ["event_retention_days", 91],
    ["ip_retention_days", 31],
    ["user_agent_retention_days", 31],
  ])("rejects retention above the maximum: %s", (field, value) => {
    const error = (() => {
      try {
        validateSettingsPatch({
          retention: { [field]: value },
        });
      } catch (caught) {
        return caught;
      }
      throw new Error("Expected validation to fail.");
    })();

    expect(error).toBeInstanceOf(AnalyticsError);
    expect((error as AnalyticsError).code).toBe("RETENTION_LIMIT_EXCEEDED");
  });

  it.each([0, -1, 1.5, "7", null])(
    "rejects invalid retention values: %s",
    (value) => {
      expect(() =>
        validateSettingsPatch({
          retention: {
            ip_retention_days: value,
          },
        }),
      ).toThrow(AnalyticsError);
    },
  );

  it("rejects unknown root fields", () => {
    expect(() =>
      validateSettingsPatch({
        retention: { ip_retention_days: 7 },
        admin_password: "not-allowed",
      }),
    ).toThrow("Unknown settings field");
  });

  it("rejects unknown nested fields", () => {
    expect(() =>
      validateSettingsPatch({
        privacy: {
          store_raw_ip: false,
          store_geo: false,
        },
      }),
    ).toThrow("Unknown settings field");
  });

  it("rejects non-boolean privacy values", () => {
    expect(() =>
      validateSettingsPatch({
        privacy: {
          store_raw_ip: "false",
        },
      }),
    ).toThrow("store_raw_ip must be a boolean");
  });


  it("accepts a valid partial site rate limit update", () => {
    expect(
      validateSettingsPatch({
        rate_limit: {
          site_rate_limit_max_requests: 300,
        },
      }),
    ).toEqual({
      siteRateLimitMaxRequests: 300,
    });
  });

  it.each([1, 10000])(
    "accepts site rate limit boundary value: %s",
    (value) => {
      expect(
        validateSettingsPatch({
          rate_limit: {
            site_rate_limit_max_requests: value,
          },
        }),
      ).toEqual({
        siteRateLimitMaxRequests: value,
      });
    },
  );

  it.each([0, -1, 10001, 1.5, "600", null])(
    "rejects invalid site rate limit values: %s",
    (value) => {
      expect(() =>
        validateSettingsPatch({
          rate_limit: {
            site_rate_limit_max_requests: value,
          },
        }),
      ).toThrow(AnalyticsError);
    },
  );

  it("rejects unknown rate limit fields", () => {
    expect(() =>
      validateSettingsPatch({
        rate_limit: {
          site_rate_limit_max_requests: 600,
          window_seconds: 60,
        },
      }),
    ).toThrow("Unknown settings field");
  });

  it("rejects non-object rate limit values", () => {
    expect(() =>
      validateSettingsPatch({
        rate_limit: "600",
      }),
    ).toThrow("rate_limit must be an object");
  });

  it("rejects empty rate limit objects", () => {
    expect(() =>
      validateSettingsPatch({
        rate_limit: {},
      }),
    ).toThrow(AnalyticsError);
  });


  it("rejects empty patches and empty nested objects", () => {
    expect(() => validateSettingsPatch({})).toThrow(AnalyticsError);
    expect(() => validateSettingsPatch({ retention: {} })).toThrow(AnalyticsError);
    expect(() => validateSettingsPatch({ privacy: {} })).toThrow(AnalyticsError);
  });

  it("rejects null and non-object payloads", () => {
    expect(() => validateSettingsPatch(null)).toThrow(AnalyticsError);
    expect(() => validateSettingsPatch([])).toThrow(AnalyticsError);
    expect(() => validateSettingsPatch("invalid")).toThrow(AnalyticsError);
  });
});

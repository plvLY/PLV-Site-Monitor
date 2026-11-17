
import { analyticsDailyMemberships } from "../../../../db/analytics-schema";

export type AnalyticsMembershipDimension =
  | "overview"
  | "page"
  | "referrer_host"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "browser"
  | "os"
  | "device_type"
  | "location";

export type AnalyticsMembershipSubjectType = "visitor" | "session";

export interface InsertDailyMembershipInput {
  siteId: string;
  statDate: string;
  timezone: string;
  dimension: AnalyticsMembershipDimension;
  dimensionKey: string;
  subjectType: AnalyticsMembershipSubjectType;
  subjectKey: string;
  subjectKeyVersion: number;
}

/**
 * Insert one daily membership.
 *
 * Returns:
 * - true: a new membership was inserted
 * - false: the membership already existed
 *
 * The database unique constraint is the final authority
 * for deduplication, including concurrent requests.
 */
export async function insertDailyMembership(
  tx: any,
  input: InsertDailyMembershipInput,
): Promise<boolean> {
  if (!input.siteId) {
    throw new Error("Membership siteId is required");
  }

  if (!input.statDate || !input.timezone) {
    throw new Error("Membership statDate and timezone are required");
  }

  if (!input.dimensionKey || input.dimensionKey.length > 64) {
    throw new Error("Membership dimensionKey must contain 1-64 characters");
  }

  if (!input.subjectKey || input.subjectKey.length !== 64) {
    throw new Error("Membership subjectKey must contain exactly 64 characters");
  }

  if (
    !Number.isInteger(input.subjectKeyVersion) ||
    input.subjectKeyVersion <= 0
  ) {
    throw new Error("Membership subjectKeyVersion must be a positive integer");
  }

  const inserted = await tx
    .insert(analyticsDailyMemberships)
    .values(input)
    .onConflictDoNothing({
      target: [
        analyticsDailyMemberships.siteId,
        analyticsDailyMemberships.statDate,
        analyticsDailyMemberships.timezone,
        analyticsDailyMemberships.dimension,
        analyticsDailyMemberships.dimensionKey,
        analyticsDailyMemberships.subjectType,
        analyticsDailyMemberships.subjectKeyVersion,
        analyticsDailyMemberships.subjectKey,
      ],
    })
    .returning({
      subjectKey: analyticsDailyMemberships.subjectKey,
    });

  return inserted.length > 0;
}


import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import {
  analyticsDailyOverview,
  analyticsDailyPages,
  analyticsDailySources,
  analyticsDailyDevices,
  analyticsDailyLocations,
} from "../../../../db/analytics-schema";

import { insertDailyMembership } from "./membership";

export interface WritePageViewAggregatesInput {
  siteId: string;
  statDate: string;
  timezone: string;

  visitorKey: string;
  visitorKeyVersion: number;

  sessionKey: string;
  sessionKeyVersion: number;

  pagePath: string;

  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;

  browser: string | null;
  os: string | null;
  deviceType: string | null;

  countryCode: string | null;
  region: string | null;
  city: string | null;
}

function createDimensionKey(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

async function upsertOverview(
  tx: any,
  input: WritePageViewAggregatesInput,
  visitorAdded: boolean,
  sessionAdded: boolean,
) {
  await tx
    .insert(analyticsDailyOverview)
    .values({
      siteId: input.siteId,
      statDate: input.statDate,
      timezone: input.timezone,
      pageViews: 1n,
      visitors: visitorAdded ? 1n : 0n,
      sessions: sessionAdded ? 1n : 0n,
    })
    .onConflictDoUpdate({
      target: [
        analyticsDailyOverview.siteId,
        analyticsDailyOverview.statDate,
        analyticsDailyOverview.timezone,
      ],
      set: {
        pageViews: sql`${analyticsDailyOverview.pageViews} + 1`,
        visitors: sql`${analyticsDailyOverview.visitors} + ${visitorAdded ? 1 : 0}`,
        sessions: sql`${analyticsDailyOverview.sessions} + ${sessionAdded ? 1 : 0}`,
        updatedAt: new Date(),
      },
    });
}

async function upsertDimension(
  tx: any,
  table: any,
  values: Record<string, unknown>,
  target: any[],
  visitorAdded: boolean,
) {
  await tx
    .insert(table)
    .values({
      ...values,
      pageViews: 1n,
      uniqueVisitors: visitorAdded ? 1n : 0n,
    })
    .onConflictDoUpdate({
      target,
      set: {
        pageViews: sql`${table.pageViews} + 1`,
        uniqueVisitors: sql`${table.uniqueVisitors} + ${visitorAdded ? 1 : 0}`,
        updatedAt: new Date(),
      },
    });
}

async function writeSourceDimension(
  tx: any,
  input: WritePageViewAggregatesInput,
  dimension: string,
  value: string | null,
) {
  const dimensionKey = createDimensionKey([dimension, value]);

  const visitorAdded = await insertDailyMembership(tx, {
    siteId: input.siteId,
    statDate: input.statDate,
    timezone: input.timezone,
    dimension: dimension as any,
    dimensionKey,
    subjectType: "visitor",
    subjectKey: input.visitorKey,
    subjectKeyVersion: input.visitorKeyVersion,
  });

  await upsertDimension(
    tx,
    analyticsDailySources,
    {
      siteId: input.siteId,
      statDate: input.statDate,
      timezone: input.timezone,
      dimension,
      dimensionKey,
      dimensionValue: value,
    },
    [
      analyticsDailySources.siteId,
      analyticsDailySources.statDate,
      analyticsDailySources.timezone,
      analyticsDailySources.dimension,
      analyticsDailySources.dimensionKey,
    ],
    visitorAdded,
  );
}

async function writeDeviceDimension(
  tx: any,
  input: WritePageViewAggregatesInput,
  dimension: string,
  value: string | null,
) {
  const dimensionKey = createDimensionKey([dimension, value]);

  const visitorAdded = await insertDailyMembership(tx, {
    siteId: input.siteId,
    statDate: input.statDate,
    timezone: input.timezone,
    dimension: dimension as any,
    dimensionKey,
    subjectType: "visitor",
    subjectKey: input.visitorKey,
    subjectKeyVersion: input.visitorKeyVersion,
  });

  await upsertDimension(
    tx,
    analyticsDailyDevices,
    {
      siteId: input.siteId,
      statDate: input.statDate,
      timezone: input.timezone,
      dimension,
      dimensionKey,
      dimensionValue: value,
    },
    [
      analyticsDailyDevices.siteId,
      analyticsDailyDevices.statDate,
      analyticsDailyDevices.timezone,
      analyticsDailyDevices.dimension,
      analyticsDailyDevices.dimensionKey,
    ],
    visitorAdded,
  );
}

export async function writePageViewAggregates(
  tx: any,
  input: WritePageViewAggregatesInput,
): Promise<void> {
  const overviewVisitorAdded = await insertDailyMembership(tx, {
    siteId: input.siteId,
    statDate: input.statDate,
    timezone: input.timezone,
    dimension: "overview",
    dimensionKey: "all",
    subjectType: "visitor",
    subjectKey: input.visitorKey,
    subjectKeyVersion: input.visitorKeyVersion,
  });

  const overviewSessionAdded = await insertDailyMembership(tx, {
    siteId: input.siteId,
    statDate: input.statDate,
    timezone: input.timezone,
    dimension: "overview",
    dimensionKey: "all",
    subjectType: "session",
    subjectKey: input.sessionKey,
    subjectKeyVersion: input.sessionKeyVersion,
  });

  await upsertOverview(
    tx,
    input,
    overviewVisitorAdded,
    overviewSessionAdded,
  );

  // Pages
  const pageDimensionKey = createDimensionKey([input.pagePath]);

  const pageVisitorAdded = await insertDailyMembership(tx, {
    siteId: input.siteId,
    statDate: input.statDate,
    timezone: input.timezone,
    dimension: "page",
    dimensionKey: pageDimensionKey,
    subjectType: "visitor",
    subjectKey: input.visitorKey,
    subjectKeyVersion: input.visitorKeyVersion,
  });

  await upsertDimension(
    tx,
    analyticsDailyPages,
    {
      siteId: input.siteId,
      statDate: input.statDate,
      timezone: input.timezone,
      pagePath: input.pagePath,
    },
    [
      analyticsDailyPages.siteId,
      analyticsDailyPages.statDate,
      analyticsDailyPages.timezone,
      analyticsDailyPages.pagePath,
    ],
    pageVisitorAdded,
  );

  // Sources
  await writeSourceDimension(
    tx,
    input,
    "referrer_host",
    input.referrerHost,
  );

  await writeSourceDimension(tx, input, "utm_source", input.utmSource);
  await writeSourceDimension(tx, input, "utm_medium", input.utmMedium);
  await writeSourceDimension(tx, input, "utm_campaign", input.utmCampaign);

  // Devices
  await writeDeviceDimension(tx, input, "browser", input.browser);
  await writeDeviceDimension(tx, input, "os", input.os);
  await writeDeviceDimension(tx, input, "device_type", input.deviceType);

  // Location
  const locationDimensionKey = createDimensionKey([
    input.countryCode,
    input.region,
    input.city,
  ]);

  const locationVisitorAdded = await insertDailyMembership(tx, {
    siteId: input.siteId,
    statDate: input.statDate,
    timezone: input.timezone,
    dimension: "location",
    dimensionKey: locationDimensionKey,
    subjectType: "visitor",
    subjectKey: input.visitorKey,
    subjectKeyVersion: input.visitorKeyVersion,
  });

  await upsertDimension(
    tx,
    analyticsDailyLocations,
    {
      siteId: input.siteId,
      statDate: input.statDate,
      timezone: input.timezone,
      countryCode: input.countryCode,
      region: input.region,
      city: input.city,
      dimensionKey: locationDimensionKey,
    },
    [
      analyticsDailyLocations.siteId,
      analyticsDailyLocations.statDate,
      analyticsDailyLocations.timezone,
      analyticsDailyLocations.dimensionKey,
    ],
    locationVisitorAdded,
  );
}

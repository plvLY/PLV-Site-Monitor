
import type { Pool, PoolClient } from "pg";

import { AnalyticsError } from "../analytics/errors";

export interface SiteDomainItem {
  domain: string;
  is_primary: boolean;
}

export interface SiteListItem {
  id: string;
  name: string;
  status: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  domains: SiteDomainItem[];
}

export interface SiteWriteInput {
  name?: string;
  timezone?: string;
  status?: "active" | "disabled" | "archived";
  domains?: SiteDomainItem[];
}

interface SiteRow {
  id: string;
  name: string;
  status: string;
  timezone: string;
  created_at: Date;
  updated_at: Date;
  domain_id: string | null;
  domain: string | null;
  is_primary: boolean | null;
}

type Database = Pick<Pool, "query" | "connect">;

type SiteStatus = "active" | "disabled" | "archived";

const ALLOWED_STATUS_TRANSITIONS: Record<
  SiteStatus,
  readonly SiteStatus[]
> = {
  active: ["disabled", "archived"],
  disabled: ["active", "archived"],
  archived: ["active"],
};

function mapSiteRows(rows: SiteRow[]): SiteListItem[] {
  const sites = new Map<string, SiteListItem>();

  for (const row of rows) {
    let site = sites.get(row.id);

    if (!site) {
      site = {
        id: row.id,
        name: row.name,
        status: row.status,
        timezone: row.timezone,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        domains: [],
      };

      sites.set(row.id, site);
    }

    if (
      row.domain_id !== null &&
      row.domain !== null &&
      row.is_primary !== null
    ) {
      site.domains.push({
        domain: row.domain,
        is_primary: row.is_primary,
      });
    }
  }

  return Array.from(sites.values());
}

async function getSiteById(
  database: Pick<Pool, "query"> | PoolClient,
  siteId: string,
): Promise<SiteListItem | null> {
  const result = await database.query<SiteRow>(
    `
    SELECT
      s.id,
      s.name,
      s.status,
      s.timezone,
      s.created_at,
      s.updated_at,
      d.id AS domain_id,
      d.domain,
      d.is_primary
    FROM sites s
    LEFT JOIN site_domains d
      ON d.site_id = s.id
    WHERE s.id = $1
    ORDER BY d.is_primary DESC NULLS LAST, d.domain ASC
    `,
    [siteId],
  );

  return mapSiteRows(result.rows)[0] ?? null;
}

export async function getAllSites(
  database: Pick<Pool, "query">,
): Promise<SiteListItem[]> {
  const result = await database.query<SiteRow>(
    `
    SELECT
      s.id,
      s.name,
      s.status,
      s.timezone,
      s.created_at,
      s.updated_at,
      d.id AS domain_id,
      d.domain,
      d.is_primary
    FROM sites s
    LEFT JOIN site_domains d
      ON d.site_id = s.id
    ORDER BY
      s.created_at DESC,
      s.id ASC,
      d.is_primary DESC NULLS LAST,
      d.domain ASC
    `,
  );

  return mapSiteRows(result.rows);
}

async function replaceDomains(
  client: PoolClient,
  siteId: string,
  domains: SiteDomainItem[],
): Promise<void> {
  await client.query(
    `DELETE FROM site_domains WHERE site_id = $1`,
    [siteId],
  );

  for (const domain of domains) {
    await client.query(
      `
      INSERT INTO site_domains (
        site_id,
        domain,
        is_primary
      )
      VALUES ($1, $2, $3)
      `,
      [siteId, domain.domain, domain.is_primary],
    );
  }
}

export async function createSite(
  database: Database,
  input: Required<Pick<SiteWriteInput, "name" | "timezone">> &
    Pick<SiteWriteInput, "domains">,
): Promise<SiteListItem> {
  const client = await database.connect();

  try {
    await client.query("BEGIN");

    const inserted = await client.query<{ id: string }>(
      `
      INSERT INTO sites (name, timezone)
      VALUES ($1, $2)
      RETURNING id
      `,
      [input.name, input.timezone],
    );

    const siteId = inserted.rows[0].id;

    if (input.domains !== undefined) {
      await replaceDomains(client, siteId, input.domains);
    }

    const site = await getSiteById(client, siteId);

    if (!site) {
      throw new Error("Created site could not be retrieved.");
    }

    await client.query("COMMIT");

    return site;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSite(
  database: Database,
  siteId: string,
  input: SiteWriteInput,
): Promise<SiteListItem | null> {
  const client = await database.connect();

  try {
    await client.query("BEGIN");

    const current = await client.query<{
      id: string;
      status: SiteStatus;
    }>(
      `SELECT id, status FROM sites WHERE id = $1 FOR UPDATE`,
      [siteId],
    );

    if (current.rowCount === 0 || !current.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    // 仅在请求修改 status 时检查状态转换。
    // 普通名称、时区、域名修改不受站点状态限制。
    if (input.status !== undefined) {
      const currentStatus = current.rows[0].status;
      const allowedStatuses = ALLOWED_STATUS_TRANSITIONS[currentStatus];

      if (!allowedStatuses?.includes(input.status)) {
        throw new AnalyticsError(
          "INVALID_QUERY",
          `Cannot change site status from "${currentStatus}" to "${input.status}".`,
        );
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      values.push(input.name);
      updates.push(`name = $${values.length}`);
    }

    if (input.timezone !== undefined) {
      values.push(input.timezone);
      updates.push(`timezone = $${values.length}`);
    }

    if (input.status !== undefined) {
      values.push(input.status);
      updates.push(`status = $${values.length}`);
    }

    if (updates.length > 0) {
      updates.push("updated_at = NOW()");
      values.push(siteId);

      await client.query(
        `
        UPDATE sites
        SET ${updates.join(", ")}
        WHERE id = $${values.length}
        `,
        values,
      );
    }

    if (input.domains !== undefined) {
      await replaceDomains(client, siteId, input.domains);
    }

    const site = await getSiteById(client, siteId);

    await client.query("COMMIT");

    return site;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../../db/client", () => ({
  pool: {},
}));

vi.mock("../../../netlify/functions/_shared/sites/sites-service", () => ({
  getAllSites: vi.fn(),
  createSite: vi.fn(),
  updateSite: vi.fn(),
}));

import { Authorization } from "../../../netlify/functions/_shared/analytics/authorization";
import {
  getAllSites,
  createSite,
  updateSite,
  type SiteListItem,
} from "../../../netlify/functions/_shared/sites/sites-service";
import { createSitesHandler } from "../../../netlify/functions/sites.mts";

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

interface SitesListSuccessBody {
  success: true;
  data: {
    items: Record<string, unknown>[];
  };
  meta: Record<string, unknown>;
}

interface SitesItemSuccessBody {
  success: true;
  data: {
    item: Record<string, unknown>;
  };
}

interface SitesErrorBody {
  success: false;
  error: {
    code: string;
  };
}

async function readSitesListSuccessJson(
  response: Response,
): Promise<SitesListSuccessBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    !Array.isArray(body.data.items) ||
    !body.data.items.every(isRecord) ||
    !isRecord(body.meta)
  ) {
    throw new Error("Invalid sites list success response");
  }

  return {
    success: true,
    data: {
      items: body.data.items,
    },
    meta: body.meta,
  };
}

async function readSitesItemSuccessJson(
  response: Response,
): Promise<SitesItemSuccessBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.data) ||
    !isRecord(body.data.item)
  ) {
    throw new Error("Invalid sites item success response");
  }

  return {
    success: true,
    data: {
      item: body.data.item,
    },
  };
}

async function readSitesErrorJson(
  response: Response,
): Promise<SitesErrorBody> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== false ||
    !isRecord(body.error) ||
    typeof body.error.code !== "string"
  ) {
    throw new Error("Invalid sites error response");
  }

  return {
    success: false,
    error: {
      code: body.error.code,
    },
  };
}
const SITE_A: SiteListItem = {
  id: "accb07ee-6504-4855-b25b-4a5bf22d8164",
  name: "Local Test Site",
  status: "active",
  timezone: "UTC",
  created_at: "2026-11-05T12:01:25.369Z",
  updated_at: "2026-11-05T12:01:25.369Z",
  domains: [{ domain: "localhost", is_primary: true }],
};

const SITE_B: SiteListItem = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "New Test Site",
  status: "active",
  timezone: "UTC",
  created_at: "2026-11-13T12:00:00.000Z",
  updated_at: "2026-11-13T12:00:00.000Z",
  domains: [{ domain: "new.example.com", is_primary: true }],
};

const originalContext = process.env.CONTEXT;

function createAuthorization(authenticated = true) {
  return new Authorization({
    authContext: {
      userId: authenticated ? "local-test-admin" : null,
      authenticated,
    },
    siteAuthorization: {
      checkSiteAccess: () => false,
    },
  });
}

function createHandler(authenticated = true) {
  return createSitesHandler({
    database: {} as never,
    authorization: createAuthorization(authenticated),
  });
}

function createRequest(
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
  query = "",
  origin: string | null = "http://localhost",
) {
  return new Request(`http://localhost/api/sites${query}`, {
    method,
    headers: {
      ...(origin !== null ? { Origin: origin } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Sites API handler", () => {
  beforeEach(() => {
    process.env.CONTEXT = "dev";

    vi.clearAllMocks();

    vi.mocked(getAllSites).mockResolvedValue([SITE_A, SITE_B]);
    vi.mocked(createSite).mockResolvedValue(SITE_B);
    vi.mocked(updateSite).mockResolvedValue(SITE_B);
  });

  afterEach(() => {
    if (originalContext === undefined) {
      delete process.env.CONTEXT;
    } else {
      process.env.CONTEXT = originalContext;
    }
  });

  it("returns sites outside the Analytics site allowlist", async () => {
    const handler = createHandler(true);

    const response = await handler(createRequest("GET"));

    const body = await readSitesListSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.map((site) => site.id)).toEqual([
      SITE_A.id,
      SITE_B.id,
    ]);
    expect(body.meta.total).toBe(2);

    expect(getAllSites).toHaveBeenCalledTimes(1);
  });

  it("paginates the complete site list and calculates total correctly", async () => {
    const handler = createHandler(true);

    const response = await handler(
      createRequest("GET", undefined, "?page=2&page_size=1"),
    );

    const body = await readSitesListSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual([SITE_B]);
    expect(body.meta).toMatchObject({
      page: 2,
      page_size: 1,
      total: 2,
      total_pages: 2,
    });
  });

  it("updates a site outside the Analytics site allowlist", async () => {
    const handler = createHandler(true);

    const response = await handler(
      createRequest("PATCH", {
        site_id: SITE_B.id,
        name: "Updated Test Site",
      }),
    );

    const body = await readSitesItemSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.item).toEqual(SITE_B);

    expect(updateSite).toHaveBeenCalledWith(
      expect.anything(),
      SITE_B.id,
      { name: "Updated Test Site" },
    );
  });

  it("creates a site and returns the created item", async () => {
    const handler = createHandler(true);

    const response = await handler(
      createRequest("POST", {
        name: "New Test Site",
      }),
    );

    const body = await readSitesItemSuccessJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.item).toEqual(SITE_B);

    expect(createSite).toHaveBeenCalledWith(
      expect.anything(),
      {
        name: "New Test Site",
        timezone: "UTC",
        domains: undefined,
      },
    );
  });

  it("rejects an invalid site ID in PATCH requests", async () => {
    const handler = createHandler(true);

    const response = await handler(
      createRequest("PATCH", {
        site_id: "invalid-id",
        name: "Updated Site",
      }),
    );

    const body = await readSitesErrorJson(response);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(updateSite).not.toHaveBeenCalled();
  });

  it("rejects POST requests with an invalid Origin", async () => {
    const handler = createHandler(true);

    const response = await handler(
      createRequest(
        "POST",
        { name: "Rejected Site" },
        "",
        "https://evil.example",
      ),
    );

    const body = await readSitesErrorJson(response);

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CSRF_REJECTED");
    expect(createSite).not.toHaveBeenCalled();
  });

  it("rejects PATCH requests with a missing Origin", async () => {
    const handler = createHandler(true);

    const response = await handler(
      createRequest(
        "PATCH",
        {
          site_id: SITE_B.id,
          name: "Rejected Update",
        },
        "",
        null,
      ),
    );

    const body = await readSitesErrorJson(response);

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CSRF_REJECTED");
    expect(updateSite).not.toHaveBeenCalled();
  });

  it("rejects requests without a session through the production authorization path", async () => {
    const handler = createSitesHandler({
      database: {} as never,
    });

    const response = await handler(createRequest("GET"));
    const body = await readSitesErrorJson(response);

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(getAllSites).not.toHaveBeenCalled();
  });
  it.each(["dev", "production", "deploy-preview"])(
    "rejects unauthenticated requests in %s context",
    async (context) => {
      process.env.CONTEXT = context;

      const handler = createHandler(false);

      const response = await handler(createRequest("GET"));
      const body = await readSitesErrorJson(response);

      expect(response.status).toBe(401);
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(getAllSites).not.toHaveBeenCalled();
    },
  );
});
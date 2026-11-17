import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageViewEvent } from "../../src/events/types";
import { createFetchSender } from "../../src/transport/fetch-sender";

const ENDPOINT = "https://example.com/api/collect";

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mockEvent: PageViewEvent = {
  event_id: "accb07ee-6504-4855-b25b-4a5bf22d8164",
  event_type: "page_view",
  visitor_id: "22222222-2222-4222-8222-222222222222",
  session_id: "33333333-3333-4333-8333-333333333333",
  page_url: "https://example.com/products",
  page_title: "Products",
  page_path: "/products",
  referrer: "https://google.com/",
  referrer_host: "google.com",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "summer",
  utm_term: null,
  utm_content: null,
  occurred_at: "2026-11-07T10:00:00.000Z",
};

function createMockFetcher(status: number) {
  return vi.fn().mockResolvedValue(
    new Response(null, { status })
  ) as unknown as typeof fetch;
}

describe("createFetchSender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("SEND-01: should accept a PageViewEvent", async () => {
    const fetcher = createMockFetcher(202);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    const result = await sender.send(mockEvent);

    expect(result.status).toBe("accepted");
  });

  it("SEND-02: should use the configured endpoint", async () => {
    const fetcher = createMockFetcher(202);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    await sender.send(mockEvent);

    expect(fetcher).toHaveBeenCalledWith(
      ENDPOINT,
      expect.any(Object)
    );
  });

  it("SEND-03: should send a POST request", async () => {
    const fetcher = createMockFetcher(202);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    await sender.send(mockEvent);

    expect(fetcher).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("SEND-04: should use application/json", async () => {
    const fetcher = createMockFetcher(202);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    await sender.send(mockEvent);

    expect(fetcher).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
        },
      })
    );
  });

  it("SEND-05: should include site_id and the complete event as JSON", async () => {
    const fetcher = createMockFetcher(202);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    await sender.send(mockEvent);

    const requestOptions = vi.mocked(fetcher).mock.calls[0][1];
    const body = JSON.parse(requestOptions?.body as string);

    expect(body).toEqual({
      site_id: SITE_ID,
      ...mockEvent,
    });

    expect(body.site_id).toBe(SITE_ID);
    expect(body.event_type).toBe("page_view");
    expect(body.event_id).toBe(mockEvent.event_id);
    expect(body.visitor_id).toBe(mockEvent.visitor_id);
    expect(body.session_id).toBe(mockEvent.session_id);
    expect(body.page_url).toBe(mockEvent.page_url);
  });

  it("SEND-06: should treat HTTP 202 as accepted", async () => {
    const fetcher = createMockFetcher(202);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    const result = await sender.send(mockEvent);

    expect(result).toEqual({
      status: "accepted",
      httpStatus: 202,
    });
  });

  it("SEND-07: should treat HTTP 200 as duplicate success", async () => {
    const fetcher = createMockFetcher(200);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    const result = await sender.send(mockEvent);

    expect(result).toEqual({
      status: "duplicate",
      httpStatus: 200,
    });
  });

  it("SEND-08: should classify 4xx as client errors", async () => {
    const statuses = [400, 403, 404, 413];

    for (const status of statuses) {
      const fetcher = createMockFetcher(status);
      const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

      const result = await sender.send(mockEvent);

      expect(result).toEqual({
        status: "client_error",
        httpStatus: status,
        errorCode: `HTTP_${status}`,
      });
    }
  });

  it("SEND-09: should classify 5xx as server errors", async () => {
    const fetcher = createMockFetcher(500);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    const result = await sender.send(mockEvent);

    expect(result).toEqual({
      status: "server_error",
      httpStatus: 500,
      errorCode: "HTTP_500",
    });
  });

  it("SEND-10: should classify unexpected HTTP responses as server errors", async () => {
    const fetcher = createMockFetcher(204);
    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    const result = await sender.send(mockEvent);

    expect(result).toEqual({
      status: "server_error",
      httpStatus: 204,
      errorCode: "HTTP_204",
    });
  });

  it("SEND-11: should handle network errors without throwing", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      new TypeError("Failed to fetch")
    ) as unknown as typeof fetch;

    const sender = createFetchSender(ENDPOINT, SITE_ID, fetcher);

    await expect(sender.send(mockEvent)).resolves.toEqual({
      status: "network_error",
      httpStatus: null,
      errorCode: "NETWORK_ERROR",
    });
  });
});
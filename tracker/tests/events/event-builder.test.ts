
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPageViewEvent } from "../../src/events/event-builder";

describe("buildPageViewEvent", () => {
  const identity = {
    visitorId: "accb07ee-6504-4855-b25b-4a5bf22d8164",
    sessionId: "22222222-2222-4222-8222-222222222222",
  };

  const metadata = {
    page_url: "https://example.com/products",
    page_title: "Products",
    page_path: "/products",
    referrer: "https://google.com/",
    referrer_host: "google.com",
  };

  const utm = {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "spring",
    utm_term: "coffee",
    utm_content: "banner",
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("EVT-BUILD-01: builds a complete PageViewEvent", () => {
    const event = buildPageViewEvent(identity, metadata, utm);

    expect(event).toMatchObject({
      event_type: "page_view",
      visitor_id: identity.visitorId,
      session_id: identity.sessionId,
      ...metadata,
      ...utm,
    });

    expect(event.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    expect(event.occurred_at).toBeTruthy();
  });

  it("EVT-BUILD-02: generates a unique event ID", () => {
    const first = buildPageViewEvent(identity, metadata, utm);
    const second = buildPageViewEvent(identity, metadata, utm);

    expect(first.event_id).not.toBe(second.event_id);
  });

  it("EVT-BUILD-03: uses the supplied identity", () => {
    const event = buildPageViewEvent(identity, metadata, utm);

    expect(event.visitor_id).toBe(identity.visitorId);
    expect(event.session_id).toBe(identity.sessionId);
  });

  it("EVT-BUILD-04: supports null referrer and UTM values", () => {
    const event = buildPageViewEvent(
      identity,
      {
        ...metadata,
        referrer: null,
        referrer_host: null,
      },
      {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
      }
    );

    expect(event.referrer).toBeNull();
    expect(event.referrer_host).toBeNull();
    expect(event.utm_source).toBeNull();
    expect(event.utm_medium).toBeNull();
    expect(event.utm_campaign).toBeNull();
    expect(event.utm_term).toBeNull();
    expect(event.utm_content).toBeNull();
  });

  it("EVT-BUILD-05: generates occurred_at in ISO UTC format", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T10:00:00.000Z"));

    const event = buildPageViewEvent(identity, metadata, utm);

    expect(event.occurred_at).toBe("2026-11-07T10:00:00.000Z");
  });

  it("EVT-BUILD-06: does not modify input data", () => {
    const identityCopy = structuredClone(identity);
    const metadataCopy = structuredClone(metadata);
    const utmCopy = structuredClone(utm);

    buildPageViewEvent(identity, metadata, utm);

    expect(identity).toEqual(identityCopy);
    expect(metadata).toEqual(metadataCopy);
    expect(utm).toEqual(utmCopy);
  });
});

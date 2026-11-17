
import type { Identity } from "../types";
import type { PageViewEvent } from "./types";
import type { PageMetadata } from "./page-metadata";
import type { UtmParams } from "./utm";

import { generateEventId } from "./event-id";

export function buildPageViewEvent(
  identity: Identity,
  metadata: PageMetadata,
  utm: UtmParams
): PageViewEvent {
  return {
    event_id: generateEventId(),
    event_type: "page_view",

    visitor_id: identity.visitorId,
    session_id: identity.sessionId,

    page_url: metadata.page_url,
    page_title: metadata.page_title,
    page_path: metadata.page_path,

    referrer: metadata.referrer,
    referrer_host: metadata.referrer_host,

    utm_source: utm.utm_source,
    utm_medium: utm.utm_medium,
    utm_campaign: utm.utm_campaign,
    utm_term: utm.utm_term,
    utm_content: utm.utm_content,

    occurred_at: new Date().toISOString(),
  };
}

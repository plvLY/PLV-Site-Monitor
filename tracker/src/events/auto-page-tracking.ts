
import type { IdentityManager } from "../types";
import type { PageViewEvent } from "./types";

import { buildPageViewEvent } from "./event-builder";
import { collectPageMetadata } from "./page-metadata";
import { collectUtmParams } from "./utm";
import { subscribeRouteChange } from "./route-listener";

export type PageViewCallback = (event: PageViewEvent) => void;

export function startAutoPageTracking(
  identityManager: IdentityManager,
  callback: PageViewCallback
): () => void {
  let previousUrl: string | null = null;

  const trackPageView = () => {
    const metadata = collectPageMetadata();

    // SPA navigation uses the previous virtual page as referrer.
    if (previousUrl !== null) {
      metadata.referrer = previousUrl;

      try {
        metadata.referrer_host = new URL(previousUrl).host;
      } catch {
        metadata.referrer_host = null;
      }
    }

    const event = buildPageViewEvent(
      identityManager.getIdentity(),
      metadata,
      collectUtmParams(metadata.page_url)
    );

    callback(event);

    previousUrl = metadata.page_url;
  };

  // Track the initial page.
  trackPageView();

  // Track subsequent SPA navigation.
  const unsubscribe = subscribeRouteChange(() => {
    trackPageView();
  });

  return unsubscribe;
}

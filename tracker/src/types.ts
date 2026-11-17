import type { PageViewEvent } from "./events/types";
import type { SendResult } from "./transport/types";

export interface Identity {
  visitorId: string;
  sessionId: string;
}

export interface IdentityManager {
  getIdentity(): Identity;
  getVisitorId(): string;
  getSessionId(): string;
}

export interface TrackerOptions {
  siteId: string;
  endpoint: string;
  debug?: boolean;
}

export interface TrackerConfig {
  siteId: string;
  endpoint: string;
  debug: boolean;
}

export interface TrackerInstance {
  getIdentity(): Identity;
  getVisitorId(): string;
  getSessionId(): string;

  startPageTracking(
    onSendResult?: PageViewSendCallback
  ): () => void;
}

export type PageViewSendCallback = (
  event: PageViewEvent,
  result: SendResult
) => void;

import type {
  Identity,
  IdentityManager,
  TrackerConfig,
  TrackerInstance,
} from "../types";

import { createIdentityManager } from "../identity";
import { createFetchSender } from "../transport/fetch-sender";
import { startAutoPageTracking } from "../events/auto-page-tracking";

import type { EventSender } from "../transport/types";
import type { PageViewSendCallback } from "../types";

export class Tracker implements TrackerInstance {
  private readonly identityManager: IdentityManager;

  private readonly eventSender: EventSender;

  private stopPageTracking: (() => void) | null = null;

  constructor(
    public readonly config: Readonly<TrackerConfig>
  ) {
    this.identityManager = createIdentityManager();

    this.eventSender = createFetchSender(
      this.config.endpoint,
      this.config.siteId
    );
  }

  getIdentity(): Identity {
    return this.identityManager.getIdentity();
  }

  getVisitorId(): string {
    return this.identityManager.getVisitorId();
  }

  getSessionId(): string {
    return this.identityManager.getSessionId();
  }

  startPageTracking(
    onSendResult?: PageViewSendCallback
  ): () => void {
    if (this.stopPageTracking) {
      return this.stopPageTracking;
    }

    const unsubscribe = startAutoPageTracking(
      this.identityManager,
      (event) => {
        void this.eventSender
          .send(event)
          .then((result) => {
            if (!onSendResult) return;

            try {
              onSendResult(event, result);
            } catch (error) {
              if (this.config.debug) {
                console.error(
                  "[PLV Tracker] Send result callback error:",
                  error
                );
              }
            }
          })
          .catch((error) => {
            if (this.config.debug) {
              console.error(
                "[PLV Tracker] Unexpected sender error:",
                error
              );
            }
          });
      }
    );

    let stopped = false;

    const stop = (): void => {
      if (stopped) {
        return;
      }

      stopped = true;
      unsubscribe();

      if (this.stopPageTracking === stop) {
        this.stopPageTracking = null;
      }
    };

    this.stopPageTracking = stop;

    return stop;
  }
}
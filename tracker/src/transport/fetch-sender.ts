import type { PageViewEvent } from "../events/types";
import type { EventSender, SendResult } from "./types";

export function createFetchSender(
  endpoint: string,
  siteId: string,
  fetcher: typeof fetch = globalThis.fetch
): EventSender {
  return {
    async send(event: PageViewEvent): Promise<SendResult> {
      try {
        const payload = {
          site_id: siteId,
          ...event,
        };

        const response = await fetcher(endpoint, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 202) {
          return {
            status: "accepted",
            httpStatus: 202,
          };
        }

        if (response.status === 200) {
          return {
            status: "duplicate",
            httpStatus: 200,
          };
        }

        if (response.status >= 400 && response.status < 500) {
          return {
            status: "client_error",
            httpStatus: response.status,
            errorCode: `HTTP_${response.status}`,
          };
        }

        return {
          status: "server_error",
          httpStatus: response.status,
          errorCode: `HTTP_${response.status}`,
        };
      } catch {
        return {
          status: "network_error",
          httpStatus: null,
          errorCode: "NETWORK_ERROR",
        };
      }
    },
  };
}
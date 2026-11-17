import type { PageViewEvent } from "../events/types";

export type SendStatus =
  | "accepted"
  | "duplicate"
  | "client_error"
  | "server_error"
  | "network_error";

export interface SendResult {
  status: SendStatus;
  httpStatus: number | null;
  errorCode?: string;
}

export interface EventSender {
  send(event: PageViewEvent): Promise<SendResult>;
}
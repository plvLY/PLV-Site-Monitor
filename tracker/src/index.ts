export const TRACKER_VERSION = "0.1.0";

export { createIdentityManager } from "./identity";

export { Tracker } from "./core/tracker";

export {
  TrackerConfigError,
  TrackerConfigConflictError,
} from "./core/errors";

export type {
  Identity,
  IdentityManager,
  TrackerOptions,
  TrackerConfig,
  TrackerInstance,
  PageViewSendCallback,
} from "./types";

export { init } from "./core/init";

export { createFetchSender } from "./transport/fetch-sender";

export type {
  EventSender,
  SendResult,
  SendStatus,
} from "./transport/types";
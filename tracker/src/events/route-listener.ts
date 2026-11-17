
export type RouteChangeCallback = (url: string) => void;

const callbacks = new Set<RouteChangeCallback>();

let installed = false;

let originalPushState: History["pushState"];
let originalReplaceState: History["replaceState"];

let wrappedPushState: History["pushState"];
let wrappedReplaceState: History["replaceState"];

let lastUrl = "";

function notifyRouteChange(): void {
  const currentUrl = window.location.href;

  if (currentUrl === lastUrl) {
    return;
  }

  lastUrl = currentUrl;

  callbacks.forEach((callback) => {
    callback(currentUrl);
  });
}

function installListeners(): void {
  if (installed) {
    return;
  }

  const history = window.history;

  originalPushState = history.pushState;
  originalReplaceState = history.replaceState;

  wrappedPushState = function (
    this: History,
    ...args: Parameters<History["pushState"]>
  ): void {
    originalPushState.apply(this, args);
    notifyRouteChange();
  };

  wrappedReplaceState = function (
    this: History,
    ...args: Parameters<History["replaceState"]>
  ): void {
    originalReplaceState.apply(this, args);
    notifyRouteChange();
  };

  history.pushState = wrappedPushState;
  history.replaceState = wrappedReplaceState;

  window.addEventListener("popstate", notifyRouteChange);
  window.addEventListener("hashchange", notifyRouteChange);

  lastUrl = window.location.href;
  installed = true;
}

function uninstallListeners(): void {
  if (!installed) {
    return;
  }

  const history = window.history;

  // Only restore methods if they are still our wrappers.
  if (history.pushState === wrappedPushState) {
    history.pushState = originalPushState;
  }

  if (history.replaceState === wrappedReplaceState) {
    history.replaceState = originalReplaceState;
  }

  window.removeEventListener("popstate", notifyRouteChange);
  window.removeEventListener("hashchange", notifyRouteChange);

  installed = false;
}

export function subscribeRouteChange(
  callback: RouteChangeCallback
): () => void {
  callbacks.add(callback);

  if (callbacks.size === 1) {
    installListeners();
  }

  return () => {
    callbacks.delete(callback);

    if (callbacks.size === 0) {
      uninstallListeners();
    }
  };
}

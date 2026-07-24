/** Extension APIs are only available in extension contexts (not the page). */
export function getExtensionRuntime(): typeof chrome.runtime | null {
  try {
    // Content scripts expose extension APIs on the `chrome` global — not always on globalThis.chrome.
    const api =
      typeof chrome !== "undefined"
        ? chrome
        : (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome;
    const runtime = api?.runtime;
    // After an extension reload, runtime.id can linger while sendMessage is removed.
    if (runtime?.id && typeof runtime.sendMessage === "function") {
      return runtime;
    }
    return null;
  } catch {
    return null;
  }
}

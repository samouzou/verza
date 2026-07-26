const CHANNEL = "verza-optic-extension";
const PING_TIMEOUT_MS = 4000;
const READY_WAIT_MS = 5000;
const PING_RETRIES = 3;

export type OpticExtensionStatus = {
  installed: boolean;
  version?: string;
  running?: boolean;
  jobId?: string | null;
  needsRefresh?: boolean;
  error?: string;
};

type BridgeResponse = {
  channel?: string;
  requestId?: string;
  ok?: boolean;
  version?: string;
  running?: boolean;
  jobId?: string | null;
  error?: string;
};

function postToExtension<T extends Record<string, unknown>>(
  message: T
): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now());

    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("extension_timeout"));
    }, PING_TIMEOUT_MS);

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      try {
        if (event.origin !== window.location.origin) return;
      } catch {
        /* ignore */
      }
      const data = event.data as BridgeResponse;
      if (data?.channel !== CHANNEL || data.requestId !== requestId) return;
      // postMessage echoes to this same window, so the request we are about to
      // send arrives here too, carrying the requestId we are waiting on. Only
      // replies from the extension set `ok`, which is what tells them apart.
      if (typeof data.ok !== "boolean") return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(data);
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ channel: CHANNEL, requestId, ...message }, "*");
  });
}

function readExtensionMarker(): OpticExtensionStatus | null {
  const version = document.documentElement.getAttribute("data-verza-optic-extension");
  if (!version) return null;
  return { installed: true, version };
}

function waitForExtensionReady(): Promise<OpticExtensionStatus | null> {
  const marker = readExtensionMarker();
  if (marker) return Promise.resolve(marker);

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(readExtensionMarker());
    }, READY_WAIT_MS);

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { channel?: string; type?: string; version?: string };
      if (data?.channel !== CHANNEL || data.type !== "VERZA_OPTIC_READY") return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve({
        installed: true,
        version: data.version ?? readExtensionMarker()?.version,
      });
    }

    window.addEventListener("message", onMessage);
  });
}

async function pingOnce(): Promise<BridgeResponse> {
  return postToExtension({ type: "VERZA_OPTIC_PING" });
}

/** Returns whether the Verza Optic Chrome extension is installed and reachable. */
export async function pingOpticExtension(): Promise<OpticExtensionStatus> {
  if (typeof window === "undefined") {
    return { installed: false };
  }

  const ready = await waitForExtensionReady();
  if (ready?.installed) {
    return ready;
  }

  for (let attempt = 0; attempt < PING_RETRIES; attempt += 1) {
    try {
      const res = await pingOnce();
      if (res.ok) {
        return {
          installed: true,
          version: res.version ?? readExtensionMarker()?.version,
          running: res.running,
          jobId: res.jobId ?? null,
        };
      }
      const stale = res.error?.toLowerCase().includes("reload");
      if (stale) {
        return {
          installed: true,
          version: readExtensionMarker()?.version,
          needsRefresh: true,
          error: res.error,
        };
      }
    } catch {
      const marker = readExtensionMarker();
      if (marker) {
        return marker;
      }
    }

    if (attempt < PING_RETRIES - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  }

  const marker = readExtensionMarker();
  if (marker) {
    return { ...marker, needsRefresh: true, error: "Extension did not respond. Refresh this page." };
  }
  return { installed: false };
}

/** Ask the extension to run an Instagram mission in the user's browser. */
export async function startOpticExtensionJob(params: {
  jobId: string;
  idToken: string;
  projectId: string;
  useFunctionsEmulator?: boolean;
}): Promise<void> {
  const res = await postToExtension({
    type: "VERZA_OPTIC_START_JOB",
    jobId: params.jobId,
    idToken: params.idToken,
    projectId: params.projectId,
    useFunctionsEmulator: params.useFunctionsEmulator === true,
  });
  if (!res.ok) {
    throw new Error(res.error || "Could not start the Chrome extension mission.");
  }
}

export type OpticExtensionLiveProgress = {
  jobId?: string;
  phase?: string;
  message?: string;
  discovered?: number;
  target?: number;
};

/** Subscribe to live extension progress while the Optic tab is open. */
export function subscribeOpticExtensionProgress(
  onProgress: (progress: OpticExtensionLiveProgress) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  function onMessage(event: MessageEvent) {
    if (event.source !== window) return;
    const data = event.data as {
      channel?: string;
      type?: string;
      jobId?: string;
      phase?: string;
      message?: string;
      discovered?: number;
      target?: number;
    };
    if (data?.channel !== CHANNEL || data.type !== "VERZA_OPTIC_PROGRESS") return;
    onProgress({
      jobId: data.jobId,
      phase: data.phase,
      message: data.message,
      discovered: data.discovered,
      target: data.target,
    });
  }

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

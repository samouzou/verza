import type { ExtensionMessage, ExtensionResponse } from "../shared/types";
import { EXTENSION_VERSION } from "../shared/types";
import { getExtensionRuntime } from "../shared/runtime";

const CHANNEL = "verza-optic-extension";
const HANDLER_KEY = "__verzaOpticBridgeHandler__";

function respond(requestId: string, payload: Omit<ExtensionResponse, "requestId">) {
  window.postMessage({ channel: CHANNEL, requestId, ...payload }, "*");
}

function isFromThisPage(event: MessageEvent): boolean {
  if (event.source !== window) return false;
  try {
    return event.origin === window.location.origin;
  } catch {
    return true;
  }
}

function sendToBackground<T>(message: object): Promise<T> {
  const runtime = getExtensionRuntime();
  if (!runtime) {
    return Promise.reject(new Error("extension_context_invalidated"));
  }
  return new Promise((resolve, reject) => {
    runtime.sendMessage(message, (response) => {
      const err = runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as T);
    });
  });
}

function announceReady() {
  document.documentElement.setAttribute("data-verza-optic-extension", EXTENSION_VERSION);
  window.postMessage(
    { channel: CHANNEL, type: "VERZA_OPTIC_READY", version: EXTENSION_VERSION },
    "*"
  );
}

function respondToPing(requestId: string) {
  respond(requestId, {
    ok: true,
    version: EXTENSION_VERSION,
    running: false,
    jobId: null,
  });

  const runtime = getExtensionRuntime();
  if (!runtime) return;

  void sendToBackground<{ version?: string; running?: boolean; jobId?: string | null }>({
    type: "OPTIC_GET_STATUS",
  })
    .then((status) => {
      respond(requestId, {
        ok: true,
        version: status?.version ?? EXTENSION_VERSION,
        running: Boolean(status?.running),
        jobId: status?.jobId ?? null,
      });
    })
    .catch(() => {
      /* keep the initial installed response */
    });
}

function onPageMessage(event: MessageEvent) {
  if (!isFromThisPage(event)) return;
  const data = event.data as ExtensionMessage & { channel?: string };
  if (data?.channel !== CHANNEL) return;

  const requestId = data.requestId;
  if (!requestId) return;

  if (data.type === "VERZA_OPTIC_PING") {
    respondToPing(requestId);
    return;
  }

  if (data.type === "VERZA_OPTIC_START_JOB") {
    if (!getExtensionRuntime()) {
      respond(requestId, {
        ok: false,
        error: "Extension was reloaded. Refresh this page and try again.",
      });
      return;
    }

    void sendToBackground<{ ok?: boolean; error?: string }>({
      type: "OPTIC_START_JOB",
      jobId: data.jobId,
      idToken: data.idToken,
      projectId: data.projectId,
      useFunctionsEmulator: data.useFunctionsEmulator === true,
    })
      .then((result) => {
        if (result?.ok === false) {
          respond(requestId, { ok: false, error: result.error || "Extension failed to start" });
          return;
        }
        respond(requestId, { ok: true, running: true, jobId: data.jobId });
      })
      .catch((e) => {
        respond(requestId, {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return;
  }

  if (data.type === "VERZA_OPTIC_GET_STATUS") {
    if (!getExtensionRuntime()) {
      respond(requestId, {
        ok: true,
        version: EXTENSION_VERSION,
        running: false,
        jobId: null,
      });
      return;
    }

    void sendToBackground<{ version?: string; running?: boolean; jobId?: string | null }>({
      type: "OPTIC_GET_STATUS",
    })
      .then((status) => {
        respond(requestId, {
          ok: true,
          version: status?.version ?? EXTENSION_VERSION,
          running: Boolean(status?.running),
          jobId: status?.jobId ?? null,
        });
      })
      .catch(() => {
        respond(requestId, {
          ok: true,
          version: EXTENSION_VERSION,
          running: false,
          jobId: null,
        });
      });
  }
}

function installBridge() {
  const win = window as unknown as Record<string, EventListener | undefined>;
  const existing = win[HANDLER_KEY];
  if (existing) {
    window.removeEventListener("message", existing);
  }

  win[HANDLER_KEY] = onPageMessage;
  window.addEventListener("message", onPageMessage);
  announceReady();
}

installBridge();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "OPTIC_PROGRESS_BROADCAST") return;
  window.postMessage(
    {
      channel: CHANNEL,
      type: "VERZA_OPTIC_PROGRESS",
      jobId: message.jobId,
      phase: message.phase,
      message: message.message,
      discovered: message.discovered,
      target: message.target,
    },
    "*"
  );
});

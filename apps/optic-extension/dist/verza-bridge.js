"use strict";
(() => {
  // src/shared/types.ts
  var EXTENSION_VERSION = "0.2.0";

  // src/shared/runtime.ts
  function getExtensionRuntime() {
    try {
      const api = typeof chrome !== "undefined" ? chrome : globalThis.chrome;
      const runtime = api?.runtime;
      if (runtime?.id && typeof runtime.sendMessage === "function") {
        return runtime;
      }
      return null;
    } catch {
      return null;
    }
  }

  // src/content/verza-bridge.ts
  var CHANNEL = "verza-optic-extension";
  var HANDLER_KEY = "__verzaOpticBridgeHandler__";
  function respond(requestId, payload) {
    window.postMessage({ channel: CHANNEL, requestId, ...payload }, "*");
  }
  function isFromThisPage(event) {
    if (event.source !== window) return false;
    try {
      return event.origin === window.location.origin;
    } catch {
      return true;
    }
  }
  function sendToBackground(message) {
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
        resolve(response);
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
  function respondToPing(requestId) {
    respond(requestId, {
      ok: true,
      version: EXTENSION_VERSION,
      running: false,
      jobId: null
    });
    const runtime = getExtensionRuntime();
    if (!runtime) return;
    void sendToBackground({
      type: "OPTIC_GET_STATUS"
    }).then((status) => {
      respond(requestId, {
        ok: true,
        version: status?.version ?? EXTENSION_VERSION,
        running: Boolean(status?.running),
        jobId: status?.jobId ?? null
      });
    }).catch(() => {
    });
  }
  function onPageMessage(event) {
    if (!isFromThisPage(event)) return;
    const data = event.data;
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
          error: "Extension was reloaded. Refresh this page and try again."
        });
        return;
      }
      void sendToBackground({
        type: "OPTIC_START_JOB",
        jobId: data.jobId,
        idToken: data.idToken,
        projectId: data.projectId,
        useFunctionsEmulator: data.useFunctionsEmulator === true
      }).then((result) => {
        if (result?.ok === false) {
          respond(requestId, { ok: false, error: result.error || "Extension failed to start" });
          return;
        }
        respond(requestId, { ok: true, running: true, jobId: data.jobId });
      }).catch((e) => {
        respond(requestId, {
          ok: false,
          error: e instanceof Error ? e.message : String(e)
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
          jobId: null
        });
        return;
      }
      void sendToBackground({
        type: "OPTIC_GET_STATUS"
      }).then((status) => {
        respond(requestId, {
          ok: true,
          version: status?.version ?? EXTENSION_VERSION,
          running: Boolean(status?.running),
          jobId: status?.jobId ?? null
        });
      }).catch(() => {
        respond(requestId, {
          ok: true,
          version: EXTENSION_VERSION,
          running: false,
          jobId: null
        });
      });
    }
  }
  function installBridge() {
    const win = window;
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
        target: message.target
      },
      "*"
    );
  });
})();

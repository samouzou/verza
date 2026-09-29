"use strict";
(() => {
  // src/shared/types.ts
  var EXTENSION_VERSION = "0.2.0";

  // src/popup/popup.ts
  var statusEl = document.getElementById("status");
  if (!statusEl) throw new Error("Missing status element");
  chrome.runtime.sendMessage({ type: "OPTIC_GET_STATUS" }, (res) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = "Something went wrong. Try restarting Chrome, then open this again.";
      return;
    }
    if (res?.running) {
      statusEl.textContent = "Searching now. You can keep working in other tabs \u2014 just leave Chrome open.";
      statusEl.classList.add("running");
      return;
    }
    statusEl.textContent = `Ready to go. Start a mission from Verza Optic. (v${res?.version ?? EXTENSION_VERSION})`;
  });
})();

import { EXTENSION_VERSION } from "../shared/types";

const statusEl = document.getElementById("status");
if (!statusEl) throw new Error("Missing status element");

chrome.runtime.sendMessage({ type: "OPTIC_GET_STATUS" }, (res) => {
  if (chrome.runtime.lastError) {
    statusEl.textContent = "Something went wrong. Try restarting Chrome, then open this again.";
    return;
  }
  if (res?.running) {
    statusEl.textContent =
      "Searching Instagram now. You can keep working in other tabs — just leave Chrome open.";
    statusEl.classList.add("running");
    return;
  }
  statusEl.textContent = `Ready to go. Start a mission from Verza Optic. (v${
    res?.version ?? EXTENSION_VERSION
  })`;
});

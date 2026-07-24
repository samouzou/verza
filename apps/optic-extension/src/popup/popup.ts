import { EXTENSION_VERSION } from "../shared/types";

const statusEl = document.getElementById("status");
if (!statusEl) throw new Error("Missing status element");

chrome.runtime.sendMessage({ type: "OPTIC_GET_STATUS" }, (res) => {
  if (chrome.runtime.lastError) {
    statusEl.textContent = "Extension background unavailable.";
    return;
  }
  if (res?.running) {
    statusEl.textContent = `Running mission ${res.jobId ?? ""}…`;
    statusEl.classList.add("running");
    return;
  }
  statusEl.textContent = `Ready (v${res?.version ?? EXTENSION_VERSION}). Start a mission from app.tryverza.com/optic.`;
});

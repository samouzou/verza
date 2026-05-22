import {genkit} from "genkit";
import {googleAI} from "@genkit-ai/google-genai";
import {enableFirebaseTelemetry} from "@genkit-ai/firebase";

// Defer telemetry: calling this at import time blocks `firebase deploy` code analysis
// (10s timeout) while Genkit retries GCP auth without a project id.
const inFunctionsRuntime =
  Boolean(process.env.K_SERVICE) || process.env.FUNCTIONS_EMULATOR === "true";

if (inFunctionsRuntime) {
  void enableFirebaseTelemetry().catch(() => undefined);
}

/** Genkit instance for Firebase Functions (Vertex / Google AI at runtime). */
export const ai = genkit({
  plugins: [googleAI()],
});

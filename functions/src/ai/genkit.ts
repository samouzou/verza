
import {genkit} from "genkit";
import {googleAI} from "@genkit-ai/google-genai";

// This is the Genkit instance for the backend (Firebase Functions).
// When deployed, it will use the service account's permissions for Vertex AI.
export const ai = genkit({
  plugins: [googleAI({apiEndpoint: 'us-central1-aiplatform.googleapis.com'})],
});

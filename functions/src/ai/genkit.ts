import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

// This is the Genkit instance for the backend (Firebase Functions).
// It's configured to use the GEMINI_API_KEY from the environment.
export const ai = genkit({
  plugins: [googleAI({apiKey: process.env.GEMINI_API_KEY})],
});


import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';

export const ai = genkit({
  plugins: [
    googleAI(),
    enableFirebaseTelemetry(),
  ],
  model: googleAI.model('gemini-3-flash-preview'),
});

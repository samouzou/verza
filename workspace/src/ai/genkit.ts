
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI({location: 'us-central1'})],
  model: googleAI.model('gemini-3-flash-preview'),
});


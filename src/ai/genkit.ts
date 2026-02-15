
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI({apiEndpoint: 'us-central1-aiplatform.googleapis.com'})],
  model: googleAI.model('gemini-3-flash-preview'),
});

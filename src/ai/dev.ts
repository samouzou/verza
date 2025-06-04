import { config } from 'dotenv';
config();

import '@/ai/flows/resolve-compatibility-issues.ts';
import '@/ai/flows/generate-code-snippets.ts';
import '@/ai/flows/suggest-ui-improvements.ts';
import '@/ai/flows/generate-project-summary.ts';
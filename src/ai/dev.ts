
import { config } from 'dotenv';
config();

import '@/ai/flows/summarize-contract-terms.ts';
import '@/ai/flows/extract-contract-details.ts';
import '@/ai/flows/negotiation-suggestions-flow.ts';
import '@/ai/flows/generate-invoice-html-flow.ts';
import '@/ai/flows/extract-receipt-details-flow.ts';
import '@/ai/flows/tax-estimation-flow.ts'; // Added new tax estimation flow

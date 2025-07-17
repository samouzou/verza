
import { config } from 'dotenv';
config();

import '@/ai/flows/summarize-contract-terms.ts';
import '@/ai/flows/extract-contract-details.ts';
import '@/ai/flows/negotiation-suggestions-flow.ts';
import '@/ai/flows/generate-invoice-html-flow.ts';
import '@/ai/flows/extract-receipt-details-flow.ts'; // Re-enabled OCR for receipts
import '@/ai/flows/tax-estimation-flow.ts'; // Added new tax estimation flow
import '@/ai/flows/classify-transaction-flow.ts'; // Added new transaction classification flow
import '@/ai/flows/extract-text-from-document-flow.ts'; // Added new OCR flow


import { config } from 'dotenv';
config();

import '@/ai/flows/summarize-contract-terms.ts';
import '@/ai/flows/extract-contract-details.ts';
import '@/ai/flows/negotiation-suggestions-flow.ts';
import '@/ai/flows/generate-invoice-html-flow.ts';
import '@/ai/flows/extract-receipt-details-flow.ts'; // OCR for receipts
import '@/ai/flows/tax-estimation-flow.ts'; // Added new tax estimation flow
import '@/ai/flows/ocr-flow.ts'; // Add new OCR flow
import '@/ai/flows/generate-talent-contract-flow.ts'; // Add new contract generation flow
import '@/ai/flows/classify-transaction-flow.ts'; // Add transaction classification

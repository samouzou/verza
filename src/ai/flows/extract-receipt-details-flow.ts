
'use server';
/**
 * @fileOverview Extracts details from a receipt image using AI.
 *
 * - extractReceiptDetails - A function that handles receipt data extraction.
 * - ExtractReceiptDetailsInput - The input type for the function.
 * - ExtractReceiptDetailsOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractReceiptDetailsInputSchema = z.object({
  imageDataUri: z
    .string()
    .describe(
      "A receipt image, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ExtractReceiptDetailsInput = z.infer<typeof ExtractReceiptDetailsInputSchema>;

const ReceiptLineItemSchema = z.object({
    description: z.string().optional().describe('Description of the item or service.'),
    quantity: z.number().optional().describe('Quantity of the item.'),
    unitPrice: z.number().optional().describe('Price per unit of the item.'),
    totalPrice: z.number().optional().describe('Total price for this line item.'),
});

const ExtractReceiptDetailsOutputSchema = z.object({
  vendorName: z.string().optional().describe('The name of the vendor or merchant.'),
  receiptDate: z.string().optional().describe('The date on the receipt (YYYY-MM-DD if possible, otherwise as is).'),
  totalAmount: z.number().optional().describe('The total amount paid on the receipt.'),
  currency: z.string().optional().describe('The currency of the total amount (e.g., USD, EUR). Default to USD if not specified.'),
  lineItems: z.array(ReceiptLineItemSchema).optional().describe('A list of items purchased. If individual items are not clear, this can be omitted or contain a summary item.'),
  categorySuggestion: z.string().optional().describe('A suggested expense category (e.g., Meals, Travel, Software, Office Supplies).'),
  rawText: z.string().optional().describe('A clean, de-duplicated, single block of text representing the content of the receipt. Avoid repetition and aim for a coherent transcription of all visible text elements.')
});
export type ExtractReceiptDetailsOutput = z.infer<typeof ExtractReceiptDetailsOutputSchema>;

export async function extractReceiptDetails(input: ExtractReceiptDetailsInput): Promise<ExtractReceiptDetailsOutput> {
  return extractReceiptDetailsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractReceiptDetailsPrompt',
  input: { schema: ExtractReceiptDetailsInputSchema },
  output: { schema: ExtractReceiptDetailsOutputSchema },
  prompt: `You are an expert OCR and data extraction AI specializing in receipts.
  Analyze the provided receipt image and extract the following information.
  If a field is not clearly visible or applicable, omit it or provide a sensible default (e.g., currency to USD).

  - vendorName: The name of the store, restaurant, or service provider.
  - receiptDate: The date the transaction occurred. Try to format as YYYY-MM-DD. If not possible, provide the date as seen.
  - totalAmount: The final amount paid, including taxes and tips if specified. This should be a number.
  - currency: The currency symbol or code (e.g., USD, EUR, $, £). Default to "USD" if not explicitly found.
  - lineItems: An array of items purchased. For each item, include:
    - description: Name or description of the item.
    - quantity: (Optional) How many units were purchased.
    - unitPrice: (Optional) Price for one unit.
    - totalPrice: (Optional) Total price for that line item (quantity * unitPrice).
    If line items are not clear, this array can be empty, or you can create a single summary line item.
  - categorySuggestion: Based on the vendor and items, suggest an expense category (e.g., "Meals & Entertainment", "Travel", "Software & Subscriptions", "Office Supplies", "Equipment", "Services").
  - rawText: (Optional) Provide a single, coherent block of text that represents the content transcribed from the receipt. Please make your best effort to de-duplicate information and avoid excessive repetition if the OCR process captures the same text multiple times. The goal is a clean, readable transcription of what's visible on the receipt.

  Receipt Image:
  {{media url=imageDataUri}}
  `,
   // Specify Gemini Flash for potential image input, or a model that supports multimodal
  model: 'googleai/gemini-2.0-flash', // or gemini-1.5-flash, gemini-1.5-pro etc.
  config: {
    // Explicitly request text output, even with media input
    // For some models, you might need to adjust response modalities if you expect structured JSON vs. just text.
    // Safety settings can be adjusted if needed, but default is usually fine for receipts.
  },
});

const extractReceiptDetailsFlow = ai.defineFlow(
  {
    name: 'extractReceiptDetailsFlow',
    inputSchema: ExtractReceiptDetailsInputSchema,
    outputSchema: ExtractReceiptDetailsOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    
    // Post-processing or default setting if AI doesn't provide it
    const result = output!;
    if (result.totalAmount !== undefined && result.currency === undefined) {
        result.currency = "USD"; // Default currency if amount exists but currency doesn't
    }
    if (!result.lineItems) {
        result.lineItems = [];
    }

    return result;
  }
);


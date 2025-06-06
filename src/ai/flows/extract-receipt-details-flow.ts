
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
    description: z.string().optional().describe('Description of the item or service. This should be a specific product or service, not general receipt text.'),
    quantity: z.number().optional().describe('Quantity of the item. Should be a number.'),
    unitPrice: z.number().optional().describe('Price per unit of the item. Should be a number.'),
    totalPrice: z.number().optional().describe('Total price for this line item (quantity * unitPrice if available, or the listed line item total). Should be a number.'),
});

const ExtractReceiptDetailsOutputSchema = z.object({
  vendorName: z.string().optional().describe('The name of the vendor or merchant ONLY. This should be a concise name like "Gott\'s Roadside" or "Starbucks". Do NOT include addresses, line items, or other details in this field.'),
  receiptDate: z.string().optional().describe('The date on the receipt (YYYY-MM-DD if possible, otherwise as is). Extract ONLY the date.'),
  totalAmount: z.number().optional().describe('The final total amount paid on the receipt. This should be a single numerical value representing the grand total.'),
  currency: z.string().optional().describe('The currency of the total amount (e.g., USD, EUR). Default to USD if not specified.'),
  lineItems: z.array(ReceiptLineItemSchema).optional().describe('A list of items purchased. Each item should be a distinct product or service with its own description and price if available. Do not put general receipt text here.'),
  categorySuggestion: z.string().optional().describe('A suggested expense category (e.g., Meals, Travel, Software, Office Supplies). This should be a single category string.'),
  rawText: z.string().optional().describe('A clean, de-duplicated, single block of text representing the content of the receipt. Avoid repetition and aim for a coherent transcription of all visible text elements. This field is for the full text, whereas other fields should contain specific, parsed information.')
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
  Your task is to analyze the provided receipt image and meticulously extract information into the **correct, separate fields** as defined in the output schema. Pay close attention to the descriptions for each field.

  **Crucial Instructions:**
  1.  **Field Separation:** Ensure that information is placed in the correct field. For example, the 'vendorName' field should ONLY contain the vendor's name (e.g., "Target", "Gott's Roadside"), NOT addresses, item descriptions, or other data.
  2.  **Line Items:** Identify individual products or services listed on the receipt. Each distinct item should be an object in the 'lineItems' array, with its own 'description', and 'totalPrice' if available.
  3.  **Total Amount:** The 'totalAmount' field must be the single, final amount paid.
  4.  **Raw Text:** The 'rawText' field is where you should place a transcription of the receipt. Other fields should contain specific, parsed values.

  Extracted Information Fields:
  - vendorName: The name of the store, restaurant, or service provider. **Only the name.**
  - receiptDate: The date the transaction occurred. Try to format as YYYY-MM-DD. If not possible, provide the date as seen. **Only the date.**
  - totalAmount: The final amount paid, including taxes and tips if specified. This should be a number. **Only the grand total.**
  - currency: The currency symbol or code (e.g., USD, EUR, $, £). Default to "USD" if not explicitly found.
  - lineItems: An array of items purchased. For each item, include:
    - description: Name or description of the specific item/service.
    - quantity: (Optional) How many units were purchased.
    - unitPrice: (Optional) Price for one unit.
    - totalPrice: (Optional) Total price for that line item.
    If line items are not clear, this array can be empty, or you can create a single summary line item if appropriate.
  - categorySuggestion: Based on the vendor and items, suggest an expense category (e.g., "Meals & Entertainment", "Travel", "Software & Subscriptions", "Office Supplies", "Equipment", "Services"). **A single category string.**
  - rawText: (Optional) Provide a single, coherent block of text that represents the content transcribed from the receipt. Please make your best effort to de-duplicate information and avoid excessive repetition if the OCR process captures the same text multiple times. The goal is a clean, readable transcription of what's visible on the receipt.

  Analyze this receipt image carefully:
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


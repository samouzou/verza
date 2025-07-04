
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
    totalPrice: z.number().optional().describe('Total price for this line item (quantity * unitPrice).'),
});

const ExtractReceiptDetailsOutputSchema = z.object({
  vendorName: z.string().optional().describe('The name of the vendor or merchant. Just the name, e.g., "Gott\'s Roadside".'),
  receiptDate: z.string().optional().describe('The date on the receipt (YYYY-MM-DD if possible).'),
  totalAmount: z.number().optional().describe('The final total amount paid on the receipt. Look for the "Total" line.'),
  currency: z.string().optional().describe('The currency of the total amount (e.g., USD, EUR). Default to USD if not specified.'),
  lineItems: z.array(ReceiptLineItemSchema).optional().describe('A list of items purchased.'),
  categorySuggestion: z.string().optional().describe('A suggested expense category (e.g., "Meals & Entertainment", "Travel", "Software").'),
  rawText: z.string().optional().describe('The full raw text extracted from the receipt by OCR.')
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
  Analyze the provided receipt image and extract the following information. Be very precise.

  - vendorName: The name of the store or merchant. This is usually the most prominent text at the top. DO NOT include address, phone numbers, or any other text. For example, for "Gott's Roadside - Ferry Building...", the correct vendorName is "Gott's Roadside".
  - receiptDate: The date of the transaction. Format as YYYY-MM-DD.
  - totalAmount: The final, total amount paid. Look for labels like "Total", "Amount Paid", or "Grand Total". Extract ONLY the numerical value. For "$42.07", the value is 42.07.
  - currency: The currency symbol or code (e.g., USD, EUR). If not found, assume USD.
  - lineItems: An array of items purchased, each with a description and its total price.
  - categorySuggestion: Based on the vendor and items, suggest an expense category (e.g., "Meals & Entertainment", "Travel", "Office Supplies").
  - rawText: The full raw text extracted from the receipt. This field can contain all the text, but the other fields must be precise and clean.

  Receipt Image:
  {{media url=imageDataUri}}
  `,
  model: 'googleai/gemini-2.0-flash', 
  config: {},
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
    const result = output!; // Assuming output will not be null
    if (result.totalAmount !== undefined && result.currency === undefined) {
        result.currency = "USD"; // Default currency if amount exists but currency doesn't
    }
    if (!result.lineItems) {
        result.lineItems = [];
    }

    return result;
  }
);

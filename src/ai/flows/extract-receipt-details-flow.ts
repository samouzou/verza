'use server';
/**
 * @fileOverview Extracts details from a receipt image using AI.
 *
 * - extractReceiptDetails - A function that handles receipt data extraction.
 * - ExtractReceiptDetailsInput - The input type for the function.
 * - ExtractReceiptDetailsOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
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
  vendorName: z.string().optional().describe('The name of the vendor or merchant.'),
  receiptDate: z.string().optional().describe('The date on the receipt (YYYY-MM-DD if possible).'),
  totalAmount: z.number().optional().describe('The final total amount paid on the receipt.'),
  currency: z.string().optional().describe('The currency of the total amount (e.g., USD, EUR). Default to USD if not specified.'),
  lineItems: z.array(ReceiptLineItemSchema).optional().describe('A list of items purchased.'),
  categorySuggestion: z.string().optional().describe('A suggested expense category (e.g., Meals, Travel, Software).'),
  rawText: z.string().optional().describe('The raw text extracted from the receipt by OCR.')
});
export type ExtractReceiptDetailsOutput = z.infer<typeof ExtractReceiptDetailsOutputSchema>;

export async function extractReceiptDetails(input: ExtractReceiptDetailsInput): Promise<ExtractReceiptDetailsOutput> {
  return extractReceiptDetailsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractReceiptDetailsPrompt',
  model: googleAI.model('gemini-1.5-flash-latest'),
  input: { schema: ExtractReceiptDetailsInputSchema },
  output: { schema: z.object({ totalAmount: z.number().optional() }) },
  prompt: `You are an expert OCR and data extraction AI specializing in receipts.
  Your ONLY task is to find the final, total amount on the provided receipt image.
  Look for keywords like "Total", "Grand Total", "Amount Paid".
  Return only the numerical value for the total amount.

  Receipt Image:
  {{media url=imageDataUri}}
  `,
});

const extractReceiptDetailsFlow = ai.defineFlow(
  {
    name: 'extractReceiptDetailsFlow',
    inputSchema: ExtractReceiptDetailsInputSchema,
    outputSchema: z.object({ totalAmount: z.number().optional() }),
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);

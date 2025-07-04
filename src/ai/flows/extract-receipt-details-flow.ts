
'use server';
/**
 * @fileOverview Extracts the total amount from a receipt image using AI.
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


const ExtractReceiptDetailsOutputSchema = z.object({
  totalAmount: z.number().optional().describe('The final total amount paid on the receipt. Look for the "Total", "Grand Total", or "Amount Paid" line. Extract ONLY the numerical value.'),
});
export type ExtractReceiptDetailsOutput = z.infer<typeof ExtractReceiptDetailsOutputSchema>;

export async function extractReceiptDetails(input: ExtractReceiptDetailsInput): Promise<ExtractReceiptDetailsOutput> {
  return extractReceiptDetailsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractReceiptDetailsPrompt',
  input: { schema: ExtractReceiptDetailsInputSchema },
  output: { schema: ExtractReceiptDetailsOutputSchema },
  prompt: `You are an expert OCR AI. Your ONLY task is to find the final, total amount on the provided receipt image.
  Look for labels like "Total", "Amount Paid", or "Grand Total". Extract ONLY the numerical value.
  For "$42.07", the value is 42.07. If you cannot find a total amount, do not return a value for it.

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
    return output!;
  }
);

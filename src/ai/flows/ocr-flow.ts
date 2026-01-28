
'use server';
/**
 * @fileOverview Performs Optical Character Recognition (OCR) on a document.
 *
 * - ocrDocument - A function that extracts text and returns it.
 * - OcrDocumentInput - The input type for the function.
 * - OcrDocumentOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const OcrDocumentInputSchema = z.object({
  documentDataUri: z
    .string()
    .describe(
      "An image or PDF document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type OcrDocumentInput = z.infer<typeof OcrDocumentInputSchema>;

const OcrDocumentOutputSchema = z.object({
  extractedText: z.string().describe('The extracted plain text from the document.'),
});
export type OcrDocumentOutput = z.infer<typeof OcrDocumentOutputSchema>;

export async function ocrDocument(input: OcrDocumentInput): Promise<OcrDocumentOutput> {
  return ocrDocumentFlow(input);
}

const prompt = ai.definePrompt({
  name: 'ocrDocumentPrompt',
  input: { schema: OcrDocumentInputSchema },
  output: { schema: OcrDocumentOutputSchema },
  prompt: `You are an expert Optical Character Recognition (OCR) AI. Your task is to accurately extract all text from the provided document image or PDF. Preserve original line breaks and paragraph structure in the extracted text.

  Document to process:
  {{media url=documentDataUri}}
  `,
  model: 'googleai/gemini-1.5-flash-latest',
});

const ocrDocumentFlow = ai.defineFlow(
  {
    name: 'ocrDocumentFlow',
    inputSchema: OcrDocumentInputSchema,
    outputSchema: OcrDocumentOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);

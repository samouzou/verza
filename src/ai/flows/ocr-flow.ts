'use server';
/**
 * @fileOverview Performs Optical Character Recognition (OCR) on a document image.
 *
 * - ocrDocument - A function that extracts text from an image or PDF file.
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
  extractedText: z.string().describe('The full text extracted from the document.'),
});
export type OcrDocumentOutput = z.infer<typeof OcrDocumentOutputSchema>;

export async function ocrDocument(input: OcrDocumentInput): Promise<OcrDocumentOutput> {
  return ocrDocumentFlow(input);
}

const prompt = ai.definePrompt({
  name: 'ocrDocumentPrompt',
  input: { schema: OcrDocumentInputSchema },
  output: { schema: OcrDocumentOutputSchema },
  prompt: `You are an expert Optical Character Recognition (OCR) AI.
  Your task is to accurately extract all text from the provided document.
  Preserve the original formatting, including line breaks and spacing, as much as possible.

  Document to process:
  {{media url=documentDataUri}}
  `,
  // Specify a model that supports multimodal input (image/pdf + text)
  model: 'googleai/gemini-2.0-flash',
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

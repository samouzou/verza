
'use server';
/**
 * @fileOverview Extracts text content from a document (PDF or image) using OCR.
 *
 * - extractTextFromDocument - A function that handles the document text extraction.
 * - ExtractTextFromDocumentInput - The input type for the function.
 * - ExtractTextFromDocumentOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractTextFromDocumentInputSchema = z.object({
  documentDataUri: z
    .string()
    .describe(
      "A document (image or PDF), as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ExtractTextFromDocumentInput = z.infer<typeof ExtractTextFromDocumentInputSchema>;


const ExtractTextFromDocumentOutputSchema = z.object({
  extractedText: z.string().describe('The full text content extracted from the document.'),
});
export type ExtractTextFromDocumentOutput = z.infer<typeof ExtractTextFromDocumentOutputSchema>;

export async function extractTextFromDocument(input: ExtractTextFromDocumentInput): Promise<ExtractTextFromDocumentOutput> {
  return extractTextFromDocumentFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractTextFromDocumentPrompt',
  input: { schema: ExtractTextFromDocumentInputSchema },
  output: { schema: ExtractTextFromDocumentOutputSchema },
  prompt: `You are an expert Optical Character Recognition (OCR) AI.
  Your ONLY task is to extract all text content from the provided document.
  Preserve the original formatting, including line breaks, as much as possible.

  Document:
  {{media url=documentDataUri}}
  `,
  model: 'googleai/gemini-2.0-flash', 
  config: {},
});

const extractTextFromDocumentFlow = ai.defineFlow(
  {
    name: 'extractTextFromDocumentFlow',
    inputSchema: ExtractTextFromDocumentInputSchema,
    outputSchema: ExtractTextFromDocumentOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);

'use server';
/**
 * @fileOverview Performs Optical Character Recognition (OCR) and converts it to Syncfusion's SFDT format.
 *
 * - convertDocumentToSfdt - A function that extracts text and returns SFDT.
 * - ConvertDocumentToSfdtInput - The input type for the function.
 * - ConvertDocumentToSfdtOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ConvertDocumentToSfdtInputSchema = z.object({
  documentDataUri: z
    .string()
    .describe(
      "An image or PDF document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ConvertDocumentToSfdtInput = z.infer<typeof ConvertDocumentToSfdtInputSchema>;

const ConvertDocumentToSfdtOutputSchema = z.object({
  sfdt: z.string().describe('The document content as a Syncfusion SFDT (Syncfusion Document Format) JSON string.'),
});
export type ConvertDocumentToSfdtOutput = z.infer<typeof ConvertDocumentToSfdtOutputSchema>;

export async function convertDocumentToSfdt(input: ConvertDocumentToSfdtInput): Promise<ConvertDocumentToSfdtOutput> {
  return convertDocumentToSfdtFlow(input);
}

const prompt = ai.definePrompt({
  name: 'convertDocumentToSfdtPrompt',
  input: { schema: ConvertDocumentToSfdtInputSchema },
  output: { schema: ConvertDocumentToSfdtOutputSchema },
  prompt: `You are an expert Optical Character Recognition (OCR) AI that specializes in converting document images into Syncfusion's SFDT (Syncfusion Document Text Format) JSON format.

  Your task is to accurately extract all text from the provided document and structure it as a valid SFDT JSON string.

  - The JSON must contain a single root key "sfdt".
  - The value of "sfdt" must be a JSON string containing a "sections" array.
  - Each section should contain "blocks" which are paragraphs.
  - Each paragraph block should contain "inlines" which are the text runs.
  
  Example of a simple SFDT output structure:
  {
    "sfdt": "{\\"sections\\":[{\\"blocks\\":[{\\"inlines\\":[{\\"text\\":\\"Here is the first paragraph.\\"},{\\"text\\":\\" Here is the second sentence of the same paragraph.\\"}]}]}]}"
  }
  
  Preserve original line breaks as separate paragraph blocks.

  Document to process:
  {{media url=documentDataUri}}
  `,
  // Specify a model that supports multimodal input (image/pdf + text)
  model: 'googleai/gemini-2.0-flash',
});

const convertDocumentToSfdtFlow = ai.defineFlow(
  {
    name: 'convertDocumentToSfdtFlow',
    inputSchema: ConvertDocumentToSfdtInputSchema,
    outputSchema: ConvertDocumentToSfdtOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);

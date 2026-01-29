'use server';
/**
 * @fileOverview Summarizes contract terms using AI.
 *
 * - summarizeContractTerms - A function that summarizes contract terms.
 * - SummarizeContractTermsInput - The input type for the summarizeContractTerms function.
 * - SummarizeContractTermsOutput - The return type for the summarizeContractTerms function.
 */

import {ai} from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import {z} from 'genkit';

const SummarizeContractTermsInputSchema = z.object({
  contractText: z
    .string()
    .describe('The SFDT JSON string of the contract to be summarized.'),
});
export type SummarizeContractTermsInput = z.infer<
  typeof SummarizeContractTermsInputSchema
>;

const SummarizeContractTermsOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the contract terms.'),
});
export type SummarizeContractTermsOutput = z.infer<
  typeof SummarizeContractTermsOutputSchema
>;

export async function summarizeContractTerms(
  input: SummarizeContractTermsInput
): Promise<SummarizeContractTermsOutput> {
  return summarizeContractTermsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeContractTermsPrompt',
  model: googleAI.model('gemini-1.5-pro-latest'),
  input: {schema: SummarizeContractTermsInputSchema},
  output: {schema: SummarizeContractTermsOutputSchema},
  prompt: `You are an AI assistant that specializes in summarizing legal contracts from SFDT JSON strings.

  First, parse the SFDT JSON string to extract the plain text. The text is located in \`JSON.parse(sfdtString).sections[0].blocks[...].inlines[...].text\`. Concatenate all text parts.
  
  Then, please provide a concise and easy-to-understand summary of the key terms in the following contract:

  {{contractText}}
  `,
});

const summarizeContractTermsFlow = ai.defineFlow(
  {
    name: 'summarizeContractTermsFlow',
    inputSchema: SummarizeContractTermsInputSchema,
    outputSchema: SummarizeContractTermsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

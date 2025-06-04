'use server';
/**
 * @fileOverview Summarizes contract terms using AI.
 *
 * - summarizeContractTerms - A function that summarizes contract terms.
 * - SummarizeContractTermsInput - The input type for the summarizeContractTerms function.
 * - SummarizeContractTermsOutput - The return type for the summarizeContractTerms function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeContractTermsInputSchema = z.object({
  contractText: z
    .string()
    .describe('The full text of the contract to be summarized.'),
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
  input: {schema: SummarizeContractTermsInputSchema},
  output: {schema: SummarizeContractTermsOutputSchema},
  prompt: `You are an AI assistant that specializes in summarizing legal contracts.

  Please provide a concise and easy-to-understand summary of the key terms in the following contract:

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

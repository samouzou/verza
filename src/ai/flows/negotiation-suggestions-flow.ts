
'use server';
/**
 * @fileOverview Provides AI-powered negotiation suggestions for contract terms.
 *
 * - getNegotiationSuggestions - A function that generates negotiation advice.
 * - NegotiationSuggestionsInput - The input type for the getNegotiationSuggestions function.
 * - NegotiationSuggestionsOutput - The return type for the getNegotiationSuggestions function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const NegotiationSuggestionsInputSchema = z.object({
  contractText: z
    .string()
    .describe('The full text of the contract for which negotiation suggestions are sought.'),
});
export type NegotiationSuggestionsInput = z.infer<typeof NegotiationSuggestionsInputSchema>;

const NegotiationSuggestionsOutputSchema = z.object({
  paymentTerms: z.string().optional().describe('Suggestions for negotiating payment terms (e.g., net days, upfront payment).'),
  exclusivity: z.string().optional().describe('Suggestions regarding exclusivity clauses (e.g., duration, scope, carve-outs).'),
  ipRights: z.string().optional().describe('Suggestions for negotiating intellectual property rights (e.g., ownership, licensing, usage).'),
  generalSuggestions: z.array(z.string()).optional().describe('Other general negotiation points or tips.'),
});
export type NegotiationSuggestionsOutput = z.infer<typeof NegotiationSuggestionsOutputSchema>;

export async function getNegotiationSuggestions(
  input: NegotiationSuggestionsInput
): Promise<NegotiationSuggestionsOutput> {
  return negotiationSuggestionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'negotiationSuggestionsPrompt',
  input: {schema: NegotiationSuggestionsInputSchema},
  output: {schema: NegotiationSuggestionsOutputSchema},
  prompt: `You are an expert negotiation advisor for content creators reviewing a contract.
  Based on the following contract text, provide actionable negotiation suggestions.
  Focus on common areas like:
  1.  Payment Terms: Advise on favorable terms (e.g., shorter payment cycles like Net-15 or Net-30, upfront payments, kill fees).
  2.  Exclusivity: Analyze any exclusivity clauses. Suggest ways to limit scope (e.g., platform-specific, content-specific, shorter duration) or negotiate carve-outs.
  3.  Intellectual Property (IP) Rights: Advise on retaining IP ownership where possible, or clearly defining usage rights, licensing terms, and duration for any content created.

  Provide concise, practical advice for each category if applicable. If a category is not relevant or no specific suggestion can be made, you can omit it.
  You can also include general negotiation tips if they arise from the contract context.

  Contract Text:
  {{{contractText}}}
  `,
});

const negotiationSuggestionsFlow = ai.defineFlow(
  {
    name: 'negotiationSuggestionsFlow',
    inputSchema: NegotiationSuggestionsInputSchema,
    outputSchema: NegotiationSuggestionsOutputSchema,
  },
  async (input) => {
    const {output} = await prompt(input);
    return output!;
  }
);

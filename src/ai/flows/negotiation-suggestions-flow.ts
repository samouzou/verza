'use server';
/**
 * @fileOverview Provides AI-powered negotiation suggestions for contract terms.
 *
 * - getNegotiationSuggestions - A function that generates negotiation advice.
 * - NegotiationSuggestionsInput - The input type for the getNegotiationSuggestions function.
 * - NegotiationSuggestionsOutput - The return type for the getNegotiationSuggestions function.
 */

import {ai} from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import {z} from 'genkit';

const NegotiationSuggestionsInputSchema = z.object({
  contractText: z
    .string()
    .describe('The SFDT JSON string of the contract for which negotiation suggestions are sought.'),
});
export type NegotiationSuggestionsInput = z.infer<typeof NegotiationSuggestionsInputSchema>;

const NegotiationSuggestionsOutputSchema = z.object({
  paymentTerms: z.string().optional().describe('A complete, alternative payment terms clause that is more favorable to the creator, or a note if the existing terms are already favorable.'),
  exclusivity: z.string().describe('A complete, alternative exclusivity clause with a more limited scope or duration. If no exclusivity clause is found, return a note stating that.'),
  ipRights: z.string().describe('A complete, alternative intellectual property rights clause (e.g., granting a license). If no IP rights clause is found, return a note stating that.'),
});
export type NegotiationSuggestionsOutput = z.infer<typeof NegotiationSuggestionsOutputSchema>;

export async function getNegotiationSuggestions(
  input: NegotiationSuggestionsInput
): Promise<NegotiationSuggestionsOutput> {
  return negotiationSuggestionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'negotiationSuggestionsPrompt',
  model: googleAI.model('gemini-2.5-flash'),
  input: {schema: NegotiationSuggestionsInputSchema},
  output: {schema: NegotiationSuggestionsOutputSchema},
  prompt: `You are an expert legal advisor for content creators, specializing in contract negotiation. Your task is to analyze the provided contract from its SFDT JSON string format and suggest alternative phrasing for key clauses that would be more favorable to the creator.

  First, you must parse the SFDT JSON to get the plain text. The text is in \`JSON.parse(sfdtString).sections[0].blocks[...].inlines[...].text\`. Concatenate all text parts to form the full contract text.

  Based on the full text, provide alternative clauses that can be directly copied and pasted into the document. The language and tone of your suggestions should match the existing contract.

  Always provide a response for the 'exclusivity' and 'ipRights' fields.

  Focus on these key areas:
  1.  **Payment Terms**: If the payment terms are unfavorable (e.g., Net-60 or longer), suggest a clause for a shorter payment cycle (e.g., Net-30) or upfront payment. If the terms are already good, you can omit this field.
  2.  **Exclusivity**: If a broad exclusivity clause exists, suggest a more limited version (e.g., limit to a specific platform or shorter duration). If NO exclusivity clause is found, return the string: "No exclusivity clause was found in the contract. Consider adding one if necessary to define usage boundaries."
  3.  **Intellectual Property (IP) Rights**: If the brand is asking for full ownership, suggest a clause where the creator retains ownership and grants a license. If NO IP rights clause is found, return the string: "No intellectual property clause was found. It's recommended to add one to clarify who owns the content."

  Provide the full, ready-to-use legal text for each suggested clause. Do not provide advice or explanations, only the replacement legal text or the specified note.

  SFDT Contract Text:
  {{{contractText}}}
  `,
});

const negotiationSuggestionsFlow = ai.defineFlow(
  {
    name: 'negotiationSuggestionsFlow',
    inputSchema: NegotiationSuggestionsInputSchema,
    outputSchema: NegotiationSuggestionsOutputSchema,
  },
  async (input: NegotiationSuggestionsInput) => {
    const {output} = await prompt(input);
    return output!;
  }
);

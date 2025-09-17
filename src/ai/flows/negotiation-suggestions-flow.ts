
'use server';
/**
 * @fileOverview Provides AI-powered negotiation suggestions for contract terms.
 *
 * - getNegotiationSuggestions - A function that generates negotiation advice.
 * - NegotiationSuggestionsInput - The input type for the getNegotiationSuggestions function.
 * - NegotiationSuggestionsOutput - The return type for the getNegotiationSuggestions function.
 */

// Suggested code may be subject to a license. Learn more: ~LicenseLog:4202067470.
import {ai} from '../genkit';
import {z} from 'genkit';

const NegotiationSuggestionsInputSchema = z.object({
  contractText: z
    .string()
    .describe('The SFDT JSON string of the contract for which negotiation suggestions are sought.'),
});
export type NegotiationSuggestionsInput = z.infer<typeof NegotiationSuggestionsInputSchema>;

const NegotiationSuggestionsOutputSchema = z.object({
  paymentTerms: z.string().optional().describe('A complete, alternative payment terms clause that is more favorable to the creator.'),
  exclusivity: z.string().optional().describe('A complete, alternative exclusivity clause with a more limited scope or duration.'),
  ipRights: z.string().optional().describe('A complete, alternative intellectual property rights clause, for example, granting a license instead of ownership.'),
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
  prompt: `You are an expert legal advisor for content creators, specializing in contract negotiation. Your task is to analyze the provided contract from its SFDT JSON string format and suggest alternative phrasing for key clauses that would be more favorable to the creator.

  First, you must parse the SFDT JSON to get the plain text. The text is in \`JSON.parse(sfdtString).sections[0].blocks[...].inlines[...].text\`. Concatenate all text parts to form the full contract text.

  Based on the full text, provide alternative clauses that can be directly copied and pasted into the document. The language and tone of your suggestions should match the existing contract.

  Focus on these key areas:
  1.  **Payment Terms**: If the payment terms are unfavorable (e.g., Net-60 or longer), suggest a clause for a shorter payment cycle (e.g., Net-30) or upfront payment. For example, "Payment will be due within thirty (30) days of receipt of invoice."
  2.  **Exclusivity**: If the exclusivity clause is too broad, suggest a more limited version. For example, limit it to a specific platform ("...exclusive to the Instagram platform...") or a shorter duration.
  3.  **Intellectual Property (IP) Rights**: If the brand is asking for full ownership of the content, suggest a clause where the creator retains ownership and grants the brand a specific license. For example, "Creator grants Brand a non-exclusive, worldwide, perpetual license to use the content..."

  Provide the full, ready-to-use legal text for each suggested clause. If a category is not relevant or the existing clause is already favorable, you can omit it.
  Do not provide advice or explanations, only the replacement legal text itself.

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

    
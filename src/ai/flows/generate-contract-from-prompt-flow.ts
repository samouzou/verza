'use server';

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'genkit';

const GenerateContractFromPromptInputSchema = z.object({
  prompt: z.string().describe('Natural language description of the desired contract.'),
  creatorName: z.string().optional().describe('Name of the creator / service provider.'),
  clientName: z.string().optional().describe('Name of the client / brand.'),
});
export type GenerateContractFromPromptInput = z.infer<typeof GenerateContractFromPromptInputSchema>;

const GenerateContractFromPromptOutputSchema = z.object({
  contractText: z.string().describe('The full text of the generated contract, as plain text with line breaks between sections.'),
});
export type GenerateContractFromPromptOutput = z.infer<typeof GenerateContractFromPromptOutputSchema>;

export async function generateContractFromPrompt(input: GenerateContractFromPromptInput): Promise<GenerateContractFromPromptOutput> {
  return generateContractFromPromptFlow(input);
}

const contractPrompt = ai.definePrompt({
  name: 'generateContractFromPromptPrompt',
  model: googleAI.model('gemini-3-flash-preview'),
  input: { schema: GenerateContractFromPromptInputSchema },
  output: { schema: GenerateContractFromPromptOutputSchema },
  prompt: `You are an expert legal AI that drafts professional contracts for creators and brands.

{{#if creatorName}}**Creator / Service Provider:** {{{creatorName}}}{{/if}}
{{#if clientName}}**Client / Brand:** {{{clientName}}}{{/if}}
**User's Request:** "{{{prompt}}}"

Generate a complete, well-structured contract that fulfils the request above. Include relevant standard clauses: scope of work, payment terms, deliverables, IP ownership, confidentiality, termination, and governing law. Use placeholders like "[Date]", "[Address]", "[Signature]" where specific information was not provided.

Output the contract as plain text only. Use line breaks to separate paragraphs and sections. Do not use markdown formatting or JSON — just the contract text itself.`,
});

const generateContractFromPromptFlow = ai.defineFlow(
  {
    name: 'generateContractFromPromptFlow',
    inputSchema: GenerateContractFromPromptInputSchema,
    outputSchema: GenerateContractFromPromptOutputSchema,
  },
  async (input) => {
    const maxAttempts = 5;
    let delay = 2000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { output } = await contractPrompt(input);
        return output!;
      } catch (e: any) {
        if (e.status === 429 && i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 30000);
        } else {
          throw e;
        }
      }
    }
    throw new Error('Contract generation failed after multiple retries.');
  }
);

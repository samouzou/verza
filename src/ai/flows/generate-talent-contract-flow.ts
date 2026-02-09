
'use server';
/**
 * @fileOverview Generates a talent management contract using AI.
 *
 * - generateTalentContract - A function that generates contract text from a prompt.
 * - GenerateTalentContractInput - The input type for the function.
 * - GenerateTalentContractOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z, retry } from 'genkit';

const GenerateTalentContractInputSchema = z.object({
  prompt: z
    .string()
    .describe('A natural language prompt describing the desired contract terms. e.g., "Draft a 1-year contract for a new talent with a 20% commission."'),
  agencyName: z.string().describe("The name of the agency."),
  talentName: z.string().describe("The name of the talent."),
});
export type GenerateTalentContractInput = z.infer<typeof GenerateTalentContractInputSchema>;

const GenerateTalentContractOutputSchema = z.object({
  contractSfdt: z.string().describe('The generated contract as a JSON string in SFDT format, ready to be loaded into a document editor.'),
});
export type GenerateTalentContractOutput = z.infer<typeof GenerateTalentContractOutputSchema>;

export async function generateTalentContract(input: GenerateTalentContractInput): Promise<GenerateTalentContractOutput> {
  return generateTalentContractFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateTalentContractPrompt',
  model: googleAI.model('gemini-2.0-flash'),
  input: { schema: GenerateTalentContractInputSchema },
  output: { schema: GenerateTalentContractOutputSchema },
  prompt: `You are an expert legal AI specializing in drafting contracts for creator management agencies. Your task is to generate a comprehensive Talent Management Agreement based on the user's prompt.

The output MUST be a valid JSON string in the SFDT (Syncfusion Document Text) format.

**Agency Name:** {{{agencyName}}}
**Talent Name:** {{{talentName}}}
**User's Prompt:** "{{{prompt}}}"

**Instructions:**
1.  Generate a standard, well-structured Talent Management Agreement.
2.  Incorporate the specific terms requested in the user's prompt (e.g., duration, commission rate, exclusivity).
3.  Include standard clauses covering:
    -   Scope of Representation (e.g., seeking brand deals, managing negotiations).
    -   Term and Termination (include a standard initial term and renewal options).
    -   Compensation (clearly define the agency's commission structure).
    -   Exclusivity (if requested, otherwise specify non-exclusivity).
    -   Intellectual Property (clarify ownership of content created by the talent).
    -   Confidentiality.
    -   Governing Law.
4.  Use placeholders like "[Date]", "[Talent Address]", "[Agency Address]" for information not provided.
5.  The final output must be a single, valid SFDT JSON string. Ensure all text is properly formatted within 'blocks' and 'inlines' as per the SFDT specification. Do not include any explanatory text outside of the JSON structure.
`,
});

const generateTalentContractFlow = ai.defineFlow(
  {
    name: 'generateTalentContractFlow',
    inputSchema: GenerateTalentContractInputSchema,
    outputSchema: GenerateTalentContractOutputSchema,
    retry: retry({
      backoff: {
        delay: '2s',
        maxDelay: '30s',
        multiplier: 2,
      },
      maxAttempts: 5,
      when: (e) => (e as any).status === 429,
    }),
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);


"use server";
/**
 * @fileOverview Generates a standard UGC agreement.
 *
 * - generateUgcContract - A function that generates the UGC contract.
 * - GenerateUgcContractInput - The input type for the function.
 * - GenerateUgcContractOutput - The return type for the function.
 */

import {ai} from "../genkit";
import {googleAI} from "@genkit-ai/google-genai";
import {z} from "genkit";

export const GenerateUgcContractInputSchema = z.object({
  brandName: z.string().describe("The name of the brand or agency."),
  creatorName: z.string().describe("The name of the content creator."),
  gigDescription: z.string().describe("The detailed description of the work to be performed from the gig posting."),
  rate: z.number().describe("The payment rate for the creator for completing the work."),
});
export type GenerateUgcContractInput = z.infer<typeof GenerateUgcContractInputSchema>;

export const GenerateUgcContractOutputSchema = z.object({
  contractSfdt: z.string().describe("The generated contract as a JSON string in SFDT format," +
    " ready to be loaded into a document editor."),
});
export type GenerateUgcContractOutput = z.infer<typeof GenerateUgcContractOutputSchema>;

/**
 * Generates a standard UGC agreement based on gig details.
 * @param {GenerateUgcContractInput} input The gig and creator details.
 * @return {Promise<GenerateUgcContractOutput>} The generated contract in SFDT format.
 */
export async function generateUgcContract(input: GenerateUgcContractInput): Promise<GenerateUgcContractOutput> {
  return generateUgcContractFlow(input);
}

const prompt = ai.definePrompt({
  name: "generateUgcContractPrompt",
  model: googleAI.model("gemini-1.5-flash-preview"),
  input: {schema: GenerateUgcContractInputSchema},
  output: {schema: GenerateUgcContractOutputSchema},
  prompt: `You are an expert legal AI specializing in drafting simple, fair agreements for the creator economy.
  Your task is to generate a standard User-Generated Content (UGC) Agreement based on the provided details.

The output MUST be a valid JSON string in the SFDT (Syncfusion Document Text) format.

**Brand/Agency Name:** {{{brandName}}}
**Creator Name:** {{{creatorName}}}
**Payment Rate:** \${{{rate}}}
**Gig Description (Scope of Work):** "{{{gigDescription}}}"

**Instructions:**
1.  Generate a simple, one-page UGC Agreement.
2.  Use the information above to fill in the parties, payment, and scope of work. 
The 'Gig Description' should be detailed under a "Scope of Work" or "Deliverables" section.
3.  Include the following standard clauses, keeping them clear and concise:
    *   **Deliverables:** Use the Gig Description to detail what the creator must produce.
    *   **Compensation:** State the payment amount of \${{{rate}}} to be paid upon successful
    * completion and submission of deliverables.
    *   **Usage Rights/License:** Grant the brand a 12-month, non-exclusive, worldwide license
    * to use the content on its organic social media channels. The creator retains ownership of the content.
    *   **Deadline:** State that the content must be delivered within 14 days of this agreement's date.
    *   **Independent Contractor:** Clarify that the creator is an independent contractor, not an employee.
4.  Use placeholders for signatures: "[Brand/Agency Signature]", "[Creator Signature]".
5.  The final output must be a single, valid SFDT JSON string. Ensure all text is properly formatted within 'blocks'
  and 'inlines' as per the SFDT specification. Do not include any explanatory text outside of the JSON structure.
`,
});

const generateUgcContractFlow = ai.defineFlow(
  {
    name: "generateUgcContractFlow",
    inputSchema: GenerateUgcContractInputSchema,
    outputSchema: GenerateUgcContractOutputSchema,
  },
  async (input) => {
    const {output} = await prompt(input);
    return output!;
  }
);


'use server';
/**
 * @fileOverview Edits a user's draft note for an invoice using AI.
 *
 * - editInvoiceNote - A function that refines a note based on a selected tone.
 * - EditInvoiceNoteInput - The input type for the function.
 * - EditInvoiceNoteOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'genkit';

const EditInvoiceNoteInputSchema = z.object({
  draftNote: z.string().describe('The user\'s initial draft of the note to be included in the invoice email.'),
  tone: z.enum(['more_professional', 'more_friendly', 'shorter', 'more_detailed']).describe('The desired tone for the revised note.'),
});
export type EditInvoiceNoteInput = z.infer<typeof EditInvoiceNoteInputSchema>;

const EditInvoiceNoteOutputSchema = z.object({
  editedNote: z.string().describe('The AI-revised note, ready to be included in the invoice email.'),
});
export type EditInvoiceNoteOutput = z.infer<typeof EditInvoiceNoteOutputSchema>;

export async function editInvoiceNote(input: EditInvoiceNoteInput): Promise<EditInvoiceNoteOutput> {
  return editInvoiceNoteFlow(input);
}

const prompt = ai.definePrompt({
  name: 'editInvoiceNotePrompt',
  model: googleAI.model('gemini-2.0-flash'),
  input: { schema: EditInvoiceNoteInputSchema },
  output: { schema: EditInvoiceNoteOutputSchema },
  prompt: `You are an expert copy editor for business communications. A user has written a draft note to include with an invoice. Your task is to revise it based on their desired tone.

  User's Draft Note:
  "{{{draftNote}}}"

  Desired Tone: {{{tone}}}

  Instructions:
  - If tone is 'more_professional', rewrite the note to be more formal, clear, and concise.
  - If tone is 'more_friendly', rewrite the note to be warmer and more personable, while still being appropriate for a business context.
  - If tone is 'shorter', significantly condense the note to its most essential points.
  - If tone is 'more_detailed', expand on the user's note, adding appropriate context or a concluding pleasantry.
  
  The output should only be the revised note text. Do not include any other commentary.
  `,
});

const editInvoiceNoteFlow = ai.defineFlow(
  {
    name: 'editInvoiceNoteFlow',
    inputSchema: EditInvoiceNoteInputSchema,
    outputSchema: EditInvoiceNoteOutputSchema,
  },
  async (input) => {
    const maxAttempts = 5;
    let delay = 2000; // start with 2 seconds

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { output } = await prompt(input);
        return output!;
      } catch (e: any) {
        if (e.status === 429 && i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          if (delay > 30000) delay = 30000; // Cap delay at 30 seconds
        } else {
          throw e; // Rethrow on last attempt or other error
        }
      }
    }
    // This line should be unreachable but is needed for TypeScript
    throw new Error("Flow failed after multiple retries.");
  }
);

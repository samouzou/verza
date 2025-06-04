'use server';

/**
 * @fileOverview AI flow for suggesting UI improvements for the Verza project.
 *
 * - suggestUIImprovements - A function that suggests UI improvements based on best practices and the existing design.
 * - SuggestUIImprovementsInput - The input type for the suggestUIImprovements function.
 * - SuggestUIImprovementsOutput - The return type for the suggestUIImprovements function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestUIImprovementsInputSchema = z.object({
  projectDescription: z
    .string()
    .describe('A description of the Verza project, including its purpose, target users, and existing UI components.'),
  currentUIDesign: z
    .string()
    .describe('A detailed description of the current UI design, including layout, color scheme, typography, and key components.'),
  userFeedback: z
    .string()
    .optional()
    .describe('Optional: User feedback on the current UI design, highlighting pain points or areas for improvement.'),
});
export type SuggestUIImprovementsInput = z.infer<typeof SuggestUIImprovementsInputSchema>;

const SuggestUIImprovementsOutputSchema = z.object({
  suggestedImprovements: z
    .string()
    .describe('A list of suggested UI improvements, including specific recommendations for layout, color scheme, typography, component design, and user experience.'),
  rationale: z
    .string()
    .describe('The rationale behind each suggested improvement, explaining how it aligns with UI/UX best practices and addresses potential issues.'),
});
export type SuggestUIImprovementsOutput = z.infer<typeof SuggestUIImprovementsOutputSchema>;

export async function suggestUIImprovements(input: SuggestUIImprovementsInput): Promise<SuggestUIImprovementsOutput> {
  return suggestUIImprovementsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestUIImprovementsPrompt',
  input: {schema: SuggestUIImprovementsInputSchema},
  output: {schema: SuggestUIImprovementsOutputSchema},
  prompt: `You are an expert UI/UX designer tasked with suggesting improvements for the Verza project.\n\nBased on the project description, current UI design, and user feedback (if any), provide a list of actionable UI improvements.\nFor each improvement, explain the rationale behind it and how it aligns with UI/UX best practices.\n\nProject Description: {{{projectDescription}}}\nCurrent UI Design: {{{currentUIDesign}}}\nUser Feedback: {{{userFeedback}}}\n\nSuggested Improvements:
`, safetySettings: [
    {
      category: 'HARM_CATEGORY_HATE_SPEECH',
      threshold: 'BLOCK_ONLY_HIGH',
    },
    {
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    {
      category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      threshold: 'BLOCK_LOW_AND_ABOVE',
    },
  ],
});

const suggestUIImprovementsFlow = ai.defineFlow(
  {
    name: 'suggestUIImprovementsFlow',
    inputSchema: SuggestUIImprovementsInputSchema,
    outputSchema: SuggestUIImprovementsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

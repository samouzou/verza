// This file is machine-generated - edit at your own risk!

'use server';

/**
 * @fileOverview Generates a summary of an imported Verza project, including its main features, architecture, and dependencies.
 *
 * - generateProjectSummary - A function that generates a summary of the imported Verza project.
 * - GenerateProjectSummaryInput - The input type for the generateProjectSummary function.
 * - GenerateProjectSummaryOutput - The return type for the generateProjectSummary function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateProjectSummaryInputSchema = z.object({
  projectDescription: z
    .string()
    .describe(
      'A detailed description of the Verza project, including its purpose, features, architecture, and dependencies.'
    ),
});

export type GenerateProjectSummaryInput = z.infer<
  typeof GenerateProjectSummaryInputSchema
>;

const GenerateProjectSummaryOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      'A concise summary of the Verza project, highlighting its key aspects to help new team members quickly understand the project.'
    ),
});

export type GenerateProjectSummaryOutput = z.infer<
  typeof GenerateProjectSummaryOutputSchema
>;

export async function generateProjectSummary(
  input: GenerateProjectSummaryInput
): Promise<GenerateProjectSummaryOutput> {
  return generateProjectSummaryFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateProjectSummaryPrompt',
  input: {schema: GenerateProjectSummaryInputSchema},
  output: {schema: GenerateProjectSummaryOutputSchema},
  prompt: `You are an AI assistant tasked with summarizing software projects. A new team member is joining the team and needs to quickly understand the Verza project.

  Here is a detailed description of the project:
  {{projectDescription}}

  Generate a concise summary that highlights the project's main features, architecture, and key dependencies to help the new team member get up to speed.`,
});

const generateProjectSummaryFlow = ai.defineFlow(
  {
    name: 'generateProjectSummaryFlow',
    inputSchema: GenerateProjectSummaryInputSchema,
    outputSchema: GenerateProjectSummaryOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

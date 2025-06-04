'use server';

/**
 * @fileOverview AI flow to identify and suggest solutions for compatibility issues between the imported Verza project and the prototyping workspace.
 *
 * - resolveCompatibilityIssues - A function that handles the identification and resolution of compatibility issues.
 * - ResolveCompatibilityIssuesInput - The input type for the resolveCompatibilityIssues function.
 * - ResolveCompatibilityIssuesOutput - The return type for the resolveCompatibilityIssues function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ResolveCompatibilityIssuesInputSchema = z.object({
  verzaProjectConfig: z
    .string()
    .describe('The configuration of the imported Verza project.'),
  workspaceConfig: z.string().describe('The configuration of the prototyping workspace.'),
  knownIssues: z.string().optional().describe('Any known compatibility issues, if available.'),
});
export type ResolveCompatibilityIssuesInput = z.infer<
  typeof ResolveCompatibilityIssuesInputSchema
>;

const ResolveCompatibilityIssuesOutputSchema = z.object({
  identifiedIssues: z
    .array(z.string())
    .describe('A list of identified compatibility issues.'),
  suggestedSolutions: z
    .array(z.string())
    .describe('A list of suggested solutions for the identified issues.'),
  summary: z.string().describe('A summary of the compatibility analysis and resolutions.'),
});
export type ResolveCompatibilityIssuesOutput = z.infer<
  typeof ResolveCompatibilityIssuesOutputSchema
>;

export async function resolveCompatibilityIssues(
  input: ResolveCompatibilityIssuesInput
): Promise<ResolveCompatibilityIssuesOutput> {
  return resolveCompatibilityIssuesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'resolveCompatibilityIssuesPrompt',
  input: {schema: ResolveCompatibilityIssuesInputSchema},
  output: {schema: ResolveCompatibilityIssuesOutputSchema},
  prompt: `You are an AI expert in identifying and resolving compatibility issues between Firebase Studio projects and prototyping workspaces.

You are provided with the Verza project configuration and the prototyping workspace configuration.
Analyze these configurations to identify any compatibility issues.
If there are any known issues, they will be provided as well.

Verza Project Configuration:
{{verzaProjectConfig}}

Prototyping Workspace Configuration:
{{workspaceConfig}}

Known Issues (if any):
{{#if knownIssues}}
{{knownIssues}}
{{else}}
No known issues provided.
{{/if}}

Based on your analysis, provide a list of identified issues and suggested solutions.
Also, provide a summary of your analysis and the resolutions.
`,
});

const resolveCompatibilityIssuesFlow = ai.defineFlow(
  {
    name: 'resolveCompatibilityIssuesFlow',
    inputSchema: ResolveCompatibilityIssuesInputSchema,
    outputSchema: ResolveCompatibilityIssuesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

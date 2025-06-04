'use server';

/**
 * @fileOverview A code snippet generation AI agent.
 *
 * - generateCodeSnippets - A function that handles the code snippet generation process.
 * - GenerateCodeSnippetsInput - The input type for the generateCodeSnippets function.
 * - GenerateCodeSnippetsOutput - The return type for the generateCodeSnippets function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateCodeSnippetsInputSchema = z.object({
  projectContext: z
    .string()
    .describe('The context of the Verza project, including its structure and dependencies.'),
  taskDescription: z.string().describe('The current prototyping task the developer is working on.'),
  userPrompt: z.string().describe('The user prompt for generating code snippets.'),
});
export type GenerateCodeSnippetsInput = z.infer<typeof GenerateCodeSnippetsInputSchema>;

const GenerateCodeSnippetsOutputSchema = z.object({
  codeSnippet: z.string().describe('The generated code snippet based on the project context and task.'),
  explanation: z
    .string()
    .describe('An explanation of the generated code snippet and how it relates to the project and task.'),
});
export type GenerateCodeSnippetsOutput = z.infer<typeof GenerateCodeSnippetsOutputSchema>;

export async function generateCodeSnippets(input: GenerateCodeSnippetsInput): Promise<GenerateCodeSnippetsOutput> {
  return generateCodeSnippetsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateCodeSnippetsPrompt',
  input: {schema: GenerateCodeSnippetsInputSchema},
  output: {schema: GenerateCodeSnippetsOutputSchema},
  prompt: `You are an AI expert in generating code snippets for app prototyping, with a focus on the Verza project.

Given the Verza project's context:
{{{projectContext}}}

And the current prototyping task:
{{{taskDescription}}}

Generate a code snippet that addresses the following user prompt:
{{{userPrompt}}}

Also, provide a brief explanation of the generated code snippet and how it relates to the project and task.

Make sure the code snippet is compatible with the Verza project and the prototyping workspace.
`,
});

const generateCodeSnippetsFlow = ai.defineFlow(
  {
    name: 'generateCodeSnippetsFlow',
    inputSchema: GenerateCodeSnippetsInputSchema,
    outputSchema: GenerateCodeSnippetsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

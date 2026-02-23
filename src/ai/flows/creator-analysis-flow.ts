
'use server';
/**
 * @fileOverview Analyzes a creator's social media content to generate brand insights.
 *
 * - analyzeCreatorProfile - A function that generates brand insights for a creator.
 * - CreatorAnalysisInput - The input type for the function.
 * - CreatorAnalysisOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'genkit';

export const CreatorAnalysisInputSchema = z.object({
  profileContent: z.string().describe('A collection of text from a creator\'s profile, such as their bio, post captions, and video transcripts.'),
});
export type CreatorAnalysisInput = z.infer<typeof CreatorAnalysisInputSchema>;

export const CreatorAnalysisOutputSchema = z.object({
  missionStatement: z.string().describe("The creator's 'why' or mission statement, distilled from their content."),
  brandWishlist: z.array(z.string()).describe("A wishlist of 5 brands that would be a good fit for the creator to work with."),
  niche: z.string().describe("A specific definition of the creator's unique selling proposition (USP) or niche."),
});
export type CreatorAnalysisOutput = z.infer<typeof CreatorAnalysisOutputSchema>;

export async function analyzeCreatorProfile(input: CreatorAnalysisInput): Promise<CreatorAnalysisOutput> {
  return creatorAnalysisFlow(input);
}

const prompt = ai.definePrompt({
  name: 'creatorAnalysisPrompt',
  model: googleAI.model('gemini-3-flash-preview'),
  input: { schema: CreatorAnalysisInputSchema },
  output: { schema: CreatorAnalysisOutputSchema },
  prompt: `You are a world-class brand strategist and talent manager for content creators.
  Your task is to analyze the provided content from a creator's social media profile and generate key brand identity insights.

  Analyze the following content:
  ---
  {{{profileContent}}}
  ---

  Based on this content, you MUST generate the following:
  1.  **missionStatement**: A concise and powerful mission statement that encapsulates the creator's purpose and what they stand for. What is their "why"?
  2.  **brandWishlist**: A list of exactly 5 specific brands that would be an ideal fit for this creator to collaborate with, based on their content, style, and audience.
  3.  **niche**: A clear and specific definition of the creator's unique selling proposition (USP) or niche. Go beyond broad categories like "fashion" and define what makes them unique (e.g., "Vintage 70s-inspired sustainable fashion for petite body types").
  `,
});

const creatorAnalysisFlow = ai.defineFlow(
  {
    name: 'creatorAnalysisFlow',
    inputSchema: CreatorAnalysisInputSchema,
    outputSchema: CreatorAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);

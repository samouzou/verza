
'use server';
/**
 * @fileOverview "The Gauntlet" - An AI flow that simulates 10,000 Gen Z distractable scrollers to score a video.
 *
 * - runGauntlet - A function that analyzes a video and returns a score and feedback.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'kit';

const GauntletInputSchema = z.object({
  videoUrl: z.string().url().describe('The URL of the video to analyze.'),
});
export type GauntletInput = z.infer<typeof GauntletInputSchema>;

const GauntletOutputSchema = z.object({
  score: z.number().min(0).max(100).describe('The overall attention score (0-100). 65+ is required to pass.'),
  feedback: z.string().describe('Ruthless, actionable feedback from the perspective of 10k Gen Z scrollers.'),
  hookScore: z.number().describe('Score for the first 3 seconds (0-100).'),
  pacingScore: z.number().describe('Score for the overall rhythm and editing speed (0-100).'),
  vibeScore: z.number().describe('Score for visual aesthetic and trend relevance (0-100).'),
});
export type GauntletOutput = z.infer<typeof GauntletOutputSchema>;

export async function runGauntlet(input: GauntletInput): Promise<GauntletOutput> {
  return gauntletFlow(input);
}

const prompt = ai.definePrompt({
  name: 'gauntletPrompt',
  model: googleAI.model('gemini-1.5-flash'),
  input: { schema: GauntletInputSchema },
  output: { schema: GauntletOutputSchema },
  prompt: `You are "The Gauntlet", a simulation of 10,000 Gen Z distractable social media scrollers. 
  Your goal is to be ruthless. You have zero attention span. 
  
  Analyze the video at this URL: {{videoUrl}}
  
  Score it based on:
  1. **Hook**: Did you scroll past in the first 1.5 seconds? Was there a visual or audio pattern interrupt?
  2. **Pacing**: Is it dragging? Are there dead frames? Is the editing "snappy"?
  3. **Vibe**: Does it look like an ad (bad) or authentic content (good)? Is it high-quality visual storytelling?
  
  The overall **score** is a weighted average but should prioritize the Hook (50%).
  
  Provide ruthlessly honest feedback. Use lowercase and slang where appropriate, but keep it professional enough for a brand to see. 
  Example feedback: "the hook was mid. lighting is flat. you took 4 seconds to say hi, i'm already scrolled. fix the opening."
  
  Video: {{media url=videoUrl}}
  `,
});

const gauntletFlow = ai.defineFlow(
  {
    name: 'gauntletFlow',
    inputSchema: GauntletInputSchema,
    outputSchema: GauntletOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);

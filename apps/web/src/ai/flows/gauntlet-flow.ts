
'use server';
/**
 * @fileOverview Verza Score Analysis - An AI flow that simulates 10,000 Gen Z distractable scrollers to score a video.
 *
 * - runVerzaScore - A function that analyzes a video and returns a score and feedback.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'genkit';

const VerzaScoreInputSchema = z.object({
  videoUrl: z.string().url().describe('The URL of the video to analyze.'),
  isYouTube: z.boolean().optional(),
});
export type VerzaScoreInput = z.infer<typeof VerzaScoreInputSchema>;

const VerzaScoreOutputSchema = z.object({
  score: z.number().min(0).max(100).describe('The overall attention score (0-100). 65+ is required to pass.'),
  feedback: z.string().describe('Ruthless, actionable feedback from the perspective of 10k Gen Z scrollers.'),
  hookScore: z.number().describe('Score for the first 3 seconds (0-100).'),
  pacingScore: z.number().describe('Score for the overall rhythm and editing speed (0-100).'),
  vibeScore: z.number().describe('Score for visual aesthetic and trend relevance (0-100).'),
});
export type VerzaScoreOutput = z.infer<typeof VerzaScoreOutputSchema>;

export async function runVerzaScore(input: VerzaScoreInput): Promise<VerzaScoreOutput> {
  return verzaScoreFlow(input);
}

const shortFormPrompt = ai.definePrompt({
  name: 'shortFormPrompt',
  model: googleAI.model('gemini-3-flash-preview'),
  input: { schema: VerzaScoreInputSchema },
  output: { schema: VerzaScoreOutputSchema },
  prompt: `You are the "Verza Score" algorithm, a simulation of 10,000 Gen Z distractable social media scrollers. 
  Your goal is to be ruthless. You have zero attention span. 
  
  Analyze the video at this URL: {{videoUrl}}
  
  Score it based on:
  1. **Hook**: Did you scroll past in the first 1.5 seconds? Was there a visual or audio pattern interrupt?
  2. **Pacing**: Is it dragging? Are there dead frames? Is the editing "snappy"?
  3. **Vibe**: Does it look like an ad (bad) or authentic content (good)? Is it high-quality visual storytelling?
  
  The overall **score** is a weighted average but should prioritize the Hook (50%).
  
  Provide ruthlessly honest feedback. Use lowercase and slang where appropriate, but keep it professional enough for a brand to see. 
  Example feedback: "the hook was mid. lighting is flat. you took 4 seconds to say hi, i'm already scrolled. fix the opening."
  
  {{#unless isYouTube}}
  Video: {{media url=videoUrl}}
  {{/unless}}
  `,
});

const longFormPrompt = ai.definePrompt({
  name: 'longFormPrompt',
  model: googleAI.model('gemini-3-flash-preview'),
  input: { schema: VerzaScoreInputSchema },
  output: { schema: VerzaScoreOutputSchema },
  prompt: `You are the "Verza Score" algorithm, designed to evaluate long-form YouTube integrations and dedicated videos.
  Unlike short-form content, YouTube videos rely on storytelling, trust-building, and audience retention.

  Analyze the YouTube video at this URL: {{videoUrl}}
  
  Score it based on:
  1. **Integration / Hook**: Does the creator introduce the topic or sponsor smoothly without it feeling jarring?
  2. **Pacing & Retention**: Is the storytelling compelling? Even for long-form, are there enough visual changes (B-roll, zoom cuts) to retain modern audiences?
  3. **Vibe & Authenticity**: Does the content feel authentic to the creator's audience, or does it feel like a forced, robotic corporate ad?

  The overall **score** is a weighted average (0-100) focused on storytelling and retention potential.

  Provide ruthlessly honest feedback but adapted for YouTube. If it's a 10-minute video, don't penalize it for not jumping to the point in 1 second, but do penalize it if the first 30 seconds are boring. Use professional but direct language.
  
  Example feedback: "the intro storytelling was fantastic, but the sponsor integration at 3:00 felt forced and read like a script. pacing lags in the middle. good B-roll."
  `,
});

const verzaScoreFlow = ai.defineFlow(
  {
    name: 'verzaScoreFlow',
    inputSchema: VerzaScoreInputSchema,
    outputSchema: VerzaScoreOutputSchema,
  },
  async (input) => {
    const { output } = input.isYouTube 
      ? await longFormPrompt(input)
      : await shortFormPrompt(input);
    return output!;
  }
);


"use server";
/**
 * @fileOverview Analyzes brand website data for a pitch attack plan.
 *
 * - analyzeBrandWebsite - A function that generates the analysis.
 * - BrandAnalysisInput - The input type for the function.
 * - BrandAnalysisOutput - The return type for the function.
 */

import {ai} from "../genkit";
import {googleAI} from "@genkit-ai/google-genai";
import {z} from "genkit";
import {retry} from "genkit/actions";

export const BrandAnalysisInputSchema = z.object({
  brandUrl: z.string().url().describe("The URL of the brand website."),
  websiteText: z.string().describe("The raw text content from the brand's website."),
});
export type BrandAnalysisInput = z.infer<typeof BrandAnalysisInputSchema>;

export const BrandAnalysisOutputSchema = z.object({
  brandName: z.string().describe("The name of the brand, extracted from the content."),
  decisionMakers: z.array(z.string()).describe("A list of likely job titles of decision-makers" +
    "(e.g., \"CMO\", \"Head of Influencer Marketing\"). Do not include names."),
  currentVibe: z.string().describe("A summary of the brand's current marketing aesthetic and voice."),
  pitchHooks: z.array(z.string()).length(3).describe("Three specific, actionable pitch hooks a creator" +
    "could use to sell them UGC content."),
});
export type BrandAnalysisOutput = z.infer<typeof BrandAnalysisOutputSchema>;

/**
 * Analyzes a brand's website to generate a "Pitch Attack Plan".
 * @param {BrandAnalysisInput} input The brand URL and website text.
 * @return {Promise<BrandAnalysisOutput>} The structured analysis report.
 */
export async function analyzeBrandWebsite(input: BrandAnalysisInput): Promise<BrandAnalysisOutput> {
  return brandAnalysisFlow(input);
}

const prompt = ai.definePrompt({
  name: "brandAnalysisPrompt",
  model: googleAI.model("gemini-2.0-flash"),
  input: {schema: BrandAnalysisInputSchema},
  output: {schema: BrandAnalysisOutputSchema},
  prompt: `You are an expert Talent Manager and brand strategist. Analyze the following text
  content scraped from a brand's website. Your goal is to create a "Pitch Attack Plan" for a content creator.

  Website URL: {{{brandUrl}}}
  Website Content:
  ---
  {{{websiteText}}}
  ---

  Based on the provided content, you MUST extract the following information and structure it as JSON:

  1.  **brandName**: Identify the name of the brand.
  2.  **decisionMakers**: Identify the likely job *titles* of marketing decision-makers. 
  Do NOT invent names. Focus on roles like "CMO", "Head of Brand", "Influencer Marketing Manager",
  "Social Media Director".
  3.  **currentVibe**: Summarize the brand's current marketing aesthetic, voice, and target audience. 
  What is their vibe? (e.g., "Minimalist and eco-conscious," "Edgy and youth-focused," "Luxurious and aspirational").
  4.  **pitchHooks**: Generate exactly three specific and creative pitch hooks a content creator could use to sell 
  them User-Generated Content (UGC) or an influencer partnership. These should be tailored to the brand's vibe and products.
  `,
});

const brandAnalysisFlow = ai.defineFlow(
  {
    name: "brandAnalysisFlow",
    inputSchema: BrandAnalysisInputSchema,
    outputSchema: BrandAnalysisOutputSchema,
  },
  retry({
    backoff: {
      delay: "2s",
      maxDelay: "30s",
      multiplier: 2,
    },
    maxAttempts: 5,
    when: (e) => (e as any).status === 429,
  })(async (input) => {
    const {output} = await prompt(input);
    return output!;
  })
);

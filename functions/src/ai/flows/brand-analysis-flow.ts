
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

export const BrandAnalysisInputSchema = z.object({
  brandUrl: z.string().url().describe("The URL of the brand website."),
  websiteText: z.string().describe("The raw text content from the brand's website."),
});
export type BrandAnalysisInput = z.infer<typeof BrandAnalysisInputSchema>;

const DecisionMakerSchema = z.object({
  name: z.string().optional().describe("The person's full name, if available."),
  title: z.string().describe("The person's job title (e.g., 'Head of Marketing')."),
  email: z.string().email().optional().describe("The person's email address, if available."),
});

const EmailPitchSchema = z.object({
  subject: z.string().describe("A compelling subject line for the pitch email."),
  body: z.string().describe("The full body of the pitch email, personalized for the brand." +
    " Use placeholders like [Your Name] and [Your Portfolio Link]."),
});

export const BrandAnalysisOutputSchema = z.object({
  brandName: z.string().describe("The name of the brand, extracted from the content."),
  decisionMakers: z.array(DecisionMakerSchema).describe("A list of potential decision-makers at the company," +
    " including their name, title, and email if available."),
  currentVibe: z.string().describe("A summary of the brand's current marketing aesthetic and voice."),
  pitchHooks: z.array(z.string()).length(3).describe("Three specific, actionable pitch hooks a creator" +
    " could use to sell them UGC content."),
  emailPitches: z.array(EmailPitchSchema).length(2).describe("Two distinct, ready-to-send cold email" +
    " pitches tailored to the brand."),
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
  model: googleAI.model("gemini-3-flash-preview"),
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
  2.  **decisionMakers**: Identify potential marketing decision-makers. Always include their job **title**. If their full **name**
  and/or **email** are available on the website, include those as well. If no specific person is found, provide likely job titles 
  (e.g., "CMO", "Head of Influencer Marketing").
  3.  **currentVibe**: Summarize the brand's current marketing aesthetic, voice, and target audience. What is their vibe? 
  (e.g., "Minimalist and eco-conscious," "Edgy and youth-focused").
  4.  **pitchHooks**: Generate exactly three specific and creative pitch hooks a creator could use to sell them 
  User-Generated Content (UGC)or an influencer partnership.
  5.  **emailPitches**: Draft exactly two distinct, ready-to-send cold email pitches tailored to the brand. 
  The emails should be professional, concise, and compelling. Use placeholders like '[Your Name]' 
  and '[Your Portfolio Link]' for the creator's name and portfolio. Each pitch should have a 'subject' and a 'body'.
  `,
});

const brandAnalysisFlow = ai.defineFlow(
  {
    name: "brandAnalysisFlow",
    inputSchema: BrandAnalysisInputSchema,
    outputSchema: BrandAnalysisOutputSchema,
  },
  async (input: BrandAnalysisInput) => {
    const maxAttempts = 5;
    let delay = 2000; // start with 2 seconds

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const {output} = await prompt(input);
        return output!;
      } catch (e: any) {
        // Check for a 429 status code and retry if it's not the last attempt
        if (e.status === 429 && i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          if (delay > 30000) delay = 30000; // Cap delay at 30 seconds
        } else {
          // If it's the last attempt or not a 429 error, re-throw.
          throw e;
        }
      }
    }
    // This line is for TypeScript's benefit and should not be reached.
    throw new Error("Flow failed after multiple retries.");
  }
);

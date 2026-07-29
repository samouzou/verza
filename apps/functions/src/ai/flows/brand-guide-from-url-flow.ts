/**
 * @fileOverview Extracts Brand Guide fields from scraped website content.
 */

import {ai} from "../genkit";
import {googleAI} from "@genkit-ai/google-genai";
import {z} from "genkit";

export const BrandGuideFromUrlInputSchema = z.object({
  brandUrl: z.string().url().describe("The brand website URL."),
  websiteText: z.string().describe("Visible text scraped from the brand homepage."),
  colorHints: z
    .array(z.string())
    .optional()
    .describe("Hex colors observed in HTML/CSS (theme-color, styles)."),
  logoCandidates: z
    .array(z.string())
    .optional()
    .describe("Absolute image URLs that may be the brand logo."),
});
export type BrandGuideFromUrlInput = z.infer<typeof BrandGuideFromUrlInputSchema>;

export const BrandGuideFromUrlOutputSchema = z.object({
  brandName: z.string().describe("Brand or company name."),
  missionStatement: z
    .string()
    .describe("1–3 sentence core value proposition in the brand's own voice."),
  toneOfVoice: z
    .string()
    .describe("Short description of brand voice (e.g. warm, clinical, playful)."),
  typography: z
    .string()
    .describe("Font guidance if detectable (e.g. 'Inter / system sans'), else a sensible suggestion."),
  primaryColor: z
    .string()
    .describe("Primary brand color as #RRGGBB."),
  secondaryColor: z
    .string()
    .describe("Secondary / background color as #RRGGBB."),
  accentColor: z
    .string()
    .describe("Accent / CTA color as #RRGGBB."),
  neutralColor: z
    .string()
    .describe("Neutral surface color as #RRGGBB."),
  logoUrl: z
    .string()
    .optional()
    .describe("Best logo URL from logoCandidates, or empty if none are suitable."),
  dos: z
    .array(z.string())
    .max(6)
    .describe("3–6 creator-facing 'do' guidelines inferred from the brand."),
  donts: z
    .array(z.string())
    .max(6)
    .describe("3–6 creator-facing 'don't' guidelines inferred from the brand."),
});
export type BrandGuideFromUrlOutput = z.infer<typeof BrandGuideFromUrlOutputSchema>;

/**
 * Infers Brand Guide fields from scraped website content.
 * @param {BrandGuideFromUrlInput} input URL, text, and scrape hints.
 * @return {Promise<BrandGuideFromUrlOutput>} Structured guide draft.
 */
export async function extractBrandGuideFromUrl(
  input: BrandGuideFromUrlInput
): Promise<BrandGuideFromUrlOutput> {
  return brandGuideFromUrlFlow(input);
}

const prompt = ai.definePrompt({
  name: "brandGuideFromUrlPrompt",
  model: googleAI.model("gemini-3-flash-preview"),
  input: {schema: BrandGuideFromUrlInputSchema},
  output: {schema: BrandGuideFromUrlOutputSchema},
  prompt: `You are a brand strategist filling a Brand Guide for influencer / UGC campaigns.

Website URL: {{{brandUrl}}}

Hex color hints from the page (may be incomplete or noisy):
{{#if colorHints}}
{{#each colorHints}}
- {{this}}
{{/each}}
{{else}}
(none)
{{/if}}

Logo URL candidates (prefer a clear brand mark over a photo or favicon):
{{#if logoCandidates}}
{{#each logoCandidates}}
- {{this}}
{{/each}}
{{else}}
(none)
{{/if}}

Website content:
---
{{{websiteText}}}
---

Return a practical Brand Guide draft. Rules:
- Colors MUST be valid 6-digit hex like #0E7C5A (uppercase or lowercase fine).
- Prefer colorHints when they look like real brand colors; otherwise infer from vibe.
- secondaryColor is often a light background; primaryColor is the main brand color; accentColor is for CTAs.
- missionStatement should sound like the brand, not generic marketing fluff.
- toneOfVoice should be usable by creators (e.g. "Warm, confident, no jargon").
- dos / donts are instructions for creators making content for this brand — specific and actionable.
- logoUrl: pick the best absolute URL from logoCandidates, or omit if none look like a logo.
- Do not invent asset drive links or b-roll.
`,
});

const brandGuideFromUrlFlow = ai.defineFlow(
  {
    name: "brandGuideFromUrlFlow",
    inputSchema: BrandGuideFromUrlInputSchema,
    outputSchema: BrandGuideFromUrlOutputSchema,
  },
  async (input: BrandGuideFromUrlInput) => {
    const maxAttempts = 5;
    let delay = 2000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const {output} = await prompt(input);
        if (!output) throw new Error("Model returned empty brand guide.");
        return output;
      } catch (e: unknown) {
        const status = (e as {status?: number})?.status;
        if (status === 429 && i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 30000);
        } else {
          throw e;
        }
      }
    }
    throw new Error("Brand guide extraction failed after multiple retries.");
  }
);

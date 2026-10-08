import {createHash} from "node:crypto";
import {googleAI} from "@genkit-ai/google-genai";
import {z} from "genkit";
import * as logger from "firebase-functions/logger";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import type {DocumentReference} from "firebase-admin/firestore";
import {ai} from "../ai/genkit";

const MODEL = "gemini-3.6-flash";
export const QUOTED_RATE_MAX_USD = 10_000_000;
/** Skip the model for notes that can't contain a price. */
const MAYBE_PRICE = /\d/;

const QuotedRateSchema = z.object({
  rateUsd: z.number().nullable().describe(
    "Total USD fee the creator quoted for one sponsorship package, or null if no usable USD price."
  ),
});

/**
 * Stable fingerprint so each note is only sent to the model once.
 * @param {string} note CRM note.
 * @return {string} Short hash.
 */
export function quotedRateNoteHash(note: string): string {
  return createHash("sha256").update(note.trim()).digest("hex").slice(0, 16);
}

/**
 * Reads a creator's quoted fee out of a free-text CRM note.
 * @param {string} note CRM note.
 * @return {Promise<number | null>} USD amount, or null when the note has no usable price.
 */
export async function extractQuotedRateUsd(note: string): Promise<number | null> {
  const text = note.trim();
  if (!text || !MAYBE_PRICE.test(text)) return null;
  const {output} = await ai.generate({
    model: googleAI.model(MODEL),
    prompt: `A brand's team wrote this note about a creator during sponsorship outreach.
Return the creator's quoted fee in USD for ONE sponsorship package.
- "1.5k" means 1500. For a range, use the midpoint.
- If several packages are listed, use the one closest to a single sponsored post or video.
- If the note gives a per-unit price and a quantity for one package, return the package total.
- If the price is not in USD (or unmarked dollars), or there is no price, return null.
- Ignore follower counts, view counts, dates, and the brand's own budget.
- Performance pay (per sign-up, per sale, per click, commission, affiliate %) is NOT a fee. If the creator only
  agreed to performance pay, return null; if they also quoted a fixed fee, return just the fixed fee.

NOTE:
${text}`,
    output: {schema: QuotedRateSchema},
  });
  const rate = output?.rateUsd;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > QUOTED_RATE_MAX_USD) return null;
  return Math.round(rate * 100) / 100;
}

/**
 * Fills `quotedRateUsd` from the note unless the team typed a rate by hand.
 * @param {DocumentReference} ref Lead document.
 * @param {FirebaseFirestore.DocumentData} lead Lead data.
 * @return {Promise<number | null | undefined>} New rate, or undefined when nothing changed.
 */
export async function syncQuotedRateFromNote(
  ref: DocumentReference,
  lead: FirebaseFirestore.DocumentData
): Promise<number | null | undefined> {
  if (lead.quotedRateSource === "manual") return undefined;
  const note = typeof lead.crmNote === "string" ? lead.crmNote.trim() : "";
  const hash = note ? quotedRateNoteHash(note) : null;
  if (hash === (lead.quotedRateNoteHash ?? null)) return undefined;
  let rate: number | null = null;
  try {
    rate = note ? await extractQuotedRateUsd(note) : null;
  } catch (e) {
    logger.warn("[Optic] quoted rate extraction failed", {leadId: ref.id, error: e instanceof Error ? e.message : String(e)});
    return undefined;
  }
  await ref.update({
    quotedRateUsd: rate,
    quotedRateSource: rate == null ? null : "ai",
    quotedRateNoteHash: hash,
  });
  return rate;
}

/** Keeps the AI-read quoted rate in step with the CRM note. */
export const extractOpticLeadQuotedRate = onDocumentWritten("optic_outreach_leads/{leadId}", async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const beforeNote = event.data?.before?.data()?.crmNote ?? null;
  const data = after.data()!;
  if ((data.crmNote ?? null) === beforeNote) return;
  await syncQuotedRateFromNote(after.ref, data);
});

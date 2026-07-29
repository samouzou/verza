
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import axios from "axios";
import * as cheerio from "cheerio";
import {analyzeBrandWebsite, type BrandAnalysisOutput} from "../ai/flows/brand-analysis-flow";
import {extractBrandGuideFromUrl} from "../ai/flows/brand-guide-from-url-flow";
import type {BrandResearch} from "./../types";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type CheerioRoot = ReturnType<typeof cheerio.load>;

const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
const MAX_SITE_TEXT = 40_000;

/**
 * Ensures the URL has a scheme so axios and Zod URL validation accept it.
 * @param {string} raw User-entered URL or domain.
 * @return {string} Absolute http(s) URL.
 */
function normalizeBrandUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Expands #RGB to #RRGGBB and lowercases.
 * @param {string} hex Color string.
 * @return {?string} Normalized hex or null.
 */
function normalizeHex(hex: string): string | null {
  const m = hex.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let body = m[1].toLowerCase();
  if (body.length === 3) {
    body = body.split("").map((c) => c + c).join("");
  }
  return `#${body}`;
}

/**
 * Collects hex colors from theme-color and inline CSS snippets.
 * @param {CheerioRoot} $ Parsed HTML.
 * @param {string} html Raw HTML for style regex.
 * @return {string[]} Unique normalized hex colors (capped).
 */
function extractColorHints($: CheerioRoot, html: string): string[] {
  const found = new Set<string>();
  const theme = $('meta[name="theme-color"]').attr("content");
  if (theme) {
    const n = normalizeHex(theme);
    if (n) found.add(n);
  }
  const ms = $('meta[name="msapplication-TileColor"]').attr("content");
  if (ms) {
    const n = normalizeHex(ms);
    if (n) found.add(n);
  }
  const matches = html.match(HEX_RE) || [];
  for (const match of matches) {
    const n = normalizeHex(match);
    if (n) found.add(n);
    if (found.size >= 24) break;
  }
  return Array.from(found);
}

/**
 * Resolves relative asset URLs against the page origin.
 * @param {string} pageUrl Page URL.
 * @param {string} href Relative or absolute href.
 * @return {?string} Absolute URL or null.
 */
function absolutize(pageUrl: string, href: string | undefined): string | null {
  if (!href || href.startsWith("data:")) return null;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Picks likely logo image URLs from common meta/link/header locations.
 * @param {CheerioRoot} $ Parsed HTML.
 * @param {string} pageUrl Page URL for resolving relatives.
 * @return {string[]} Absolute logo candidate URLs.
 */
function extractLogoCandidates($: CheerioRoot, pageUrl: string): string[] {
  const candidates: string[] = [];
  const push = (href: string | undefined) => {
    const abs = absolutize(pageUrl, href);
    if (abs && !candidates.includes(abs)) candidates.push(abs);
  };

  push($('meta[property="og:image"]').attr("content"));
  push($('meta[name="twitter:image"]').attr("content"));
  push($('link[rel="apple-touch-icon"]').attr("href"));
  push($('link[rel="icon"]').attr("href"));
  push($('link[rel="shortcut icon"]').attr("href"));

  $("header img, [class*='logo'] img, img[class*='logo'], img[alt*='logo']").each(
    (_i: number, el: cheerio.Element) => {
      if (candidates.length >= 8) return false;
      push($(el).attr("src"));
      return undefined;
    }
  );

  return candidates.slice(0, 8);
}

/**
 * Fetches a brand page and returns cleaned text plus scrape hints.
 * @param {string} brandUrl Absolute brand URL.
 * @return {Promise<{websiteText: string, colorHints: string[], logoCandidates: string[]}>}
 */
async function scrapeBrandPage(brandUrl: string): Promise<{
  websiteText: string;
  colorHints: string[];
  logoCandidates: string[];
}> {
  const {data: html} = await axios.get(brandUrl, {
    timeout: 12000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; VerzaBrandGuide/1.0; +https://tryverza.com)",
      Accept: "text/html,application/xhtml+xml",
    },
    maxRedirects: 5,
    responseType: "text",
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const $ = cheerio.load(typeof html === "string" ? html : String(html));
  const colorHints = extractColorHints($, typeof html === "string" ? html : String(html));
  const logoCandidates = extractLogoCandidates($, brandUrl);

  $("script, style, noscript, svg").remove();
  const websiteText = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_SITE_TEXT);

  if (!websiteText || websiteText.length < 40) {
    throw new Error("Could not extract enough text from that website. Try the homepage URL.");
  }

  return {websiteText, colorHints, logoCandidates};
}

export const analyzeBrand = onCall({
  timeoutSeconds: 300,
  memory: "1GiB",
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const brandUrl = normalizeBrandUrl(String(request.data?.brandUrl ?? ""));
  const uid = request.auth.uid;

  if (!brandUrl) {
    throw new HttpsError("invalid-argument", "A valid 'brandUrl' is required.");
  }

  const researchDocRef = db.collection("brand_research").doc();
  const initialData: BrandResearch = {
    id: researchDocRef.id,
    uid,
    brandUrl,
    brandName: "Analyzing...",
    status: "pending",
    createdAt: FieldValue.serverTimestamp() as any,
  };
  await researchDocRef.set(initialData);

  try {
    // 1. Fetch HTML content
    const {data: html} = await axios.get(brandUrl, {timeout: 10000});
    const $ = cheerio.load(html);
    // Remove script, style, and nav tags for cleaner text
    $("script, style, nav, footer, header").remove();
    const websiteText = $("body").text().replace(/\s\s+/g, " ").trim();

    if (!websiteText) {
      throw new Error("Could not extract text content from the website.");
    }

    // 2. Pass to AI flow
    const analysisResult: BrandAnalysisOutput = await analyzeBrandWebsite({brandUrl, websiteText});

    // 3. Save result to Firestore
    const finalData: Partial<BrandResearch> = {
      brandName: analysisResult.brandName,
      status: "completed",
      report: {
        decisionMakers: analysisResult.decisionMakers,
        currentVibe: analysisResult.currentVibe,
        pitchHooks: analysisResult.pitchHooks,
        emailPitches: analysisResult.emailPitches,
      },
    };
    await researchDocRef.update(finalData);

    return {success: true, researchId: researchDocRef.id, report: finalData};
  } catch (error: any) {
    logger.error(`Error analyzing brand URL ${brandUrl} for user ${uid}:`, error);

    const errorData: Partial<BrandResearch> = {
      status: "failed",
      brandName: "Analysis Failed",
      error: error.message || "An unknown error occurred.",
    };
    await researchDocRef.update(errorData);

    if (axios.isAxiosError(error)) {
      throw new HttpsError("internal", `Could not fetch the URL. Status: ${error.response?.status}`);
    }
    throw new HttpsError("internal", error.message || "Failed to analyze the brand.");
  }
});

/**
 * Scrapes a brand homepage and returns a Brand Guide draft for the client to edit.
 * Does not write to the agency — the user reviews and saves on /agency/brand-guide.
 */
export const suggestBrandGuideFromUrl = onCall({
  timeoutSeconds: 120,
  memory: "1GiB",
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const brandUrl = normalizeBrandUrl(String(request.data?.brandUrl ?? ""));
  if (!brandUrl) {
    throw new HttpsError("invalid-argument", "Enter a website URL.");
  }

  try {
    // Validate URL shape before fetch.
    // eslint-disable-next-line no-new
    new URL(brandUrl);
  } catch {
    throw new HttpsError("invalid-argument", "That doesn’t look like a valid URL.");
  }

  try {
    const {websiteText, colorHints, logoCandidates} = await scrapeBrandPage(brandUrl);
    const draft = await extractBrandGuideFromUrl({
      brandUrl,
      websiteText,
      colorHints,
      logoCandidates,
    });

    const pickColor = (value: string | undefined, fallback: string) =>
      normalizeHex(value || "") || fallback;

    return {
      success: true as const,
      brandUrl,
      brandName: draft.brandName,
      guide: {
        missionStatement: draft.missionStatement?.trim() || "",
        toneOfVoice: draft.toneOfVoice?.trim() || "",
        typography: draft.typography?.trim() || "",
        primaryColor: pickColor(draft.primaryColor, "#0e7c5a"),
        secondaryColor: pickColor(draft.secondaryColor, "#ffffff"),
        accentColor: pickColor(draft.accentColor, "#16c088"),
        neutralColor: pickColor(draft.neutralColor, "#f4f4f5"),
        logoUrl: draft.logoUrl?.trim() || logoCandidates[0] || "",
        dos: (draft.dos || []).map((s) => s.trim()).filter(Boolean).slice(0, 6),
        donts: (draft.donts || []).map((s) => s.trim()).filter(Boolean).slice(0, 6),
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[suggestBrandGuideFromUrl] failed", {brandUrl, message});

    if (axios.isAxiosError(error)) {
      throw new HttpsError(
        "failed-precondition",
        `We couldn’t open that site${error.response?.status ? ` (${error.response.status})` : ""}. Try the homepage URL.`
      );
    }
    throw new HttpsError("internal", message || "Could not look up branding from that URL.");
  }
});

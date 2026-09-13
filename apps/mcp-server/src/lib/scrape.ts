import * as cheerio from "cheerio";

const MAX_SITE_TEXT = 40_000;

export function normalizeProductUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Fetches a product/brand page and returns cleaned text for campaign drafting.
 */
export async function scrapeProductPage(productUrl: string): Promise<{
  url: string;
  title: string | null;
  description: string | null;
  websiteText: string;
}> {
  const url = normalizeProductUrl(productUrl);
  // Validate
  // eslint-disable-next-line no-new
  new URL(url);

  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; VerzaCampaignDraft/1.0; +https://tryverza.com)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`Could not fetch URL (${res.status}). Try the product or homepage link.`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").first().text().trim() ||
    null;
  const description =
    $('meta[property="og:description"]').attr("content")?.trim() ||
    $('meta[name="description"]').attr("content")?.trim() ||
    null;

  $("script, style, noscript, svg, nav, footer").remove();
  const websiteText = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_SITE_TEXT);
  if (!websiteText || websiteText.length < 40) {
    throw new Error("Could not extract enough text from that page. Try a product or homepage URL.");
  }

  return {url, title, description, websiteText};
}

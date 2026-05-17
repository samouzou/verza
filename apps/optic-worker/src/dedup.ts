import type {Firestore} from "firebase-admin/firestore";

/**
 * Normalizes profile URLs for duplicate detection (host + path, no trailing slash).
 * @param {string} url Raw profile URL.
 * @return {string} Comparable key.
 */
export function normalizeProfileUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    let path = u.pathname.replace(/\/$/, "") || "";
    path = path.toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Loads profile URLs already saved for this brand (optionally scoped to one campaign).
 * @param {Firestore} db Firestore instance.
 * @param {string} agencyId Brand workspace id.
 * @param {string | null} campaignId When set, includes vault leads for this campaign and agency-wide pooled leads.
 * @return {Promise<Set<string>>} Normalized profile URL keys.
 */
export async function loadExistingProfileUrlKeys(
  db: Firestore,
  agencyId: string,
  campaignId: string | null
): Promise<Set<string>> {
  const snap = await db.collection("optic_outreach_leads").where("agencyId", "==", agencyId).get();

  const keys = new Set<string>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const url = data.profileUrl;
    if (typeof url !== "string" || !url.trim()) continue;

    const leadCampaignId =
      typeof data.campaignId === "string" && data.campaignId.trim() ? data.campaignId.trim() : null;

    if (campaignId) {
      const sameCampaign = leadCampaignId === campaignId;
      const pooled = leadCampaignId === null;
      if (!sameCampaign && !pooled) continue;
    }

    keys.add(normalizeProfileUrl(url));
  }
  return keys;
}

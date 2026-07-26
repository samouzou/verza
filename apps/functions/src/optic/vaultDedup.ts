import type {Firestore} from "firebase-admin/firestore";
import {normalizeProfileUrl} from "./profileUrl";

/** Cap on handles fed into the planner prompt so the token cost stays bounded. */
const PLANNER_EXCLUDE_CAP = 200;

/** Cap on handles shipped to the extension so the claim payload stays small. */
const CLIENT_EXCLUDE_CAP = 1000;

export type VaultExclusions = {
  /** Normalized `host/path` keys for every lead already in this brand's vault. */
  keys: Set<string>;
  /** Instagram handles for the extension to skip before opening a tab. */
  usernames: string[];
  /** Shorter handle list for the Gemini planning prompt. */
  plannerUsernames: string[];
};

/**
 * Loads profile URLs already saved for this brand, matching how the Cloud Run worker
 * scopes duplicates: leads on the same campaign plus agency-wide pooled leads.
 * @param {Firestore} db Firestore instance.
 * @param {string} agencyId Brand workspace id.
 * @param {string | null} campaignId When set, limits to this campaign plus pooled leads.
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

/** Pulls the handle out of a normalized `instagram.com/<handle>` key.
 * @param {string} key Normalized profile URL key.
 * @return {?string} Instagram handle, or null when the key is not a profile URL.
 */
function instagramHandleFromKey(key: string): string | null {
  const match = key.match(/^instagram\.com\/([^/]+)$/);
  if (!match) return null;
  const handle = match[1].trim();
  return handle ? handle : null;
}

/**
 * Builds the exclusion payload for one extension mission.
 * @param {Firestore} db Firestore instance.
 * @param {string} agencyId Brand workspace id.
 * @param {string | null} campaignId Campaign scope, or null for agency-wide.
 * @return {Promise<VaultExclusions>} Keys plus handle lists for the client and planner.
 */
export async function loadVaultExclusions(
  db: Firestore,
  agencyId: string,
  campaignId: string | null
): Promise<VaultExclusions> {
  const keys = await loadExistingProfileUrlKeys(db, agencyId, campaignId);

  const usernames: string[] = [];
  for (const key of keys) {
    const handle = instagramHandleFromKey(key);
    if (handle) usernames.push(handle);
  }

  return {
    keys,
    usernames: usernames.slice(0, CLIENT_EXCLUDE_CAP),
    plannerUsernames: usernames.slice(0, PLANNER_EXCLUDE_CAP),
  };
}

/**
 * Fast per-lead duplicate check. Relies on Firestore index merging for the two
 * equality filters, so it needs no composite index. Only matches the canonical
 * URL form; the mission-level {@link loadVaultExclusions} sweep catches variants.
 * @param {Firestore} db Firestore instance.
 * @param {string} agencyId Brand workspace id.
 * @param {string} profileUrl Canonical profile URL.
 * @return {Promise<boolean>} True when this brand already has the lead.
 */
export async function vaultHasProfileUrl(
  db: Firestore,
  agencyId: string,
  profileUrl: string
): Promise<boolean> {
  const snap = await db
    .collection("optic_outreach_leads")
    .where("agencyId", "==", agencyId)
    .where("profileUrl", "==", profileUrl)
    .limit(1)
    .get();
  return !snap.empty;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProfileUrl = normalizeProfileUrl;
exports.loadExistingProfileUrlKeys = loadExistingProfileUrlKeys;
/**
 * Normalizes profile URLs for duplicate detection (host + path, no trailing slash).
 * @param {string} url Raw profile URL.
 * @return {string} Comparable key.
 */
function normalizeProfileUrl(url) {
    try {
        const u = new URL(url.trim());
        const host = u.hostname.replace(/^www\./i, "").toLowerCase();
        let path = u.pathname.replace(/\/$/, "") || "";
        path = path.toLowerCase();
        return `${host}${path}`;
    }
    catch {
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
async function loadExistingProfileUrlKeys(db, agencyId, campaignId) {
    const snap = await db.collection("optic_outreach_leads").where("agencyId", "==", agencyId).get();
    const keys = new Set();
    for (const doc of snap.docs) {
        const data = doc.data();
        const url = data.profileUrl;
        if (typeof url !== "string" || !url.trim())
            continue;
        const leadCampaignId = typeof data.campaignId === "string" && data.campaignId.trim() ? data.campaignId.trim() : null;
        if (campaignId) {
            const sameCampaign = leadCampaignId === campaignId;
            const pooled = leadCampaignId === null;
            if (!sameCampaign && !pooled)
                continue;
        }
        keys.add(normalizeProfileUrl(url));
    }
    return keys;
}

import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

function numOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseFollowers(lead: {
  followerCount?: unknown;
  followerCountNumeric?: unknown;
}): number {
  if (typeof lead.followerCountNumeric === "number" && Number.isFinite(lead.followerCountNumeric)) {
    return Math.max(0, lead.followerCountNumeric);
  }
  if (typeof lead.followerCount === "number" && Number.isFinite(lead.followerCount)) {
    return Math.max(0, lead.followerCount);
  }
  if (typeof lead.followerCount === "string") {
    const raw = lead.followerCount.trim().toUpperCase().replace(/,/g, "");
    const m = raw.match(/^([\d.]+)\s*([KMB])?$/);
    if (!m) {
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
    const base = Number.parseFloat(m[1]);
    if (!Number.isFinite(base)) return 0;
    const mult = m[2] === "K" ? 1_000 : m[2] === "M" ? 1_000_000 : m[2] === "B" ? 1_000_000_000 : 1;
    return Math.max(0, base * mult);
  }
  return 0;
}

/**
 * Recompute heuristic ROAS and persist on the gig for the Optic vault report card.
 */
export const refreshOpticCampaignRoasInsight = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to refresh ROAS.");

  const data = request.data as {
    campaignId?: unknown;
    averageOrderValueUsd?: unknown;
    conversionRate?: unknown;
    viewRate?: unknown;
    hireCount?: unknown;
  };
  const campaignId =
    typeof data.campaignId === "string" ? data.campaignId.trim() : "";
  if (!campaignId) throw new HttpsError("invalid-argument", "campaignId is required.");

  const aov =
    typeof data.averageOrderValueUsd === "number" && data.averageOrderValueUsd > 0
      ? data.averageOrderValueUsd
      : 50;
  const conversionRate =
    typeof data.conversionRate === "number" && Number.isFinite(data.conversionRate)
      ? Math.min(1, Math.max(0, data.conversionRate))
      : 0.005;
  const viewRate =
    typeof data.viewRate === "number" && Number.isFinite(data.viewRate)
      ? Math.min(1, Math.max(0, data.viewRate))
      : 0.08;

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  const u = userSnap.data()!;
  const role = String(u.role ?? "");
  const agencyId = typeof u.primaryAgencyId === "string" ? u.primaryAgencyId : "";
  if (!agencyId || !TEAM_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Brand team only.");
  }

  const gigRef = db.collection("gigs").doc(campaignId);
  const gigSnap = await gigRef.get();
  if (!gigSnap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const gig = gigSnap.data()!;
  if (String(gig.brandId ?? "") !== agencyId) {
    throw new HttpsError("permission-denied", "Campaign belongs to another brand.");
  }

  const rate = numOrZero(gig.ratePerCreator);
  const creatorsNeeded = Math.max(0, Math.floor(numOrZero(gig.creatorsNeeded)));
  const hireCount =
    typeof data.hireCount === "number" && data.hireCount > 0
      ? Math.floor(data.hireCount)
      : Math.max(1, creatorsNeeded || 1);
  const spendUsd = Math.round(rate * hireCount * 100) / 100;
  const creatorCompensationUsd = rate * creatorsNeeded;

  const leadSnap = await db
    .collection("optic_outreach_leads")
    .where("agencyId", "==", agencyId)
    .limit(200)
    .get();

  const leads = leadSnap.docs
    .map((d) => {
      const L = d.data();
      return {
        id: d.id,
        campaignId: typeof L.campaignId === "string" ? L.campaignId : null,
        name: typeof L.creatorName === "string" ? L.creatorName : null,
        followers: parseFollowers(L),
        matchScore: typeof L.matchScore === "number" ? L.matchScore : null,
      };
    })
    .filter((l) => l.campaignId === campaignId)
    .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));

  const selected = leads.slice(0, hireCount);
  const creatorsModeled: Array<{
    id: string;
    name: string | null;
    followers: number;
    matchScore: number | null;
    expectedViews: number;
  }> = selected.map((l) => ({
    id: l.id,
    name: l.name,
    followers: l.followers,
    matchScore: l.matchScore,
    expectedViews: Math.round(l.followers * viewRate),
  }));

  if (creatorsModeled.length === 0) {
    for (let i = 0; i < hireCount; i++) {
      const followers = 50_000;
      creatorsModeled.push({
        id: `proxy-${i + 1}`,
        name: `Proxy mid-micro #${i + 1}`,
        followers,
        matchScore: null,
        expectedViews: Math.round(followers * viewRate),
      });
    }
  } else if (creatorsModeled.length < hireCount) {
    const avg =
      creatorsModeled.reduce((s, c) => s + c.followers, 0) / creatorsModeled.length;
    while (creatorsModeled.length < hireCount) {
      const i = creatorsModeled.length;
      creatorsModeled.push({
        id: `proxy-${i + 1}`,
        name: "Proxy (avg vault reach)",
        followers: Math.round(avg),
        matchScore: null,
        expectedViews: Math.round(avg * viewRate),
      });
    }
  }

  const expectedViews = creatorsModeled.reduce((s, c) => s + c.expectedViews, 0);
  const expectedConversions = expectedViews * conversionRate;
  const expectedRevenueUsd = Math.round(expectedConversions * aov * 100) / 100;
  const predictedRoas =
    spendUsd > 0 ? Math.round((expectedRevenueUsd / spendUsd) * 100) / 100 : null;
  const usedProxies = creatorsModeled.some((c) => c.id.startsWith("proxy-"));
  const vaultLeadsUsed = creatorsModeled.filter((c) => !c.id.startsWith("proxy-")).length;

  const caveats = [
    "This is a forecast, not results from a finished campaign.",
    "Follower numbers are often estimated from public profiles.",
  ];
  if (usedProxies) {
    caveats.push(
      "Some creator slots used placeholder reach — discover more creators for a sharper estimate."
    );
  }

  const insight = {
    predictedRoas,
    spendUsd,
    expectedRevenueUsd,
    expectedViews,
    expectedConversions: Math.round(expectedConversions * 1000) / 1000,
    hireCount,
    confidence: usedProxies || selected.length === 0 ? ("low" as const) : ("medium" as const),
    vaultLeadsUsed,
    usedProxies,
    inputs: {
      averageOrderValueUsd: aov,
      conversionRate,
      viewRate,
      engagementRate: null as number | null,
    },
    budget: {
      creatorCompensationUsd,
      ratePerCreator: rate,
      creatorsNeeded,
    },
    creatorsPreview: creatorsModeled.slice(0, 5).map((c) => ({
      name: c.name,
      followers: c.followers,
      matchScore: c.matchScore,
    })),
    caveats,
    source: "web" as const,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await gigRef.update({
    opticRoasInsight: insight,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true as const,
    campaignId,
    insight: {
      ...insight,
      updatedAt: new Date().toISOString(),
    },
  };
});

import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {syncQuotedRateFromNote} from "./quotedRate";
import {CLOSE_PROBABILITY, modelCampaignRoas, pipelineBucket, type RoasLeadInput} from "./roasModel";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);
const CAMPAIGN_LEAD_LIMIT = 500;
/** Notes read per refresh for leads saved before quoted rates existed; the trigger covers new edits. */
const BACKFILL_PER_REFRESH = 25;

/**
 * Coerces a stored number or numeric string, defaulting to 0.
 * @param {unknown} v Raw value.
 * @return {number} Finite number.
 */
function numOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Follower count from the numeric field, falling back to the display string.
 * @param {object} lead Lead fields.
 * @return {number} Followers.
 */
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
 * Recompute stage-aware ROAS and persist on the gig for the Optic vault report card.
 */
export const refreshOpticCampaignRoasInsight = onCall({timeoutSeconds: 120}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to refresh ROAS.");

  const data = request.data as {
    campaignId?: unknown;
    averageOrderValueUsd?: unknown;
    conversionRate?: unknown;
    viewRate?: unknown;
    hireCount?: unknown;
    minMatchScore?: unknown;
    persist?: unknown;
    source?: unknown;
  };
  const persist = data.persist !== false;
  const source = data.source === "mcp" ? ("mcp" as const) : ("web" as const);
  const minMatchScore =
    typeof data.minMatchScore === "number" && Number.isFinite(data.minMatchScore) ?
      Math.min(100, Math.max(0, data.minMatchScore)) :
      null;
  const campaignId =
    typeof data.campaignId === "string" ? data.campaignId.trim() : "";
  if (!campaignId) throw new HttpsError("invalid-argument", "campaignId is required.");

  const aov =
    typeof data.averageOrderValueUsd === "number" && data.averageOrderValueUsd > 0 ?
      data.averageOrderValueUsd :
      50;
  const conversionRate =
    typeof data.conversionRate === "number" && Number.isFinite(data.conversionRate) ?
      Math.min(1, Math.max(0, data.conversionRate)) :
      0.005;
  const viewRate =
    typeof data.viewRate === "number" && Number.isFinite(data.viewRate) ?
      Math.min(1, Math.max(0, data.viewRate)) :
      0.08;

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
  const targetCount =
    typeof data.hireCount === "number" && data.hireCount > 0 ?
      Math.floor(data.hireCount) :
      Math.max(1, creatorsNeeded || 1);

  const leadSnap = await db
    .collection("optic_outreach_leads")
    .where("agencyId", "==", agencyId)
    .where("campaignId", "==", campaignId)
    .limit(CAMPAIGN_LEAD_LIMIT)
    .get();

  const docs = leadSnap.docs.map((d) => ({ref: d.ref, data: d.data()}));
  let backfilled = 0;
  for (const d of docs) {
    if (backfilled >= BACKFILL_PER_REFRESH) break;
    const note = typeof d.data.crmNote === "string" ? d.data.crmNote.trim() : "";
    if (!note || d.data.quotedRateSource === "manual" || d.data.quotedRateNoteHash) continue;
    backfilled += 1;
    const next = await syncQuotedRateFromNote(d.ref, d.data);
    if (next !== undefined) d.data.quotedRateUsd = next;
  }

  const allLeads: RoasLeadInput[] = docs.map(({ref, data: L}) => ({
    id: ref.id,
    name: typeof L.creatorName === "string" ? L.creatorName : null,
    followers: parseFollowers(L),
    matchScore: typeof L.matchScore === "number" ? L.matchScore : null,
    pipelineStage: L.pipelineStage,
    outreachEmailed: L.outreachEmailed,
    outreachResponse: L.outreachResponse,
    quotedRateUsd: L.quotedRateUsd,
  }));
  // The match-score floor only screens creators nobody has contacted; anyone already in talks stays in.
  const leads = minMatchScore == null ?
    allLeads :
    allLeads.filter((l) => pipelineBucket(l) !== "new" || (l.matchScore ?? -1) >= minMatchScore);

  const model = modelCampaignRoas(leads, {
    averageOrderValueUsd: aov,
    conversionRate,
    viewRate,
    ratePerCreator: rate,
    targetCount,
  });
  const {target} = model;
  const vaultLeadsUsed = model.targetCreators.filter((c) => !c.proxy).length;
  const solidSpend = model.spendBasis.quoted + model.spendBasis.flat_fee;
  const confidence =
    !model.usedProxies && model.spendBasis.unknown === 0 && solidSpend >= model.spendBasis.estimated ?
      ("medium" as const) :
      ("low" as const);

  const caveats = [
    "This is a forecast, not results from a finished campaign.",
    "Follower numbers are often estimated from public profiles.",
  ];
  if (model.pipeline.excluded > 0) {
    caveats.push(
      `${model.pipeline.excluded} creator${model.pipeline.excluded === 1 ? "" : "s"} who passed, declined, ` +
      "or went quiet are left out."
    );
  }
  if (model.spendBasis.estimated > 0) {
    caveats.push("Some spend is estimated from other creators' quoted rates at similar follower counts.");
  }
  if (model.spendBasis.unknown > 0) {
    caveats.push("Add quoted rates or a flat fee to estimate spend for every creator.");
  }
  if (model.usedProxies) {
    caveats.push(
      "Some creator slots used placeholder reach — discover more creators for a sharper estimate."
    );
  }
  caveats.push(
    `Likely weights creators by typical odds of booking: in conversation ${CLOSE_PROBABILITY.negotiating * 100}%, ` +
    `replied ${CLOSE_PROBABILITY.replied * 100}%, contacted ${CLOSE_PROBABILITY.contacted * 100}%.`
  );

  const insight = {
    predictedRoas: target.roas,
    spendUsd: target.spendUsd,
    expectedRevenueUsd: target.revenueUsd,
    expectedViews: target.views,
    expectedConversions: target.conversions,
    hireCount: model.targetCreators.length,
    confidence,
    vaultLeadsUsed,
    usedProxies: model.usedProxies,
    inputs: {
      averageOrderValueUsd: aov,
      conversionRate,
      viewRate,
      engagementRate: null as number | null,
    },
    budget: {
      creatorCompensationUsd: rate * creatorsNeeded,
      ratePerCreator: rate,
      creatorsNeeded,
    },
    scenarios: {
      committed: model.committed,
      likely: model.likely,
      target: model.target,
    },
    pipeline: model.pipeline,
    spendBasis: model.spendBasis,
    quotesUsed: model.quotesUsed,
    medianQuoteUsd: model.medianQuoteUsd,
    creatorsPreview: model.targetCreators.slice(0, 5).map((c) => ({
      name: c.name,
      followers: c.followers,
      matchScore: c.matchScore,
      stage: c.proxy ? null : c.bucket,
      spendUsd: c.spendUsd,
      spendBasis: c.spendBasis,
    })),
    caveats,
    source,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (persist) {
    await gigRef.update({
      opticRoasInsight: insight,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    ok: true as const,
    campaignId,
    savedToVault: persist,
    insight: {
      ...insight,
      updatedAt: new Date().toISOString(),
    },
  };
});

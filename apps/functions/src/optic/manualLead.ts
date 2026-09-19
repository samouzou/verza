import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {loadAgencyOpticBilling} from "./billing";
import {OPTIC_PLATFORMS, opticPlatformLabel} from "./constants";
import {assertSufficientOpticCredits} from "./credits";
import {parseCompactCount} from "./counts";
import {composeMatchScore} from "./matchScore";
import {
  extensionProfileUrl,
  normalizeProfileUrl,
} from "./profileUrl";
import {saveLeadWithOpticCreditCharge} from "./saveLead";
import {vaultHasProfileUrl} from "./vaultDedup";

const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

type ManualLeadInput = {
  profileUrl?: unknown;
  creatorName?: unknown;
  platform?: unknown;
  followerCount?: unknown;
  postCount?: unknown;
  niche?: unknown;
  bio?: unknown;
  email?: unknown;
  externalUrl?: unknown;
  matchReason?: unknown;
  campaignId?: unknown;
};

/**
 * Infers Optic platform slug from a profile URL host.
 * @param {string} url Profile URL.
 * @return {string | null} Platform slug or null.
 */
function detectPlatformFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("linkedin.com")) return "linkedin";
    if (host === "x.com" || host.includes("twitter.com")) return "twitter";
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("facebook.com") || host.includes("fb.com")) return "facebook";
    if (host.includes("twitch.tv")) return "twitch";
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Canonicalizes a manual profile URL for vault storage + dedupe.
 * @param {string} platform Optic platform slug.
 * @param {string} rawUrl User-provided URL.
 * @return {string} Canonical http(s) URL.
 */
function canonicalizeManualProfileUrl(platform: string, rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (
    platform === "instagram" ||
    platform === "linkedin" ||
    platform === "twitter"
  ) {
    return extensionProfileUrl(platform, trimmed);
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("bad protocol");
    }
    u.hash = "";
    return u.toString();
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "profileUrl must be a full http(s) profile URL."
    );
  }
}

function optionalTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/**
 * Manually adds a creator to the Optic vault (1 credit), outside discovery scrape.
 * Dedupes by agency + profile URL. Optional campaign attach for vault filtering.
 */
export const addOpticManualLead = onCall(
  {region: "us-central1", timeoutSeconds: 60},
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as ManualLeadInput;

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }
    const user = userSnap.data()!;
    const role = String(user.role ?? "");
    const agencyId =
      typeof user.primaryAgencyId === "string" ? user.primaryAgencyId : "";
    if (!TEAM_ROLES.has(role) || !agencyId) {
      throw new HttpsError(
        "permission-denied",
        "Adding vault creators requires a brand owner, admin, or member account."
      );
    }

    const rawUrl =
      typeof data.profileUrl === "string" ? data.profileUrl.trim() : "";
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      throw new HttpsError(
        "invalid-argument",
        "profileUrl must be a full http(s) profile URL."
      );
    }

    let platform =
      typeof data.platform === "string" && data.platform.trim()
        ? data.platform.trim().toLowerCase()
        : detectPlatformFromUrl(rawUrl);
    if (!platform || !OPTIC_PLATFORMS.has(platform)) {
      throw new HttpsError(
        "invalid-argument",
        `platform is required (or use a supported profile URL). Supported: ${[
          ...OPTIC_PLATFORMS,
        ].join(", ")}.`
      );
    }

    const profileUrl = canonicalizeManualProfileUrl(platform, rawUrl);
    if (!/^https?:\/\//i.test(profileUrl)) {
      throw new HttpsError(
        "invalid-argument",
        "profileUrl must be a full http(s) profile URL."
      );
    }

    if (await vaultHasProfileUrl(db, agencyId, profileUrl)) {
      throw new HttpsError(
        "already-exists",
        "This creator is already in your vault."
      );
    }

    let campaignId: string | null = null;
    let campaignTitle: string | null = null;
    const rawCampaignId = optionalTrimmedString(data.campaignId, 128);
    if (rawCampaignId) {
      const gigSnap = await db.collection("gigs").doc(rawCampaignId).get();
      if (!gigSnap.exists) {
        throw new HttpsError("not-found", "Campaign not found.");
      }
      const gig = gigSnap.data()!;
      // Gigs store the workspace as brandId (same as primaryAgencyId for the team).
      if (String(gig.brandId ?? "") !== agencyId) {
        throw new HttpsError(
          "permission-denied",
          "Campaign belongs to another brand workspace."
        );
      }
      campaignId = gigSnap.id;
      campaignTitle =
        typeof gig.title === "string" && gig.title.trim()
          ? gig.title.trim().slice(0, 200)
          : null;
    }

    await assertSufficientOpticCredits(agencyId, 1);

    const agencySnap = await db.collection("agencies").doc(agencyId).get();
    const agencyName =
      (agencySnap.exists &&
        typeof agencySnap.data()?.name === "string" &&
        agencySnap.data()!.name.trim()) ||
      "Brand";

    const creatorName =
      optionalTrimmedString(data.creatorName, 200) || profileUrl;
    const niche = optionalTrimmedString(data.niche, 200);
    const email = optionalTrimmedString(data.email, 200);
    const followerCount = optionalTrimmedString(data.followerCount, 40);
    const postCount = optionalTrimmedString(data.postCount, 40);
    const bio = optionalTrimmedString(data.bio, 2000);
    const externalUrl = optionalTrimmedString(data.externalUrl, 500);
    const matchReason =
      optionalTrimmedString(data.matchReason, 220) ||
      `Manually added from ${opticPlatformLabel(platform)}.`;

    const followerCountNumeric = parseCompactCount(followerCount);
    const postCountNumeric = parseCompactCount(postCount);
    const match = composeMatchScore({
      briefFitScore: 70,
      matchReason,
      followerCount: followerCountNumeric,
      postCount: postCountNumeric,
      email,
      externalUrl,
      audienceTier: "any",
    });

    const leadPayload: Record<string, unknown> = {
      creatorName,
      niche,
      email,
      followerCount:
        followerCount ||
        (followerCountNumeric != null ? String(followerCountNumeric) : null),
      followerCountNumeric,
      postCountNumeric,
      draftEmail: null,
      draftEmailSubject: null,
      draftDm: null,
      matchScore: match.matchScore,
      matchReason: match.matchReason,
      matchBreakdown: match.matchBreakdown,
      discoveryPlatform: platform,
      profileUrl,
      createdAt: FieldValue.serverTimestamp(),
      source: "Verza Optic",
      sourceKind: "manual",
      agencyId,
      agencyName,
      campaignId,
      campaignTitle,
      addedByUid: uid,
      agentScrape: {
        bio,
        externalUrl,
        normalizedKey: normalizeProfileUrl(profileUrl),
      },
    };

    // Charge key scoped per agency so the same URL can exist across brands.
    const syntheticJobId = `manual_${agencyId}`;
    const billing = await loadAgencyOpticBilling(agencyId);
    const saveResult = await saveLeadWithOpticCreditCharge({
      db,
      jobId: syntheticJobId,
      agencyId,
      profileUrl,
      leadData: leadPayload,
      billing,
    });

    if (!saveResult.ok) {
      if (saveResult.reason === "needs_top_up") {
        throw new HttpsError(
          "resource-exhausted",
          "Optic credits exhausted for this period. Top up to add more creators."
        );
      }
      throw new HttpsError(
        "failed-precondition",
        "Insufficient Optic Credits. Subscribe or add credits to save this creator."
      );
    }

    logger.info("[Optic] Manual vault lead added", {
      agencyId,
      leadId: saveResult.leadId,
      platform,
      charged: saveResult.charged,
      overage: saveResult.overage ?? false,
    });

    return {
      ok: true as const,
      leadId: saveResult.leadId,
      profileUrl,
      matchScore: match.matchScore,
      charged: saveResult.charged,
      overage: saveResult.overage ?? false,
    };
  }
);

import * as admin from "firebase-admin";
import { getFirestoreDb } from "./storage";
import { logger } from "./logger";

export type AgencyCampaignOption = {
  id: string;
  title: string;
  status: string;
  ratePerCreator: number;
  campaignType: string;
  platforms: string[];
};

export type AgencyBrandContext = {
  agencyId: string;
  agencyName: string;
  brandSummary: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  /** Compact pay/rate facts for outreach (one selected campaign or pooled active gigs). */
  campaignPaySummary: string | null;
  /** Count of active gigs used for the pay block (1 when a specific campaign is selected). */
  activePaidCampaignCount: number;
  /** Selectable open / in-progress campaigns for this agency (recruiting scope). */
  campaignOptions: AgencyCampaignOption[];
  /** When non-null, drafts use pay from this gig only. */
  paySourceCampaignId: string | null;
  paySourceCampaignTitle: string | null;
  /** Firestore gig `campaignType` when pay is scoped to one selected campaign (e.g. cause_campaign). */
  paySourceCampaignType: string | null;
};

type GigPayFields = {
  brandId?: unknown;
  title?: unknown;
  ratePerCreator?: unknown;
  status?: unknown;
  campaignType?: unknown;
  platforms?: unknown;
  creatorsNeeded?: unknown;
  videosPerCreator?: unknown;
};

type GigRow = { id: string } & GigPayFields;

export type LoadAgencyOptions = {
  /** When set, pay summary is built only from this gig (must belong to agency and be open/in-progress). */
  campaignId?: string | null;
};

function numOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isActiveRecruitingStatus(status: unknown): boolean {
  return status === "open" || status === "in-progress";
}

function gigToOption(g: GigRow): AgencyCampaignOption {
  return {
    id: g.id,
    title:
      typeof g.title === "string" && g.title.trim()
        ? g.title.trim().slice(0, 120)
        : "Campaign",
    status: String(g.status ?? ""),
    ratePerCreator: numOrZero(g.ratePerCreator),
    campaignType: typeof g.campaignType === "string" ? g.campaignType : "",
    platforms: Array.isArray(g.platforms) ? (g.platforms as string[]) : [],
  };
}

function gigCampaignTypeRaw(g: GigRow): string {
  return typeof g.campaignType === "string" ? g.campaignType.trim() : "";
}

function formatGigPayLine(g: GigRow): string {
  const title =
    typeof g.title === "string" && g.title.trim() ? g.title.trim().slice(0, 90) : "Campaign";
  const rate = numOrZero(g.ratePerCreator);
  const ct = gigCampaignTypeRaw(g);
  let rateStr: string;
  if (rate > 0) {
    rateStr = `$${rate.toLocaleString("en-US")} USD per creator (listed on Verza)`;
  } else if (ct === "cause_campaign") {
    rateStr = "cause / mission partnership — no per-creator cash fee listed on Verza";
  } else if (ct === "barter_campaign") {
    rateStr = "in-kind or product exchange — no cash rate listed on Verza";
  } else {
    rateStr = "compensation set in campaign (see Verza)";
  }
  const type = ct ? ct.replace(/_/g, " ") : "sponsorship";
  const plat = Array.isArray(g.platforms) ? g.platforms.join(", ") : "";
  const need = numOrZero(g.creatorsNeeded);
  const vids = numOrZero(g.videosPerCreator);
  const scope =
    need > 0 && vids > 0 ? ` · ${need} creator slot(s), ${vids} deliverable(s) each` : "";
  return `- "${title}" (${String(g.status)}): ${rateStr} · ${type}${plat ? ` · platforms: ${plat}` : ""}${scope}`;
}

async function loadCampaignRecruitingData(
  db: admin.firestore.Firestore,
  agencyId: string,
  selectedCampaignId?: string | null
): Promise<{
  campaignOptions: AgencyCampaignOption[];
  campaignPaySummary: string | null;
  activePaidCampaignCount: number;
  paySourceCampaignId: string | null;
  paySourceCampaignTitle: string | null;
  paySourceCampaignType: string | null;
}> {
  const empty = (): {
    campaignOptions: AgencyCampaignOption[];
    campaignPaySummary: string | null;
    activePaidCampaignCount: number;
    paySourceCampaignId: string | null;
    paySourceCampaignTitle: string | null;
    paySourceCampaignType: string | null;
  } => ({
    campaignOptions: [],
    campaignPaySummary: null,
    activePaidCampaignCount: 0,
    paySourceCampaignId: null,
    paySourceCampaignTitle: null,
    paySourceCampaignType: null,
  });

  try {
    const snap = await db
      .collection("gigs")
      .where("brandId", "==", agencyId)
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();

    const activeRows: GigRow[] = snap.docs
      .map((doc) => {
        const g = doc.data() as GigPayFields;
        return { id: doc.id, ...g };
      })
      .filter((g) => isActiveRecruitingStatus(g.status));

    const campaignOptions = activeRows.slice(0, 24).map(gigToOption);

    const wantId =
      typeof selectedCampaignId === "string" && selectedCampaignId.trim()
        ? selectedCampaignId.trim()
        : null;

    if (wantId) {
      const doc = await db.collection("gigs").doc(wantId).get();
      if (!doc.exists) {
        logger.warn(`[Optic] Selected campaign ${wantId} not found; using all active campaigns for pay.`);
      } else {
        const g = { id: doc.id, ...(doc.data() as GigPayFields) };
        const brandOk = String(g.brandId ?? "") === agencyId;
        if (!brandOk) {
          logger.warn(`[Optic] Selected campaign ${wantId} is not owned by this agency; using all active.`);
        } else if (!isActiveRecruitingStatus(g.status)) {
          logger.warn(
            `[Optic] Selected campaign ${wantId} is not open/in-progress; using all active for pay.`
          );
        } else {
          const title =
            typeof g.title === "string" && g.title.trim() ? g.title.trim().slice(0, 120) : "Campaign";
          const ct = gigCampaignTypeRaw(g);
          const summary =
            (ct === "cause_campaign" || ct === "barter_campaign" ?
              "The recruiting team selected this Verza campaign for this outreach mission. Use ONLY this campaign's partnership details (do not blend other campaigns):\n" :
              "The recruiting team selected this Verza campaign for this outreach mission. Use ONLY this campaign's pay and scope (do not blend other campaigns):\n") +
            formatGigPayLine(g);
          return {
            campaignOptions,
            campaignPaySummary: summary,
            activePaidCampaignCount: activeRows.length,
            paySourceCampaignId: g.id,
            paySourceCampaignTitle: title,
            paySourceCampaignType: ct || null,
          };
        }
      }
    }

    if (activeRows.length === 0) {
      return { ...empty(), campaignOptions };
    }

    const lines = activeRows.slice(0, 6).map(formatGigPayLine);
    const summary =
      "Factual campaign details from this brand's current Verza listings (use ONLY these facts; do not invent USD amounts):\n" +
      lines.join("\n") +
      "\n\nWhen a line describes a cause or in-kind barter with no USD figure, do not imply cash compensation for that campaign.";

    return {
      campaignOptions,
      campaignPaySummary: summary,
      activePaidCampaignCount: activeRows.length,
      paySourceCampaignId: null,
      paySourceCampaignTitle: null,
      paySourceCampaignType: null,
    };
  } catch (e) {
    logger.warn(
      `[Optic] Could not load gigs for recruiting context: ${e instanceof Error ? e.message : String(e)}`
    );
    return empty();
  }
}

/**
 * Verifies a Firebase Auth ID token and loads the user's primary agency + brand hints from Firestore.
 * Requires Admin SDK (ADC or service account) with access to the same project as the web app.
 *
 * @param idToken Firebase Auth ID token
 * @param opts Optional `campaignId` to scope pay/draft context to one open/in-progress gig.
 */
export async function loadAgencyContextFromIdToken(
  idToken: string,
  opts?: LoadAgencyOptions
): Promise<AgencyBrandContext> {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error("Firestore is not configured (check FIREBASE_PROJECT_ID and ADC).");
  }

  if (!admin.apps.length) {
    throw new Error("Firebase Admin is not initialized.");
  }

  const decoded = await admin.auth().verifyIdToken(idToken);
  const uid = decoded.uid;

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new Error("No Verza user profile found for this account.");
  }

  const user = userSnap.data()!;
  const agencyId = user.primaryAgencyId as string | undefined;
  if (!agencyId) {
    throw new Error("This account has no primary agency. Open Verza web and join or create an agency first.");
  }

  const agSnap = await db.collection("agencies").doc(agencyId).get();
  if (!agSnap.exists) {
    throw new Error("Agency document not found.");
  }

  const ag = agSnap.data()!;
  const agencyName = typeof ag.name === "string" && ag.name.trim() ? ag.name.trim() : "Your agency";

  const brandGuide = ag.brandGuide as { missionStatement?: string } | undefined;
  const mission =
    typeof brandGuide?.missionStatement === "string"
      ? brandGuide.missionStatement.trim()
      : "";
  const brandSummary = mission ? mission.slice(0, 220) : null;

  const {
    campaignOptions,
    campaignPaySummary,
    activePaidCampaignCount,
    paySourceCampaignId,
    paySourceCampaignTitle,
    paySourceCampaignType,
  } = await loadCampaignRecruitingData(db, agencyId, opts?.campaignId);

  const ctx: AgencyBrandContext = {
    agencyId,
    agencyName,
    brandSummary,
    userEmail: (typeof user.email === "string" ? user.email : null) || decoded.email || null,
    userDisplayName:
      (typeof user.displayName === "string" ? user.displayName : null) ||
      decoded.name ||
      null,
    campaignPaySummary,
    activePaidCampaignCount,
    campaignOptions,
    paySourceCampaignId,
    paySourceCampaignTitle,
    paySourceCampaignType,
  };

  const scope =
    paySourceCampaignId && paySourceCampaignTitle
      ? ` · pay scoped to campaign "${paySourceCampaignTitle}"`
      : activePaidCampaignCount
        ? ` · ${activePaidCampaignCount} active campaign(s) (pooled pay context)`
        : "";

  logger.log(`[Optic] Loaded agency context: ${ctx.agencyName} (${ctx.agencyId})${scope}`);
  return ctx;
}

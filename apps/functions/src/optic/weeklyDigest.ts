import {randomBytes} from "node:crypto";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {HttpsError, onCall, onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import sgMail from "@sendgrid/mail";
import {googleAI} from "@genkit-ai/google-genai";
import {ai} from "../ai/genkit";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {
  QUALIFIED_MATCH_SCORE,
  VAULT_SNAPSHOT_LIMIT,
  buildVaultSnapshot,
  type VaultAnalyticsSnapshot,
  type VaultLeadDoc,
} from "./vaultSnapshot";
import {
  weeklyDigestHtml,
  weeklyDigestSubject,
  type WeeklyCampaignRow,
  type WeeklyDigestEmailData,
  type WeeklyReadyCreator,
} from "./weeklyDigestEmail";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_JOB_WINDOW_DAYS = 14;
const MAX_CAMPAIGN_ROWS = 4;
const MAX_READY_CREATORS = 3;
/** Quiet weeks still get a short nudge; after this many in a row, pause until activity returns. */
const MAX_QUIET_SENDS = 2;
const MODEL = "gemini-3.6-flash";
const TEAM_ROLES = new Set(["agency_owner", "agency_admin", "agency_member"]);

type DigestLead = VaultLeadDoc & {
  creatorName?: unknown;
  campaignTitle?: unknown;
  createdAt?: unknown;
};

type ReportTotals = {
  leadCount: number;
  qualified: number;
  reachedOut: number;
  inProgress: number;
  booked: number;
  passed: number;
  replies: number;
  rateCards: number;
  readyToContact: number;
};

type Recipient = {uid: string; email: string; name: string; token: string};

/**
 * UTC Monday (YYYY-MM-DD) of the week containing `now`.
 * @param {Date} now Reference time.
 * @return {string} Week key.
 */
function weekKeyFor(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Firestore Timestamp to epoch ms.
 * @param {unknown} value Possible Timestamp.
 * @return {number | null} Millis, or null.
 */
function millis(value: unknown): number | null {
  const ts = value as {toMillis?: () => number} | null | undefined;
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
}

/**
 * Totals stored on each weekly report; next week's deltas compare against these.
 * @param {VaultAnalyticsSnapshot} snap Vault rollup.
 * @return {ReportTotals} Totals.
 */
function totalsOf(snap: VaultAnalyticsSnapshot): ReportTotals {
  const replies = Object.entries(snap.responses)
    .filter(([key]) => key !== "awaiting")
    .reduce((sum, [, n]) => sum + n, 0);
  return {
    leadCount: snap.leadCount,
    qualified: snap.qualified,
    reachedOut: snap.reachedOut,
    inProgress: snap.inProgress,
    booked: snap.stages.booked,
    passed: snap.stages.passed,
    replies,
    rateCards: snap.responses.rate_card,
    readyToContact: snap.untouched.readyToContact,
  };
}

/**
 * Same rule as the snapshot's readyToContact bucket.
 * @param {DigestLead} lead Vault lead.
 * @return {boolean} True when untouched, emailable, and not below the match bar.
 */
function isReadyToContact(lead: DigestLead): boolean {
  const untouched = lead.pipelineStage == null || lead.pipelineStage === "new";
  const contacted = millis(lead.lastContactedAt) ?? millis(lead.outreachEmailedAt);
  const hasEmail = typeof lead.email === "string" && lead.email.trim().length > 0;
  const lowMatch = typeof lead.matchScore === "number" && lead.matchScore < QUALIFIED_MATCH_SCORE;
  return untouched && lead.outreachEmailed !== true && contacted == null && hasEmail && !lowMatch;
}

/**
 * Campaign title saved on the lead.
 * @param {DigestLead} lead Vault lead.
 * @return {string | null} Title.
 */
function campaignTitleOf(lead: DigestLead): string | null {
  return typeof lead.campaignTitle === "string" && lead.campaignTitle.trim() ? lead.campaignTitle.trim() : null;
}

/**
 * Link to the opticWeeklyUnsubscribe function.
 * @param {string} uid User id.
 * @param {string} token User's emailPrefsToken.
 * @return {string} URL.
 */
function unsubscribeUrl(uid: string, token: string): string {
  const project = process.env.GCLOUD_PROJECT?.trim() || "verza-canvas";
  const region = process.env.FUNCTION_REGION?.trim() || "us-central1";
  const q = new URLSearchParams({u: uid, t: token});
  return `https://${region}-${project}.cloudfunctions.net/opticWeeklyUnsubscribe?${q.toString()}`;
}

/**
 * Owner plus active admins who haven't opted out; creates each unsubscribe token on first use.
 * @param {FirebaseFirestore.DocumentData} agency Agency doc data.
 * @return {Promise<Recipient[]>} Recipients.
 */
async function loadRecipients(agency: FirebaseFirestore.DocumentData): Promise<Recipient[]> {
  const uids = new Set<string>();
  if (typeof agency.ownerId === "string" && agency.ownerId) uids.add(agency.ownerId);
  for (const m of (Array.isArray(agency.team) ? agency.team : []) as {userId?: string; role?: string; status?: string}[]) {
    if (m.role === "admin" && m.status === "active" && m.userId) uids.add(m.userId);
  }
  const out: Recipient[] = [];
  for (const uid of uids) {
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();
    const u = snap.data();
    const email = typeof u?.email === "string" ? u.email.trim() : "";
    if (!u || !email || u.emailPreferences?.opticWeekly === false) continue;
    let token = typeof u.emailPrefsToken === "string" ? u.emailPrefsToken : "";
    if (!token) {
      token = randomBytes(16).toString("hex");
      await ref.update({emailPrefsToken: token});
    }
    out.push({uid, email, name: String(u.displayName || "there").split(" ")[0], token});
  }
  return out;
}

/**
 * One or two friendly sentences from the counts; falls back to a template if the model fails.
 * @param {object} facts Counts only.
 * @param {string} fallback Templated sentence.
 * @return {Promise<string>} Headline.
 */
async function writeHeadline(facts: Record<string, unknown>, fallback: string): Promise<string> {
  try {
    const {text} = await ai.generate({
      model: googleAI.model(MODEL),
      prompt: `Write the opening line of a weekly creator-outreach status email to a brand team.
Use ONLY these counts. Do not invent numbers, names, or rates. 1-2 short sentences, no greeting, no markdown.
Lead with momentum (conversations, rate cards, bookings). Measure outreach against qualifiedCreators.
If quiet is true, be brief and point to readyToContact as the next step.

FACTS:
${JSON.stringify(facts)}`,
    });
    const line = (text ?? "").trim().replace(/\s+/g, " ");
    return line && line.length <= 400 ? line : fallback;
  } catch (e) {
    logger.warn("[Optic weekly] headline fallback", {error: e instanceof Error ? e.message : String(e)});
    return fallback;
  }
}

type BuiltDigest = {
  data: Omit<WeeklyDigestEmailData, "recipientName" | "unsubscribeUrl">;
  totals: ReportTotals;
  newLeads: number;
  contactedThisWeek: number;
  quiet: boolean;
};

/**
 * Counts the vault and assembles everything the email needs (recipient-independent).
 * @param {string} agencyId Agency id.
 * @param {FirebaseFirestore.DocumentData} agency Agency doc data.
 * @param {string} weekKey Current week key.
 * @return {Promise<BuiltDigest | null>} Null when the vault is empty.
 */
async function buildDigest(
  agencyId: string,
  agency: FirebaseFirestore.DocumentData,
  weekKey: string
): Promise<BuiltDigest | null> {
  const leadSnap = await db
    .collection("optic_outreach_leads")
    .where("agencyId", "==", agencyId)
    .orderBy("createdAt", "desc")
    .limit(VAULT_SNAPSHOT_LIMIT)
    .get();
  if (leadSnap.empty) return null;
  const leads = leadSnap.docs.map((d) => d.data() as DigestLead);
  const truncated = leadSnap.size >= VAULT_SNAPSHOT_LIMIT;

  const overall = buildVaultSnapshot(leads, "All vault leads", truncated);
  const totals = totalsOf(overall);
  const weekAgo = Date.now() - 7 * DAY_MS;
  const newLeads = leads.filter((l) => (millis(l.createdAt) ?? 0) >= weekAgo).length;
  const contactedThisWeek = overall.last7dContacts;

  const prevSnap = await db
    .collection("agencies").doc(agencyId).collection("opticWeeklyReports")
    .where("weekKey", "<", weekKey)
    .orderBy("weekKey", "desc")
    .limit(1)
    .get();
  const prev = prevSnap.empty ? null : (prevSnap.docs[0].data().totals as ReportTotals | undefined) ?? null;
  const deltas = prev ? {
    reachedOut: totals.reachedOut - prev.reachedOut,
    replies: totals.replies - prev.replies,
    rateCards: totals.rateCards - prev.rateCards,
    booked: totals.booked - prev.booked,
  } : null;
  const movedSinceLastWeek = deltas != null &&
    (deltas.reachedOut > 0 || deltas.replies > 0 || deltas.rateCards > 0 || deltas.booked > 0);
  const quiet = newLeads === 0 && contactedThisWeek === 0 && !movedSinceLastWeek;

  const groups = new Map<string, DigestLead[]>();
  for (const lead of leads) {
    const key = typeof lead.campaignId === "string" && lead.campaignId ? lead.campaignId : "__pooled__";
    groups.set(key, [...(groups.get(key) ?? []), lead]);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const campaigns: WeeklyCampaignRow[] = [];
  for (const [key, group] of ranked.slice(0, MAX_CAMPAIGN_ROWS)) {
    let title = key === "__pooled__" ? "Pooled missions" : group.map(campaignTitleOf).find(Boolean) ?? "";
    if (!title) {
      const gigTitle = (await db.collection("gigs").doc(key).get()).get("title");
      title = (typeof gigTitle === "string" && gigTitle.trim()) || "Untitled campaign";
    }
    const s = buildVaultSnapshot(group, title, false);
    campaigns.push({
      title,
      qualified: s.qualified,
      reachedOut: s.reachedOut,
      inProgress: s.inProgress,
      booked: s.stages.booked,
      readyToContact: s.untouched.readyToContact,
    });
  }

  const readyCreators: WeeklyReadyCreator[] = leads
    .filter(isReadyToContact)
    .sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0))
    .slice(0, MAX_READY_CREATORS)
    .map((l) => ({
      name: typeof l.creatorName === "string" && l.creatorName.trim() ? l.creatorName.trim() : "Unnamed creator",
      matchScore: typeof l.matchScore === "number" ? Math.round(l.matchScore) : null,
      campaignTitle: groups.size > 1 ? campaignTitleOf(l) : null,
    }));

  const status = String(agency.opticSubscriptionStatus ?? "");
  const allowance = Number(agency.opticMonthlyAllowance) || 0;
  const periodEnd = agency.opticPeriodEnd as Timestamp | null | undefined;
  const credits = (status === "active" || status === "trialing") && allowance > 0 ? {
    balance: Math.max(0, Math.floor(Number(agency.opticCreditsBalance) || 0)),
    allowance,
    periodEndLabel: periodEnd?.toDate ?
      periodEnd.toDate().toLocaleDateString("en-US", {month: "short", day: "numeric"}) :
      null,
  } : null;

  const fallback = quiet ?
    `nothing moved in the vault this week. ${totals.readyToContact} qualified creators are ready for a first touch.` :
    `${totals.reachedOut} of ${totals.qualified} qualified creators have been reached out to, ` +
      `with ${totals.inProgress} in conversation and ${totals.booked} booked.`;
  const headline = await writeHeadline({
    qualifiedCreators: totals.qualified,
    reachedOut: totals.reachedOut,
    inConversation: totals.inProgress,
    booked: totals.booked,
    rateCards: totals.rateCards,
    readyToContact: totals.readyToContact,
    newCreatorsThisWeek: newLeads,
    contactedThisWeek,
    changeSinceLastWeek: deltas,
    quiet,
  }, fallback);

  const monday = new Date(`${weekKey}T00:00:00Z`);
  return {
    data: {
      agencyName: typeof agency.name === "string" && agency.name.trim() ? agency.name.trim() : "Your brand",
      weekLabel: `Week of ${monday.toLocaleDateString("en-US", {month: "long", day: "numeric", timeZone: "UTC"})}`,
      headline,
      quiet,
      totals: {
        qualified: totals.qualified,
        reachedOut: totals.reachedOut,
        inProgress: totals.inProgress,
        booked: totals.booked,
        readyToContact: totals.readyToContact,
      },
      deltas,
      newLeads,
      contactedThisWeek,
      campaigns,
      moreCampaigns: Math.max(0, ranked.length - MAX_CAMPAIGN_ROWS),
      readyCreators,
      credits,
      appUrl: params.APP_URL.value(),
    },
    totals,
    newLeads,
    contactedThisWeek,
    quiet,
  };
}

/**
 * Sends one digest to one recipient and logs it.
 * @param {BuiltDigest} digest Built digest.
 * @param {Recipient} r Recipient.
 * @return {Promise<boolean>} True when SendGrid accepted it.
 */
async function sendDigest(digest: BuiltDigest, r: Recipient): Promise<boolean> {
  const unsub = unsubscribeUrl(r.uid, r.token);
  const data: WeeklyDigestEmailData = {...digest.data, recipientName: r.name, unsubscribeUrl: unsub};
  const subject = weeklyDigestSubject(data);
  try {
    await sgMail.send({
      to: r.email,
      from: {name: "Verza Optic", email: params.SENDGRID_FROM_EMAIL.value()},
      subject,
      html: weeklyDigestHtml(data),
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    await db.collection("emailLogs").add({
      to: r.email,
      subject,
      type: "optic_weekly",
      timestamp: Timestamp.now(),
      status: "sent",
    });
    return true;
  } catch (e) {
    const detail = (e as {response?: {body?: unknown}}).response?.body;
    logger.error("[Optic weekly] send failed", {
      to: r.email,
      error: e instanceof Error ? e.message : String(e),
      detail: detail ?? null,
    });
    return false;
  }
}

/**
 * Configures SendGrid.
 * @return {boolean} False when the API key is missing.
 */
function initSendgrid(): boolean {
  const key = params.SENDGRID_API_KEY.value();
  if (!key) {
    logger.error("SENDGRID_API_KEY not set, skipping Optic Weekly.");
    return false;
  }
  sgMail.setApiKey(key);
  return true;
}

/**
 * Brands with an active Optic subscription, or an Optic search in the last two weeks.
 * @return {Promise<string[]>} Agency ids.
 */
async function eligibleAgencyIds(): Promise<string[]> {
  const ids = new Set<string>();
  const subs = await db.collection("agencies")
    .where("opticSubscriptionStatus", "in", ["active", "trialing"])
    .select()
    .get();
  subs.docs.forEach((d) => ids.add(d.id));
  const since = Timestamp.fromMillis(Date.now() - ACTIVE_JOB_WINDOW_DAYS * DAY_MS);
  const jobs = await db.collection("optic_jobs").where("createdAt", ">=", since).select("agencyId").get();
  jobs.docs.forEach((d) => {
    const id = d.get("agencyId");
    if (typeof id === "string" && id) ids.add(id);
  });
  return [...ids];
}

/**
 * Builds, sends, and records one brand's weekly digest. Idempotent per week.
 * @param {string} agencyId Agency id.
 * @param {string} weekKey Current week key.
 * @return {Promise<string>} Outcome label for logs.
 */
async function processAgency(agencyId: string, weekKey: string): Promise<string> {
  const agencyRef = db.collection("agencies").doc(agencyId);
  const agencySnap = await agencyRef.get();
  const agency = agencySnap.data();
  if (!agency) return "missing";
  if (agency.opticWeeklyLastSentKey === weekKey) return "already_sent";

  const digest = await buildDigest(agencyId, agency, weekKey);
  if (!digest) return "empty_vault";

  const quietStreak = digest.quiet ? (Number(agency.opticWeeklyQuietStreak) || 0) + 1 : 0;
  const skipQuiet = digest.quiet && quietStreak > MAX_QUIET_SENDS;

  // create() fails if the report exists, so overlapping runs can't both send.
  const reportRef = agencyRef.collection("opticWeeklyReports").doc(weekKey);
  try {
    await reportRef.create({
      weekKey,
      totals: digest.totals,
      newLeads: digest.newLeads,
      contactedThisWeek: digest.contactedThisWeek,
      quiet: digest.quiet,
      headline: digest.data.headline,
      sentTo: [],
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    return "already_sent";
  }

  const recipients = skipQuiet ? [] : await loadRecipients(agency);
  const sentTo: string[] = [];
  for (const r of recipients) {
    if (await sendDigest(digest, r)) sentTo.push(r.email);
  }
  if (recipients.length > 0 && sentTo.length === 0) {
    await reportRef.delete();
    return "send_failed";
  }

  await reportRef.update({sentTo});
  await agencyRef.update({
    opticWeeklyLastSentKey: weekKey,
    opticWeeklyQuietStreak: quietStreak,
  });
  if (skipQuiet) return "paused_quiet";
  return sentTo.length ? `sent_${sentTo.length}` : "no_recipients";
}

/** Monday 14:00 UTC (8am Mountain): one Optic Weekly per eligible brand. */
export const sendOpticWeekly = onSchedule(
  {schedule: "0 14 * * 1", timeZone: "UTC", timeoutSeconds: 540, memory: "512MiB"},
  async () => {
    if (!initSendgrid()) return;
    const weekKey = weekKeyFor(new Date());
    const ids = await eligibleAgencyIds();
    const outcomes: Record<string, number> = {};
    for (const id of ids) {
      try {
        const outcome = await processAgency(id, weekKey);
        const bucket = outcome.startsWith("sent_") ? "sent" : outcome;
        outcomes[bucket] = (outcomes[bucket] ?? 0) + 1;
      } catch (e) {
        outcomes.error = (outcomes.error ?? 0) + 1;
        logger.error("[Optic weekly] agency failed", {agencyId: id, error: e instanceof Error ? e.message : String(e)});
      }
    }
    logger.info("[Optic weekly] done", {weekKey, agencies: ids.length, outcomes});
  }
);

/** Sends this week's digest for the caller's primary brand to the caller only (no report saved). */
export const previewOpticWeekly = onCall({timeoutSeconds: 120, memory: "512MiB"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to preview Optic Weekly.");
  const uid = request.auth.uid;
  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.data();
  if (!user || !TEAM_ROLES.has(String(user.role ?? ""))) {
    throw new HttpsError("permission-denied", "Optic Weekly is for brand teams.");
  }
  const agencyId = typeof user.primaryAgencyId === "string" ? user.primaryAgencyId : "";
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (!agencyId || !email) throw new HttpsError("failed-precondition", "Set a primary brand and email first.");
  const agency = (await db.collection("agencies").doc(agencyId).get()).data();
  if (!agency) throw new HttpsError("not-found", "Brand not found.");
  if (!initSendgrid()) throw new HttpsError("internal", "Email is not configured.");

  const digest = await buildDigest(agencyId, agency, weekKeyFor(new Date()));
  if (!digest) throw new HttpsError("failed-precondition", "The vault is empty, so there's nothing to report yet.");
  let token = typeof user.emailPrefsToken === "string" ? user.emailPrefsToken : "";
  if (!token) {
    token = randomBytes(16).toString("hex");
    await userSnap.ref.update({emailPrefsToken: token});
  }
  const ok = await sendDigest(digest, {uid, email, name: String(user.displayName || "there").split(" ")[0], token});
  if (!ok) throw new HttpsError("internal", "Could not send the preview.");
  return {ok: true, to: email};
});

/**
 * Minimal confirmation page for the unsubscribe link.
 * @param {string} title Heading.
 * @param {string} body Trusted HTML body.
 * @return {string} HTML document.
 */
function unsubscribePage(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f4f4f7; padding: 60px 20px;">
<div style="max-width: 480px; margin: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
  padding: 40px; text-align: center;">
<h1 style="font-size: 22px; color: #1a202c; margin: 0 0 12px 0;">${title}</h1>
<p style="color: #4a5568; font-size: 15px; line-height: 1.6; margin: 0;">${body}</p></div></body></html>`;
}

/** One-click unsubscribe (GET link or RFC 8058 POST); `resubscribe=1` turns it back on. */
export const opticWeeklyUnsubscribe = onRequest(async (req, res) => {
  const uid = String(req.query.u ?? "");
  const token = String(req.query.t ?? "");
  const resubscribe = req.query.resubscribe === "1";
  if (!uid || !token || uid.length > 128 || token.length > 64) {
    res.status(400).send(unsubscribePage("Invalid link", "This unsubscribe link is incomplete."));
    return;
  }
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.emailPrefsToken !== token) {
    res.status(404).send(unsubscribePage("Link expired", "We couldn't match this link to an account."));
    return;
  }
  await ref.update({"emailPreferences.opticWeekly": resubscribe});
  if (req.method === "POST") {
    res.status(200).send("ok");
    return;
  }
  const q = new URLSearchParams({u: uid, t: token, resubscribe: "1"});
  res.status(200).send(resubscribe ?
    unsubscribePage("You're subscribed", "You'll get Optic Weekly every Monday morning.") :
    unsubscribePage(
      "You're unsubscribed",
      `You won't get Optic Weekly anymore. Changed your mind? <a href="?${q.toString()}" style="color: #0E7C5A;">Resubscribe</a>.`
    ));
});

import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import axios from "axios";
import {FieldValue, Timestamp, type DocumentReference} from "firebase-admin/firestore";
import {db} from "./config/firebase";
import * as params from "./config/params";

/** Same app as the Facebook SDK in the web app. */
const APP_ID = "1903627140270068";
const GRAPH = "https://graph.facebook.com/v20.0";
const COUNTRIES = new Set(["US", "CA", "GB", "AU", "DE", "FR", "MX", "BR"]);
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP"]);

const settingsRef = (agencyId: string) => db.collection("agencies").doc(agencyId).collection("private").doc("metaAds");

/**
 * Confirms the caller owns or administers the workspace.
 * @param {string | undefined} uid Caller.
 * @param {string} agencyId Workspace.
 * @return {!Promise<{agencyRef: DocumentReference}>} Agency ref.
 */
async function requireAdmin(uid: string | undefined, agencyId: string): Promise<{agencyRef: DocumentReference}> {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agencyId)) throw new HttpsError("failed-precondition", "Pick a workspace first.");
  const user = (await db.collection("users").doc(uid).get()).data() ?? {};
  const agencyRef = db.collection("agencies").doc(agencyId);
  const agency = (await agencyRef.get()).data();
  const admin = agency?.ownerId === uid ||
    (user.primaryAgencyId === agencyId && (user.role === "agency_owner" || user.role === "agency_admin"));
  if (!agency || !admin) throw new HttpsError("permission-denied", "Only workspace owners and admins can manage Meta ads.");
  return {agencyRef};
}

/**
 * Reads a Meta error into a sentence the brand can act on.
 * @param {unknown} error Axios or other error.
 * @return {string} Message.
 */
function metaMessage(error: unknown): string {
  const data = axios.isAxiosError(error) ? error.response?.data?.error : null;
  const message = data?.error_user_msg || data?.message || (error instanceof Error ? error.message : "Meta request failed");
  return String(message).slice(0, 500);
}

/**
 * Calls the Graph API with the brand's token.
 * @param {string} path Path or id.
 * @param {string} token Access token.
 * @param {Record<string, string>} body Form fields.
 * @param {string} method HTTP method.
 * @return {!Promise<*>} Response data.
 */
async function graph(path: string, token: string, body: Record<string, string> = {}, method: "GET" | "POST" = "GET"): Promise<any> {
  const url = path.startsWith("http") ? path : `${GRAPH}/${path.replace(/^\//, "")}`;
  const params = {...body, access_token: token};
  const response = method === "GET" ? await axios.get(url, {params}) : await axios.post(url, null, {params});
  return response.data;
}

/**
 * Exchanges a short-lived user token for one that lasts about 60 days.
 * @param {string} token Token from the Facebook login.
 * @return {!Promise<{token: string, expiresAt: Timestamp | null}>} Long-lived token.
 */
async function longLived(token: string): Promise<{token: string; expiresAt: Timestamp | null}> {
  const data = await graph("oauth/access_token", token, {
    grant_type: "fb_exchange_token",
    client_id: APP_ID,
    client_secret: params.FACEBOOK_APP_SECRET.value(),
    fb_exchange_token: token,
  });
  const expiresIn = Number(data.expires_in);
  return {
    token: String(data.access_token || token),
    expiresAt: expiresIn > 0 ? Timestamp.fromMillis(Date.now() + expiresIn * 1000) : null,
  };
}

/**
 * Lists the ad accounts and Pages the connected user can advertise with.
 * @param {string} token User token.
 * @return {!Promise<object>} Accounts and pages.
 */
async function destinations(token: string): Promise<{
  adAccounts: Array<{id: string; name: string; currency: string}>;
  pages: Array<{id: string; name: string; instagramId: string | null; instagramUsername: string | null}>;
}> {
  const [accounts, pages] = await Promise.all([
    graph("me/adaccounts", token, {fields: "name,account_id,account_status,currency", limit: "50"}),
    graph("me/accounts", token, {fields: "id,name,instagram_business_account{id,username}", limit: "50"}),
  ]);
  return {
    adAccounts: (accounts.data ?? [])
      .filter((a: {account_status?: number}) => a.account_status === 1)
      .map((a: {account_id: string; name?: string; currency?: string}) => ({
        id: String(a.account_id), name: a.name || `Account ${a.account_id}`, currency: a.currency || "USD",
      })),
    pages: (pages.data ?? []).map((p: {id: string; name?: string; instagram_business_account?: {id?: string; username?: string}}) => ({
      id: String(p.id),
      name: p.name || "Facebook Page",
      instagramId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
      instagramUsername: p.instagram_business_account?.username ?? null,
    })),
  };
}

/** Saves the brand's Meta login and returns the ad accounts and Pages they can use. */
export const connectMetaAds = onCall({secrets: [params.FACEBOOK_APP_SECRET]}, async (request) => {
  const agencyId = String(request.data?.agencyId ?? "");
  await requireAdmin(request.auth?.uid, agencyId);
  const accessToken = String(request.data?.accessToken ?? "").trim();
  if (accessToken.length < 20) throw new HttpsError("invalid-argument", "Connect with Facebook first.");

  let exchanged: {token: string; expiresAt: Timestamp | null};
  let found: Awaited<ReturnType<typeof destinations>>;
  try {
    exchanged = await longLived(accessToken);
    found = await destinations(exchanged.token);
  } catch (error) {
    logger.warn("[meta-ads] connect failed", {agencyId, error: metaMessage(error)});
    throw new HttpsError("failed-precondition", metaMessage(error));
  }
  if (found.adAccounts.length === 0) {
    throw new HttpsError("failed-precondition", "No active ad account was found. Create one in Meta Business Suite, then connect again.");
  }
  if (found.pages.length === 0) {
    throw new HttpsError("failed-precondition", "No Facebook Page was found. Meta ads need a Page, so create or grant access to one and connect again.");
  }

  await settingsRef(agencyId).set({
    accessToken: exchanged.token,
    expiresAt: exchanged.expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: request.auth?.uid ?? null,
  }, {merge: true});
  return found;
});

/** Remembers which ad account and Page this workspace advertises from. */
export const selectMetaAdsAccount = onCall(async (request) => {
  const agencyId = String(request.data?.agencyId ?? "");
  const {agencyRef} = await requireAdmin(request.auth?.uid, agencyId);
  const adAccountId = String(request.data?.adAccountId ?? "");
  const pageId = String(request.data?.pageId ?? "");
  const saved = (await settingsRef(agencyId).get()).data();
  if (!saved?.accessToken) throw new HttpsError("failed-precondition", "Connect Meta first.");

  let found: Awaited<ReturnType<typeof destinations>>;
  try {
    found = await destinations(String(saved.accessToken));
  } catch (error) {
    throw new HttpsError("failed-precondition", metaMessage(error));
  }
  const account = found.adAccounts.find((a) => a.id === adAccountId);
  const page = found.pages.find((p) => p.id === pageId);
  if (!account || !page) throw new HttpsError("invalid-argument", "Pick an ad account and a Page from the list.");

  await settingsRef(agencyId).set({
    adAccountId: account.id,
    adAccountName: account.name,
    currency: account.currency,
    pageId: page.id,
    pageName: page.name,
    instagramActorId: page.instagramId,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  await agencyRef.update({
    "metaAds.connected": true,
    "metaAds.adAccountName": account.name,
    "metaAds.pageName": page.name,
    "metaAds.currency": account.currency,
    "metaAds.updatedAt": FieldValue.serverTimestamp(),
  });
  return {connected: true, adAccountName: account.name, pageName: page.name, currency: account.currency, instagram: Boolean(page.instagramId)};
});

/** Forgets the workspace's Meta connection. */
export const disconnectMetaAds = onCall(async (request) => {
  const agencyId = String(request.data?.agencyId ?? "");
  const {agencyRef} = await requireAdmin(request.auth?.uid, agencyId);
  await settingsRef(agencyId).delete();
  await agencyRef.update({metaAds: FieldValue.delete()});
  return {connected: false};
});

/**
 * Why this submission cannot run as an ad, or null when it can.
 * @param {FirebaseFirestore.DocumentData} gig Campaign.
 * @param {FirebaseFirestore.DocumentData} submission Submission.
 * @return {?string} Reason.
 */
function rightsBlock(gig: FirebaseFirestore.DocumentData, submission: FirebaseFirestore.DocumentData): string | null {
  if (submission.status !== "approved") return "Approve the video before running it as an ad.";
  const rights = gig.usageRights || "1_year";
  if (rights === "none") return "This campaign is editorial only, so its videos can't run as ads.";
  const created = submission.createdAt?.toMillis?.() ??
    (typeof submission.createdAt?.seconds === "number" ? submission.createdAt.seconds * 1000 : Date.now());
  const windowDays = rights === "30_days" ? 30 : rights === "perpetuity" ? null : 365;
  if (windowDays && Date.now() > created + windowDays * 86400000) {
    return "The usage window for this video has ended, so it can't run as an ad.";
  }
  const url = String(submission.videoUrl ?? "");
  if (!url.startsWith("https://") || url.includes("youtube.com") || url.includes("youtu.be")) {
    return "Meta needs the video file. YouTube links can't be uploaded as an ad.";
  }
  return null;
}

/**
 * Loads a submission the caller is allowed to advertise, plus its campaign.
 * @param {string | undefined} uid Caller.
 * @param {string} submissionId Submission.
 * @return {!Promise<object>} Docs and settings.
 */
async function adContext(uid: string | undefined, submissionId: string): Promise<{
  submissionRef: DocumentReference;
  submission: FirebaseFirestore.DocumentData;
  gig: FirebaseFirestore.DocumentData;
  settings: FirebaseFirestore.DocumentData;
}> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(submissionId)) throw new HttpsError("invalid-argument", "Unknown submission.");
  const submissionRef = db.collection("submissions").doc(submissionId);
  const submissionSnap = await submissionRef.get();
  const submission = submissionSnap.data();
  if (!submission) throw new HttpsError("not-found", "That submission no longer exists.");
  const {agencyRef} = await requireAdmin(uid, String(submission.brandId ?? ""));
  const gig = (await db.collection("gigs").doc(String(submission.gigId ?? "")).get()).data();
  if (!gig || gig.brandId !== submission.brandId) throw new HttpsError("failed-precondition", "This submission isn't attached to a campaign.");
  const settings = (await settingsRef(agencyRef.id).get()).data();
  if (!settings?.accessToken || !settings.adAccountId || !settings.pageId) {
    throw new HttpsError("failed-precondition", "Connect Meta on the Agency page first.");
  }
  if (settings.expiresAt?.toMillis && settings.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "The Meta connection expired. Connect it again on the Agency page.");
  }
  return {submissionRef, submission, gig, settings};
}

/**
 * Creates the campaign, ad set, creative and ad once the uploaded video is ready.
 * @param {DocumentReference} submissionRef Submission.
 * @param {FirebaseFirestore.DocumentData} submission Submission data.
 * @param {FirebaseFirestore.DocumentData} gig Campaign.
 * @param {FirebaseFirestore.DocumentData} settings Saved Meta connection.
 * @return {!Promise<object>} Current ad state.
 */
async function finishAd(
  submissionRef: DocumentReference,
  submission: FirebaseFirestore.DocumentData,
  gig: FirebaseFirestore.DocumentData,
  settings: FirebaseFirestore.DocumentData,
): Promise<Record<string, unknown>> {
  const token = String(settings.accessToken);
  const ad = submission.metaAd ?? {};
  const videoId = String(ad.videoId ?? "");
  if (!videoId) throw new HttpsError("failed-precondition", "The video hasn't been sent to Meta yet.");

  const video = await graph(videoId, token, {fields: "status,picture"});
  const videoStatus = video.status?.video_status;
  if (videoStatus === "processing") {
    await submissionRef.update({"metaAd.status": "processing", "metaAd.updatedAt": FieldValue.serverTimestamp()});
    return {status: "processing"};
  }
  if (videoStatus !== "ready") {
    const message = "Meta couldn't process this video. Try a different file.";
    await submissionRef.update({"metaAd.status": "error", "metaAd.error": message, "metaAd.updatedAt": FieldValue.serverTimestamp()});
    throw new HttpsError("failed-precondition", message);
  }

  const account = `act_${settings.adAccountId}`;
  const name = `Verza · ${String(gig.title ?? "Campaign").slice(0, 80)} · ${String(submission.creatorName ?? "Creator").slice(0, 40)}`;
  let campaignId = ad.campaignId as string | undefined;
  let adSetId = ad.adSetId as string | undefined;
  let creativeId = ad.creativeId as string | undefined;
  let adId = ad.adId as string | undefined;

  if (!campaignId) {
    const created = await graph(`${account}/campaigns`, token, {
      name, objective: "OUTCOME_TRAFFIC", status: "PAUSED", special_ad_categories: "[]",
    }, "POST");
    campaignId = String(created.id);
    await submissionRef.update({"metaAd.campaignId": campaignId});
  }
  if (!adSetId) {
    const start = new Date(Date.now() + 5 * 60 * 1000);
    const end = new Date(start.getTime() + Number(ad.days || 7) * 86400000);
    const created = await graph(`${account}/adsets`, token, {
      name,
      campaign_id: campaignId,
      daily_budget: String(ad.dailyBudgetCents || 1000),
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WEBSITE",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      targeting: JSON.stringify({
        geo_locations: {countries: [ad.country || "US"]},
        targeting_automation: {advantage_audience: 1},
      }),
      status: "PAUSED",
    }, "POST");
    adSetId = String(created.id);
    await submissionRef.update({"metaAd.adSetId": adSetId});
  }
  if (!creativeId) {
    const thumbs = await graph(`${videoId}/thumbnails`, token).catch(() => ({data: []}));
    const imageUrl = thumbs.data?.[0]?.uri || video.picture;
    if (!imageUrl) throw new HttpsError("failed-precondition", "Meta hasn't made a thumbnail for this video yet. Try again in a minute.");
    const story: Record<string, unknown> = {
      page_id: settings.pageId,
      video_data: {
        video_id: videoId,
        image_url: imageUrl,
        message: String(ad.message || name).slice(0, 500),
        call_to_action: {type: "LEARN_MORE", value: {link: ad.destinationUrl}},
      },
    };
    if (settings.instagramActorId) story.instagram_actor_id = settings.instagramActorId;
    let created;
    try {
      created = await graph(`${account}/adcreatives`, token, {name, object_story_spec: JSON.stringify(story)}, "POST");
    } catch (error) {
      if (!settings.instagramActorId) throw error;
      delete story.instagram_actor_id;
      created = await graph(`${account}/adcreatives`, token, {name, object_story_spec: JSON.stringify(story)}, "POST");
    }
    creativeId = String(created.id);
    await submissionRef.update({"metaAd.creativeId": creativeId});
  }
  if (!adId) {
    const created = await graph(`${account}/ads`, token, {
      name, adset_id: adSetId!, creative: JSON.stringify({creative_id: creativeId}), status: "PAUSED",
    }, "POST");
    adId = String(created.id);
    await submissionRef.update({"metaAd.adId": adId});
  }
  await graph(campaignId, token, {status: "ACTIVE"}, "POST");
  await graph(adSetId!, token, {status: "ACTIVE"}, "POST");
  await graph(adId, token, {status: "ACTIVE"}, "POST");
  return refreshAd(submissionRef, token, adId);
}

/**
 * Pulls Meta's review status and delivery numbers onto the submission.
 * @param {DocumentReference} submissionRef Submission.
 * @param {string} token Access token.
 * @param {string} adId Ad id.
 * @return {!Promise<object>} Status shown in the app.
 */
async function refreshAd(submissionRef: DocumentReference, token: string, adId: string): Promise<Record<string, unknown>> {
  const ad = await graph(adId, token, {fields: "effective_status,ad_review_feedback"});
  const insights = await graph(`${adId}/insights`, token, {fields: "spend,impressions,inline_link_clicks", date_preset: "maximum"})
    .catch(() => ({data: []}));
  const row = insights.data?.[0] ?? {};
  const effective = String(ad.effective_status ?? "");
  const status = effective === "ACTIVE" ? "active" :
    ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(effective) ? "paused" :
    ["DISAPPROVED", "WITH_ISSUES"].includes(effective) ? "rejected" : "in_review";
  const feedback = ad.ad_review_feedback?.global;
  const update: Record<string, unknown> = {
    "metaAd.status": status,
    "metaAd.effectiveStatus": effective,
    "metaAd.spend": Number(row.spend ?? 0),
    "metaAd.impressions": Number(row.impressions ?? 0),
    "metaAd.clicks": Number(row.inline_link_clicks ?? 0),
    "metaAd.updatedAt": FieldValue.serverTimestamp(),
  };
  if (status === "rejected" && feedback) update["metaAd.error"] = String(feedback).slice(0, 500);
  await submissionRef.update(update);
  return {status, effectiveStatus: effective, spend: update["metaAd.spend"], impressions: update["metaAd.impressions"], clicks: update["metaAd.clicks"]};
}

/** Uploads an approved submission video and launches a traffic ad in the brand's ad account. */
export const launchSubmissionAd = onCall({timeoutSeconds: 180}, async (request) => {
  const submissionId = String(request.data?.submissionId ?? "");
  const {submissionRef, submission, gig, settings} = await adContext(request.auth?.uid, submissionId);
  const blocked = rightsBlock(gig, submission);
  if (blocked) throw new HttpsError("failed-precondition", blocked);
  const existing = submission.metaAd;
  if (existing?.adId) throw new HttpsError("already-exists", "This video already has an ad.");
  if (existing?.videoId) return finishAd(submissionRef, submission, gig, settings);

  const dollars = Number(request.data?.dailyBudget);
  const days = Math.round(Number(request.data?.days));
  const country = String(request.data?.country ?? "US").toUpperCase();
  if (!Number.isFinite(dollars) || dollars < 1 || dollars > 5000) {
    throw new HttpsError("invalid-argument", "Set a daily budget between 1 and 5,000.");
  }
  if (days < 1 || days > 90) throw new HttpsError("invalid-argument", "Run the ad for 1 to 90 days.");
  if (!COUNTRIES.has(country)) throw new HttpsError("invalid-argument", "Pick a country from the list.");

  const links = await db.collection("affiliateLinks").where("gigId", "==", submission.gigId).get();
  const link = links.docs.find((d) => d.get("creatorId") === submission.creatorId);
  const destinationUrl = link ? `${params.APP_URL.value()}/l/${link.id}` : String(gig.affiliateSettings?.destinationUrl ?? "");
  if (!destinationUrl.startsWith("https://")) {
    throw new HttpsError("failed-precondition", "Add a destination URL to this campaign, or create the creator's tracking link, before running an ad.");
  }
  const currency = String(settings.currency || "USD");
  const dailyBudgetCents = ZERO_DECIMAL.has(currency) ? Math.round(dollars) : Math.round(dollars * 100);
  const message = String(request.data?.message || `${submission.creatorName} on ${gig.title}`).slice(0, 500);

  await db.runTransaction(async (tx) => {
    const current = (await tx.get(submissionRef)).get("metaAd");
    const started = current?.updatedAt?.toMillis?.() ?? 0;
    if (current?.adId || current?.videoId || (current?.status === "creating" && Date.now() - started < 120000)) {
      throw new HttpsError("already-exists", "This video already has an ad in progress.");
    }
    tx.update(submissionRef, {
      metaAd: {
        status: "creating", dailyBudgetCents, currency, days, country, destinationUrl, message,
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
  });
  try {
    const uploaded = await graph(`act_${settings.adAccountId}/advideos`, String(settings.accessToken), {
      file_url: String(submission.videoUrl),
      name: message.slice(0, 100),
    }, "POST");
    await submissionRef.update({"metaAd.videoId": String(uploaded.id), "metaAd.status": "processing"});
    const fresh = (await submissionRef.get()).data()!;
    return await finishAd(submissionRef, fresh, gig, settings);
  } catch (error) {
    const messageText = error instanceof HttpsError ? error.message : metaMessage(error);
    if (!(error instanceof HttpsError && error.code === "failed-precondition" && messageText.includes("thumbnail"))) {
      await submissionRef.update({"metaAd.status": "error", "metaAd.error": messageText, "metaAd.updatedAt": FieldValue.serverTimestamp()});
    }
    logger.warn("[meta-ads] launch failed", {submissionId, error: messageText});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", messageText);
  }
});

/** Finishes an ad whose video is still processing, or refreshes one that is already live. */
export const continueSubmissionAd = onCall({timeoutSeconds: 120}, async (request) => {
  const submissionId = String(request.data?.submissionId ?? "");
  const {submissionRef, submission, gig, settings} = await adContext(request.auth?.uid, submissionId);
  const ad = submission.metaAd;
  if (!ad) throw new HttpsError("failed-precondition", "This video doesn't have an ad yet.");
  try {
    if (ad.adId) return await refreshAd(submissionRef, String(settings.accessToken), String(ad.adId));
    return await finishAd(submissionRef, submission, gig, settings);
  } catch (error) {
    const messageText = error instanceof HttpsError ? error.message : metaMessage(error);
    if (!(error instanceof HttpsError)) {
      await submissionRef.update({"metaAd.status": "error", "metaAd.error": messageText, "metaAd.updatedAt": FieldValue.serverTimestamp()});
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", messageText);
  }
});

/** Pauses or resumes the ad. */
export const setSubmissionAdStatus = onCall(async (request) => {
  const submissionId = String(request.data?.submissionId ?? "");
  const status = request.data?.status === "PAUSED" ? "PAUSED" : request.data?.status === "ACTIVE" ? "ACTIVE" : "";
  if (!status) throw new HttpsError("invalid-argument", "Pause or resume the ad.");
  const {submissionRef, submission, settings} = await adContext(request.auth?.uid, submissionId);
  const adId = submission.metaAd?.adId;
  if (!adId) throw new HttpsError("failed-precondition", "This video doesn't have an ad yet.");
  try {
    await graph(String(adId), String(settings.accessToken), {status}, "POST");
    return await refreshAd(submissionRef, String(settings.accessToken), String(adId));
  } catch (error) {
    throw new HttpsError("failed-precondition", metaMessage(error));
  }
});

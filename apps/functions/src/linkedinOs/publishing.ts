import {createHmac, timingSafeEqual} from "crypto";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import * as params from "../config/params";
import {isPrismChannel, loadPrismBrandStrategy, PRISM_CHANNEL_LABELS} from "./brandStrategy";
import {prismEntitlementsFrom, prismPeriodKey} from "./billing";
import {agencyTeamUids, appendHistory, loadPrismPost, notify, prismCaller, PRISM_POSTS, type PrismCaller} from "./posts";
import type {
  PrismChannel,
  PrismChannelPublishState,
  PrismConnectedAccount,
  PrismConnections,
  PrismPost,
  PrismPostEvent,
  PrismPublish,
  PrismVariant,
} from "./types";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const CONNECTIONS = "prism_connections";
const WEBHOOK_EVENTS = "prism_webhook_events";
const MAX_ATTEMPTS = 3;
/** The scheduler hands posts to Zernio this far ahead; Zernio publishes at the exact time. */
const LOOKAHEAD_MS = 10 * 60 * 1000;
/** Approved posts older than this are left for the team instead of going out late. */
const OVERDUE_LIMIT_MS = 24 * 60 * 60 * 1000;
const STALE_LOCK_MS = 10 * 60 * 1000;
const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** X API fees Zernio passes through at cost, in millionths of a dollar. */
const X_TWEET_MICROS = 15_000;
const X_LINK_TWEET_MICROS = 200_000;
const X_LINK = /https?:\/\/\S|\bwww\.\S|\b[a-z0-9-]+\.(?:com|io|co|ai|app|dev|net|org|xyz|me|so|gg|ly|tv)\b/i;

const PLATFORM: Record<PrismChannel, string> = {
  linkedin: "linkedin",
  x: "twitter",
  instagram: "instagram",
  tiktok: "tiktok",
};
const CHANNEL_BY_PLATFORM: Record<string, PrismChannel> = {
  linkedin: "linkedin",
  twitter: "x",
  instagram: "instagram",
  tiktok: "tiktok",
};

type ZernioPlatformResult = {
  platform: string;
  status?: string;
  accountId?: string;
  platformPostUrl?: string;
  publishedUrl?: string;
  errorMessage?: string;
  error?: string;
};

type ZernioPost = {
  _id?: string;
  id?: string;
  status?: string;
  platforms?: ZernioPlatformResult[];
  metadata?: Record<string, unknown>;
};

type ZernioAccount = {
  _id: string;
  platform: string;
  profileId?: string | {_id?: string};
  username?: string;
  displayName?: string;
  profilePicture?: string | null;
  isActive?: boolean;
};

/** Error response from the Zernio API. */
class ZernioError extends Error {
  /**
   * @param {string} message Error message.
   * @param {number} status HTTP status.
   * @param {Record<string, unknown>} body Response body.
   */
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
  }
}

/**
 * Calls the Zernio API.
 * @param {string} path Path under /api/v1.
 * @param {object=} init Method, JSON body and extra headers.
 * @return {!Promise<object>} HTTP status and parsed body.
 */
async function zernio<T>(
  path: string,
  init: {method?: string; body?: unknown; headers?: Record<string, string>} = {}
): Promise<{status: number; data: T}> {
  const key = params.ZERNIO_API_KEY.value().trim();
  if (!key) throw new HttpsError("unavailable", "Publishing isn't configured yet.");
  const res = await fetch(`${ZERNIO_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${key}`,
      ...(init.body === undefined ? {} : {"Content-Type": "application/json"}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = String(data.error ?? data.message ?? `Zernio returned ${res.status}`);
    throw new ZernioError(message, res.status, data);
  }
  return {status: res.status, data: data as T};
}

/**
 * Turns a Zernio error into something the app can show.
 * @param {unknown} e Error.
 */
function rethrowForClient(e: unknown): never {
  if (e instanceof HttpsError) throw e;
  if (e instanceof ZernioError) {
    logger.warn("[Prism publish] Zernio error", {status: e.status, body: e.body});
    throw new HttpsError("failed-precondition", e.message.slice(0, 300));
  }
  throw e;
}

/**
 * Whether the brand is on a paid Prism plan.
 * @param {string} agencyId Agency id.
 * @return {!Promise<boolean>} True on Launch or Enterprise.
 */
async function agencyHasLaunch(agencyId: string): Promise<boolean> {
  const agency = (await db.collection("agencies").doc(agencyId).get()).data() ?? {};
  return prismEntitlementsFrom(agency).tier !== "free";
}

/**
 * Throws an upgrade error unless the brand is on Launch or Enterprise.
 * @param {string} agencyId Agency id.
 */
async function requireLaunch(agencyId: string): Promise<void> {
  if (await agencyHasLaunch(agencyId)) return;
  throw new HttpsError(
    "resource-exhausted",
    "Auto-publishing is part of Prism Launch. Upgrade to connect your accounts.",
    {upgrade: true, pricingPath: "/prism/pricing"}
  );
}

/**
 * Only owners and admins manage connected accounts.
 * @param {PrismCaller} c Caller.
 */
function assertLead(c: PrismCaller): void {
  if (c.role !== "agency_owner" && c.role !== "agency_admin") {
    throw new HttpsError("permission-denied", "Ask your brand's owner or an admin to manage connected accounts.");
  }
}

/**
 * Loads a brand's connections doc.
 * @param {string} agencyId Agency id.
 * @return {!Promise<?PrismConnections>} Connections, or null.
 */
async function loadConnections(agencyId: string): Promise<PrismConnections | null> {
  const snap = await db.collection(CONNECTIONS).doc(agencyId).get();
  return snap.exists ? (snap.data() as PrismConnections) : null;
}

/**
 * Returns the brand's Zernio profile id, creating the profile on first use.
 * @param {string} agencyId Agency id.
 * @return {!Promise<string>} Profile id.
 */
async function ensureZernioProfile(agencyId: string): Promise<string> {
  const existing = await loadConnections(agencyId);
  if (existing?.zernioProfileId) return existing.zernioProfileId;
  const strategy = await loadPrismBrandStrategy(agencyId);
  const name = `${strategy?.brandName || "Brand"} (${agencyId})`.slice(0, 100);
  const {data} = await zernio<{profile?: {_id?: string}}>("/profiles", {method: "POST", body: {name}});
  const profileId = data.profile?._id;
  if (!profileId) throw new HttpsError("internal", "Could not set up publishing for this brand.");
  await db.collection(CONNECTIONS).doc(agencyId).set(
    {agencyId, zernioProfileId: profileId, accounts: {}, updatedAt: FieldValue.serverTimestamp()},
    {merge: true}
  );
  return profileId;
}

/**
 * Refreshes a brand's connected accounts from Zernio (one account per channel).
 * @param {string} agencyId Agency id.
 * @return {!Promise<?PrismConnections>} Updated connections, or null before any connect.
 */
async function syncConnections(agencyId: string): Promise<PrismConnections | null> {
  const conn = await loadConnections(agencyId);
  if (!conn?.zernioProfileId) return null;
  const {data} = await zernio<{accounts?: ZernioAccount[]}>(
    `/accounts?profileId=${encodeURIComponent(conn.zernioProfileId)}`
  );
  const now = new Date().toISOString();
  const accounts: Partial<Record<PrismChannel, PrismConnectedAccount>> = {};
  for (const a of data.accounts ?? []) {
    const ch = CHANNEL_BY_PLATFORM[a.platform];
    const profileId = typeof a.profileId === "string" ? a.profileId : a.profileId?._id;
    if (!ch || (profileId && profileId !== conn.zernioProfileId)) continue;
    const prev = conn.accounts?.[ch];
    const status = a.isActive === false ? "disconnected" : "connected";
    if (accounts[ch]?.status === "connected" && status !== "connected") continue;
    accounts[ch] = {
      accountId: a._id,
      username: a.username ?? "",
      ...(a.displayName ? {displayName: a.displayName} : {}),
      ...(a.profilePicture ? {avatarUrl: a.profilePicture} : {}),
      status,
      connectedAt: prev?.accountId === a._id ? prev.connectedAt : now,
    };
  }
  await db.collection(CONNECTIONS).doc(agencyId).update({accounts, updatedAt: FieldValue.serverTimestamp()});
  return {...conn, accounts};
}

/** Zernio's hosted login URL for connecting one channel. */
export const getPrismConnectUrl = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  assertLead(c);
  const channel = request.data?.channel;
  if (!isPrismChannel(channel)) throw new HttpsError("invalid-argument", "Pick a channel.");
  await requireLaunch(c.agencyId);
  try {
    const profileId = await ensureZernioProfile(c.agencyId);
    const qs = new URLSearchParams({
      profileId,
      redirect_url: `${params.APP_URL.value().replace(/\/$/, "")}/prism/accounts`,
    });
    const {data} = await zernio<{authUrl?: string}>(`/connect/${PLATFORM[channel]}?${qs.toString()}`);
    if (!data.authUrl) throw new HttpsError("internal", "Could not start the connection.");
    return {url: data.authUrl};
  } catch (e) {
    rethrowForClient(e);
  }
});

/** Re-reads connected accounts from Zernio (after the connect redirect, or on demand). */
export const syncPrismConnections = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  try {
    const conn = await syncConnections(c.agencyId);
    return {accounts: conn?.accounts ?? {}};
  } catch (e) {
    rethrowForClient(e);
  }
});

/** Disconnects one channel's account. */
export const disconnectPrismAccount = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  assertLead(c);
  const channel = request.data?.channel;
  if (!isPrismChannel(channel)) throw new HttpsError("invalid-argument", "Pick a channel.");
  const conn = await loadConnections(c.agencyId);
  const account = conn?.accounts?.[channel];
  if (!account) return {ok: true};
  try {
    await zernio(`/accounts/${encodeURIComponent(account.accountId)}`, {method: "DELETE"});
  } catch (e) {
    if (!(e instanceof ZernioError && e.status === 404)) rethrowForClient(e);
  }
  await db.collection(CONNECTIONS).doc(c.agencyId).update({
    [`accounts.${channel}`]: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info("[Prism publish] Account disconnected", {agencyId: c.agencyId, channel, uid: c.uid});
  return {ok: true};
});

/**
 * A history entry written by Prism itself.
 * @param {string} action Action label.
 * @return {PrismPostEvent} Event.
 */
function systemEvent(action: string): PrismPostEvent {
  return {at: new Date().toISOString(), uid: "prism", name: "Prism", action: action.slice(0, 300)};
}

/**
 * Signed read URL for a Storage object, so Zernio can fetch the media.
 * @param {string} path Storage path.
 * @return {!Promise<string>} URL.
 */
async function signedUrl(path: string): Promise<string> {
  const bucket = admin.storage().bucket(params.APP_STORAGE_BUCKET.value());
  const [url] = await bucket.file(path).getSignedUrl({action: "read", expires: Date.now() + SIGNED_URL_TTL_MS});
  return url;
}

/**
 * TikTok post settings, which TikTok requires on every API post: the creator's allowed privacy level,
 * explicit interaction toggles, brand and AI disclosure, and the consent flags.
 * @param {string} accountId Zernio TikTok account id.
 * @return {!Promise<object>} tiktokSettings.
 */
async function tiktokSettings(accountId: string): Promise<Record<string, unknown>> {
  type Toggle = {enabled?: boolean} | null;
  let levels: string[] = [];
  let comments = true;
  try {
    const {data} = await zernio<{
      privacyLevels?: Array<{value?: string}>;
      postingLimits?: {interactionSettings?: {allow_comment?: Toggle}};
    }>(`/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info?mediaType=video`);
    levels = (data.privacyLevels ?? []).map((l) => String(l.value ?? "")).filter(Boolean);
    comments = data.postingLimits?.interactionSettings?.allow_comment?.enabled !== false;
  } catch (e) {
    logger.warn("[Prism publish] TikTok creator info unavailable", {accountId, e: String(e)});
  }
  return {
    privacy_level: levels.length && !levels.includes("PUBLIC_TO_EVERYONE") ? levels[0] : "PUBLIC_TO_EVERYONE",
    allow_comment: comments,
    allow_duet: false,
    allow_stitch: false,
    commercialContentType: "brand_organic",
    video_made_with_ai: true,
    content_preview_confirmed: true,
    express_consent_given: true,
  };
}

/**
 * Splits "1/ … 2/ …" thread copy into posts (falls back to blank-line paragraphs).
 * @param {string} text Thread copy.
 * @return {!Array<string>} Posts.
 */
function splitThread(text: string): string[] {
  const posts: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*\d+\s*\//.test(line) || posts.length === 0) posts.push(line.trim());
    else posts[posts.length - 1] = `${posts[posts.length - 1]}\n${line}`.trim();
  }
  const clean = posts.filter(Boolean);
  if (clean.length > 1) return clean;
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * What publishing one X variant costs: tweets sent, how many carry a link, and the fee.
 * @param {PrismVariant | undefined} v X variant.
 * @return {{tweets: number, linkTweets: number, micros: number}} Usage.
 */
function xUsage(v: PrismVariant | undefined): {tweets: number; linkTweets: number; micros: number} {
  const text = v?.text.trim() ?? "";
  if (!v || !text) return {tweets: 0, linkTweets: 0, micros: 0};
  const items = v.format === "x_thread" ? splitThread(text) : [text];
  const tweets = Math.max(items.length, 1);
  const linkTweets = items.filter((t) => X_LINK.test(t)).length;
  return {tweets, linkTweets, micros: (tweets - linkTweets) * X_TWEET_MICROS + linkTweets * X_LINK_TWEET_MICROS};
}

/**
 * The body of a "## Heading" section in format copy.
 * @param {string} text Copy.
 * @param {string} heading Heading text.
 * @return {string} Section body, or "".
 */
function section(text: string, heading: string): string {
  const m = text.match(new RegExp(`^##\\s*${heading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "im"));
  return m?.[1]?.trim() ?? "";
}

/**
 * Builds one channel's Zernio platform entry, or explains why it has to be posted by hand.
 * @param {PrismChannel} ch Channel.
 * @param {PrismVariant | undefined} v Variant.
 * @param {PrismPost} post Post.
 * @return {!Promise<object>} {entry} or {manual: reason}.
 */
async function buildEntry(
  ch: PrismChannel,
  v: PrismVariant | undefined,
  post: PrismPost
): Promise<{entry: Record<string, unknown>} | {manual: string}> {
  const text = v?.text.trim() ?? "";
  if (!v || !text) return {manual: "No copy for this channel."};
  switch (v.format) {
  case "short_post":
  case "x_post":
    return {entry: {customContent: text}};
  case "x_thread": {
    const items = splitThread(text);
    if (items.length < 2) return {entry: {customContent: items[0] ?? text}};
    return {entry: {customContent: items[0], platformSpecificData: {threadItems: items.map((content) => ({content}))}}};
  }
  case "carousel_outline": {
    if (!v.assets?.pdfStoragePath) return {manual: "Render the slides first so there's a PDF to post."};
    return {
      entry: {
        customContent: section(text, "Caption") || post.title,
        customMedia: [{type: "document", url: await signedUrl(v.assets.pdfStoragePath)}],
        platformSpecificData: {documentTitle: post.title.slice(0, 100)},
      },
    };
  }
  case "ig_carousel": {
    const slides = [...(v.assets?.slides ?? [])].sort((a, b) => a.index - b.index).slice(0, 10);
    if (slides.length < 2) return {manual: "Render the slides first so there are images to post."};
    const urls = await Promise.all(slides.map((s) => signedUrl(s.storagePath)));
    return {
      entry: {
        customContent: section(text, "Caption") || post.title,
        customMedia: urls.map((url) => ({type: "image", url})),
      },
    };
  }
  case "ig_feed": {
    const graphic = v.assets?.slides?.[0];
    if (!graphic) return {manual: "Make the graphic first so there's an image to post."};
    return {
      entry: {
        customContent: section(text, "Caption") || post.title,
        customMedia: [{type: "image", url: await signedUrl(graphic.storagePath)}],
      },
    };
  }
  case "ig_reel":
  case "tiktok_video": {
    if (!v.video) return {manual: "Make the video first so there's something to post."};
    const [url, cover] = await Promise.all([signedUrl(v.video.storagePath), signedUrl(v.video.coverPath)]);
    if (ch === "tiktok") {
      return {entry: {customContent: section(text, "Caption") || post.title, customMedia: [{type: "video", url}]}};
    }
    return {
      entry: {
        customContent: section(text, "Caption") || post.title,
        customMedia: [{type: "video", url}],
        platformSpecificData: {instagramThumbnail: cover, isAiGenerated: true},
      },
    };
  }
  default:
    return {manual: `${PRISM_CHANNEL_LABELS[ch]} can't publish this format yet.`};
  }
}

/**
 * Whether the scheduler should send this post now.
 * @param {PrismPost} post Post.
 * @param {number} now Epoch ms.
 * @return {boolean} True when due.
 */
function readyToSend(post: PrismPost, now: number): boolean {
  if (post.status !== "approved" || post.autoPublish === false || !post.scheduledAt) return false;
  const p = post.publish;
  if (!p) return true;
  if (p.state === "sending") return Date.parse(p.updatedAt) < now - STALE_LOCK_MS;
  return p.state === "failed" && p.attempts < MAX_ATTEMPTS && !!p.nextAttemptAt && Date.parse(p.nextAttemptAt) <= now;
}

/**
 * Maps a Zernio platform status to Prism's.
 * @param {string | undefined} status Zernio status.
 * @return {PrismChannelPublishState} Prism state.
 */
function channelState(status: string | undefined): PrismChannelPublishState {
  if (status === "published") return "published";
  if (status === "failed") return "failed";
  return "pending";
}

/**
 * Maps a Zernio post rollup status to Prism's.
 * @param {string | undefined} status Zernio status.
 * @return {string} Prism state.
 */
function rollupState(status: string | undefined): PrismPublish["state"] {
  switch (status) {
  case "published":
    return "published";
  case "partial":
    return "partial";
  case "failed":
    return "failed";
  case "cancelled":
    return "cancelled";
  default:
    return "scheduled";
  }
}

/**
 * Merges a Zernio post (create response or webhook) into the Prism post.
 * Marks the post posted once every channel is live. Notifies the team about new failures.
 * @param {string} postId Prism post id.
 * @param {ZernioPost} zp Zernio post.
 * @param {boolean} rollup Whether zp.status is final for this publishing run.
 * @return {!Promise<void>}
 */
async function applyZernioPost(postId: string, zp: ZernioPost, rollup: boolean): Promise<void> {
  const ref = db.collection(PRISM_POSTS).doc(postId);
  const zernioId = zp._id ?? zp.id;
  const outcome = await db.runTransaction(async (tx) => {
    const post = (await tx.get(ref)).data() as PrismPost | undefined;
    const prev = post?.publish;
    if (!post || !prev) return null;
    if (prev.zernioPostId && zernioId && prev.zernioPostId !== zernioId) return null;

    const now = new Date().toISOString();
    const channels = {...prev.channels};
    const events: PrismPostEvent[] = [];
    const newlyFailed: string[] = [];
    let xPublished = false;
    for (const p of zp.platforms ?? []) {
      const ch = CHANNEL_BY_PLATFORM[p.platform];
      const before = ch ? channels[ch] : undefined;
      if (!ch || before?.state === "published" || before?.state === "manual") continue;
      const state = channelState(p.status);
      const url = p.platformPostUrl ?? p.publishedUrl;
      const error = p.errorMessage ?? p.error;
      channels[ch] = {state, ...(url ? {url} : {}), ...(state === "failed" && error ? {error: error.slice(0, 500)} : {})};
      if (state === "published") {
        events.push(systemEvent(`published to ${PRISM_CHANNEL_LABELS[ch]}`));
        if (ch === "x") xPublished = true;
      } else if (state === "failed" && before?.state !== "failed") {
        events.push(systemEvent(`${PRISM_CHANNEL_LABELS[ch]} failed: ${error ?? "unknown error"}`));
        newlyFailed.push(`${PRISM_CHANNEL_LABELS[ch]}${error ? ` (${error.slice(0, 120)})` : ""}`);
      }
    }

    const state = rollup ? rollupState(zp.status) : prev.state === "sending" ? "scheduled" : prev.state;
    const publish: PrismPublish = {
      ...prev,
      state,
      ...(zernioId ? {zernioPostId: zernioId} : {}),
      updatedAt: now,
      channels,
    };
    delete publish.nextAttemptAt;
    const update: Record<string, FieldValue | string | PrismPublish | PrismPostEvent[] | PrismPost["variants"]> = {
      publish,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const allLive = post.channels.every((ch) => channels[ch]?.state === "published");
    if (allLive && post.status === "approved") {
      const variants = {...post.variants};
      for (const ch of post.channels) {
        const url = channels[ch]?.url;
        if (variants[ch] && url) variants[ch] = {...variants[ch] as PrismVariant, postedUrl: url};
      }
      update.variants = variants;
      update.status = "posted";
      update.postedAt = FieldValue.serverTimestamp();
    }
    if (events.length) update.history = appendHistory(post.history, ...events);
    tx.update(ref, update);
    if (xPublished) {
      const x = xUsage(post.variants?.x);
      const periodKey = prismPeriodKey();
      tx.set(db.collection("prism_usage").doc(post.agencyId).collection("months").doc(periodKey), {
        agencyId: post.agencyId,
        periodKey,
        x: {
          posts: FieldValue.increment(1),
          tweets: FieldValue.increment(x.tweets),
          linkTweets: FieldValue.increment(x.linkTweets),
          costMicros: FieldValue.increment(x.micros),
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    return {post, newlyFailed};
  });

  if (outcome?.newlyFailed.length) {
    await notify(
      await agencyTeamUids(outcome.post.agencyId),
      "Publishing failed",
      `"${outcome.post.title}" didn't publish to ${outcome.newlyFailed.join(", ")}. Open it to retry or post by hand.`,
      postId
    );
  }
}

/**
 * Hands one approved post to Zernio. Safe to call twice: a lock plus an idempotency key prevent double posts.
 * @param {string} postId Post id.
 * @param {boolean} manualRetry Skip the scheduler's due check (team pressed Retry / Publish now).
 * @return {!Promise<?string>} Resulting state, or null when nothing was sent.
 */
async function sendPost(postId: string, manualRetry = false): Promise<PrismPublish["state"] | null> {
  const ref = db.collection(PRISM_POSTS).doc(postId);
  const locked = await db.runTransaction(async (tx) => {
    const post = (await tx.get(ref)).data() as PrismPost | undefined;
    if (!post) return null;
    if (!manualRetry && !readyToSend(post, Date.now())) return null;
    const prev = post.publish;
    const reuse = prev?.state === "sending" && prev.idempotencyKey;
    const attempts = reuse ? prev.attempts : (prev?.attempts ?? 0) + 1;
    const publish: PrismPublish = {
      state: "sending",
      attempts,
      idempotencyKey: reuse ? prev.idempotencyKey : `prism-${postId}-${attempts}-${Date.now()}`,
      updatedAt: new Date().toISOString(),
      channels: {},
    };
    tx.update(ref, {publish});
    return {post, publish};
  });
  if (!locked) return null;
  const {post, publish} = locked;

  const conn = await loadConnections(post.agencyId);
  const platforms: Record<string, unknown>[] = [];
  const channels: PrismPublish["channels"] = {};
  for (const ch of post.channels) {
    const account = conn?.accounts?.[ch];
    if (!account || account.status !== "connected") {
      channels[ch] = {state: "manual", error: `${PRISM_CHANNEL_LABELS[ch]} isn't connected.`};
      continue;
    }
    const built = await buildEntry(ch, post.variants[ch], post);
    if ("manual" in built) {
      channels[ch] = {state: "manual", error: built.manual};
      continue;
    }
    platforms.push({platform: PLATFORM[ch], accountId: account.accountId, ...built.entry});
    channels[ch] = {state: "pending"};
  }

  if (platforms.length === 0) {
    await ref.update({
      publish: {...publish, state: "manual", channels, updatedAt: new Date().toISOString()},
      history: appendHistory(post.history, systemEvent("nothing to auto-publish — post by hand")),
    });
    return "manual";
  }

  const scheduledFor = new Date(Math.max(Date.parse(post.scheduledAt ?? "") || 0, Date.now())).toISOString();
  const sentAt = new Date().toISOString();
  await ref.update({"publish.channels": channels, "publish.sentAt": sentAt});
  const tiktokAccount = channels.tiktok?.state === "pending" ? conn?.accounts?.tiktok?.accountId : undefined;
  try {
    const {data} = await zernio<{post?: ZernioPost}>("/posts", {
      method: "POST",
      headers: {"Idempotency-Key": publish.idempotencyKey ?? `prism-${postId}`},
      body: {
        content: post.title,
        platforms,
        scheduledFor,
        metadata: {prismPostId: postId, agencyId: post.agencyId},
        ...(tiktokAccount ? {tiktokSettings: await tiktokSettings(tiktokAccount)} : {}),
      },
    });
    const zp = data.post ?? {};
    const final = ["published", "partial", "failed"].includes(zp.status ?? "");
    await applyZernioPost(postId, zp, final);
    logger.info("[Prism publish] Sent", {postId, zernioPostId: zp._id, status: zp.status, platforms: platforms.length});
    return final ? rollupState(zp.status) : "scheduled";
  } catch (e) {
    const body = e instanceof ZernioError ? e.body : {};
    const details = (body.details ?? {}) as Record<string, unknown>;
    const existing = typeof details.existingPostId === "string" ? details.existingPostId :
      typeof body.existingPostId === "string" ? body.existingPostId : "";
    if (e instanceof ZernioError && e.status === 409 && existing) {
      await applyZernioPost(postId, {_id: existing, status: "scheduled"}, false);
      return "scheduled";
    }
    if (e instanceof ZernioError && e.status === 409) {
      return "sending";
    }
    const retryable = !(e instanceof ZernioError) || e.status >= 500 || e.status === 429;
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const canRetry = retryable && publish.attempts < MAX_ATTEMPTS;
    const failedChannels = Object.fromEntries(
      Object.entries(channels).map(([ch, r]) => [ch, r?.state === "pending" ? {state: "failed", error: message} : r])
    );
    await ref.update({
      publish: {
        ...publish,
        state: "failed",
        lastError: message,
        sentAt,
        updatedAt: new Date().toISOString(),
        channels: failedChannels,
        ...(canRetry ? {nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000 * 2 ** (publish.attempts - 1)).toISOString()} : {}),
      },
      history: appendHistory(post.history, systemEvent(`publishing failed${canRetry ? " — will retry" : ""}: ${message}`)),
    });
    logger.error("[Prism publish] Send failed", {postId, attempts: publish.attempts, canRetry, message});
    if (!canRetry) {
      await notify(
        await agencyTeamUids(post.agencyId),
        "Publishing failed",
        `"${post.title}" couldn't be published: ${message}`,
        postId
      );
    }
    return "failed";
  }
}

/** Every 5 minutes: hand approved posts due in the next 10 minutes to Zernio (paid plans only). */
export const publishDuePrismPosts = onSchedule(
  {schedule: "every 5 minutes", timeoutSeconds: 300, memory: "512MiB"},
  async () => {
    if (!params.ZERNIO_API_KEY.value().trim()) return;
    const now = Date.now();
    const snap = await db
      .collection(PRISM_POSTS)
      .where("status", "==", "approved")
      .where("scheduledAt", ">=", new Date(now - OVERDUE_LIMIT_MS).toISOString())
      .where("scheduledAt", "<=", new Date(now + LOOKAHEAD_MS).toISOString())
      .limit(300)
      .get();
    const paid = new Map<string, boolean>();
    let sent = 0;
    for (const doc of snap.docs) {
      const post = doc.data() as PrismPost;
      if (!readyToSend(post, now)) continue;
      if (!paid.has(post.agencyId)) paid.set(post.agencyId, await agencyHasLaunch(post.agencyId));
      if (!paid.get(post.agencyId)) continue;
      const result = await sendPost(doc.id).catch((e) => {
        logger.error("[Prism publish] Unexpected error", {postId: doc.id, e: String(e)});
        return null;
      });
      if (result) sent++;
    }
    if (sent) logger.info("[Prism publish] Scheduler run", {candidates: snap.size, sent});
  }
);

/** Publishes now (or retries) one approved post. */
export const publishPrismPostNow = onCall({timeoutSeconds: 120}, async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const {post, postId} = await loadPrismPost(c, request.data?.postId);
  if (post.status !== "approved") throw new HttpsError("failed-precondition", "Approve the post first.");
  const state = post.publish?.state;
  if (state === "sending" || state === "scheduled" || state === "published" || state === "partial") {
    throw new HttpsError("failed-precondition", "This post is already with the publisher.");
  }
  await requireLaunch(c.agencyId);
  const result = await sendPost(postId, true);
  return {state: result};
});

/** Takes a scheduled post back from Zernio so it can be edited or posted by hand. */
export const cancelPrismPublish = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const {ref, post, postId} = await loadPrismPost(c, request.data?.postId);
  const p = post.publish;
  if (!p || (p.state !== "scheduled" && p.state !== "sending")) {
    throw new HttpsError("failed-precondition", "This post isn't waiting to publish.");
  }
  if (p.zernioPostId) {
    try {
      await zernio(`/posts/${encodeURIComponent(p.zernioPostId)}`, {method: "DELETE"});
    } catch (e) {
      if (!(e instanceof ZernioError && e.status === 404)) rethrowForClient(e);
    }
  }
  await ref.update({
    publish: {...p, state: "cancelled", updatedAt: new Date().toISOString()},
    history: appendHistory(post.history, {
      at: new Date().toISOString(),
      uid: c.uid,
      name: c.name,
      action: "cancelled auto-publish",
    }),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info("[Prism publish] Cancelled", {postId, uid: c.uid});
  return {ok: true};
});

/**
 * Constant-time comparison of two hex signatures.
 * @param {string} a Signature.
 * @param {string} b Signature.
 * @return {boolean} True when equal.
 */
function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Handles one verified Zernio event.
 * @param {Record<string, unknown>} payload Event payload.
 * @return {!Promise<void>}
 */
async function handleZernioEvent(payload: Record<string, unknown>): Promise<void> {
  const event = String(payload.event ?? "");
  if (event.startsWith("post.")) {
    const zp = (payload.post ?? {}) as ZernioPost;
    const postId = typeof zp.metadata?.prismPostId === "string" ? zp.metadata.prismPostId : "";
    if (!postId) return;
    if (event === "post.platform.published" || event === "post.platform.failed") {
      await applyZernioPost(postId, zp, false);
    } else if (["post.published", "post.partial", "post.failed", "post.cancelled"].includes(event)) {
      await applyZernioPost(postId, {...zp, status: event.slice("post.".length)}, true);
    }
    return;
  }
  if (event === "account.connected" || event === "account.disconnected") {
    const account = (payload.account ?? {}) as {profileId?: string};
    if (!account.profileId) return;
    const snap = await db.collection(CONNECTIONS).where("zernioProfileId", "==", account.profileId).limit(1).get();
    if (!snap.empty) await syncConnections(snap.docs[0].id);
  }
}

/** Zernio webhook: post results and account changes. */
export const prismZernioWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  const secret = params.ZERNIO_WEBHOOK_SECRET.value().trim();
  const signature = String(req.get("x-zernio-signature") ?? "");
  if (!secret || !signature || !req.rawBody) {
    res.status(401).send("Missing signature");
    return;
  }
  const expected = createHmac("sha256", secret).update(req.rawBody).digest("hex");
  if (!sameSignature(signature.toLowerCase(), expected)) {
    res.status(400).send("Invalid signature");
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(req.rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }
  const eventId = String(payload.id ?? req.get("x-zernio-event-id") ?? "");
  const marker = eventId ? db.collection(WEBHOOK_EVENTS).doc(eventId) : null;
  if (marker) {
    try {
      await marker.create({event: String(payload.event ?? ""), receivedAt: FieldValue.serverTimestamp()});
    } catch {
      res.status(200).json({received: true, duplicate: true});
      return;
    }
  }
  try {
    await handleZernioEvent(payload);
  } catch (e) {
    logger.error("[Prism publish] Webhook handling failed", {eventId, event: payload.event, e: String(e)});
    if (marker) await marker.delete().catch(() => undefined);
    res.status(500).send("Handler error");
    return;
  }
  res.status(200).json({received: true});
});

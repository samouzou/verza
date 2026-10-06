import {FieldValue} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {db} from "../config/firebase";
import {assertAgencyTeamForLinkedInOs} from "./access";
import {LINKEDIN_OS_WORKER_SHARED_SECRET, LINKEDIN_OS_WORKER_URL} from "../config/params";
import {
  isPrismChannel,
  loadPrismBrandStrategy,
  PRISM_CHANNEL_FORMATS,
  PRISM_CHANNEL_LABELS,
  PRISM_CHANNELS,
} from "./brandStrategy";
import {PRISM_MAX_VARIANT_CHARS} from "./channelFormats";
import {withPrismUsage} from "./billing";
import type {
  LinkedInOsJobItem,
  LinkedInOsJobOutput,
  PrismChannel,
  PrismFormat,
  PrismPost,
  PrismPostEvent,
  PrismPostStatus,
  PrismVariant,
} from "./types";

export const PRISM_POSTS = "prism_posts";
const MAX_HISTORY = 50;

export type PrismCaller = {
  uid: string;
  agencyId: string;
  role: string;
  name: string;
};

/**
 * Resolves the signed-in team member for Prism post actions.
 * @param {string | undefined} uid Auth uid.
 * @return {!Promise<PrismCaller>} Caller context.
 */
export async function prismCaller(uid: string | undefined): Promise<PrismCaller> {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to use Prism.");
  }
  const agencyId = await assertAgencyTeamForLinkedInOs(uid);
  const user = (await db.collection("users").doc(uid).get()).data() ?? {};
  const name = String(user.displayName || user.email || "Teammate").slice(0, 80);
  return {uid, agencyId, role: String(user.role ?? ""), name};
}

/**
 * Builds a history entry.
 * @param {PrismCaller} c Caller.
 * @param {string} action Action label.
 * @param {string=} comment Optional comment.
 * @return {PrismPostEvent} Event.
 */
export function prismEvent(c: PrismCaller, action: string, comment?: string): PrismPostEvent {
  return {
    at: new Date().toISOString(),
    uid: c.uid,
    name: c.name,
    action,
    ...(comment ? {comment: comment.slice(0, 1000)} : {}),
  };
}

/**
 * Appends events to history, keeping the newest entries.
 * @param {!Array<PrismPostEvent>} history Existing history.
 * @param {...PrismPostEvent} events New events.
 * @return {!Array<PrismPostEvent>} Capped history.
 */
export function appendHistory(history: PrismPostEvent[] | undefined, ...events: PrismPostEvent[]): PrismPostEvent[] {
  return [...(history ?? []), ...events].slice(-MAX_HISTORY);
}

/**
 * Loads a post the caller's agency owns.
 * @param {PrismCaller} c Caller.
 * @param {unknown} rawId Post id from the client.
 * @return {!Promise<object>} Ref and data.
 */
export async function loadPrismPost(c: PrismCaller, rawId: unknown) {
  const postId = typeof rawId === "string" ? rawId.trim() : "";
  if (!postId) throw new HttpsError("invalid-argument", "postId is required.");
  const ref = db.collection(PRISM_POSTS).doc(postId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Post not found.");
  const post = snap.data() as PrismPost;
  if (post.agencyId !== c.agencyId) throw new HttpsError("permission-denied", "Not your brand's post.");
  return {ref, post, postId};
}

/**
 * Whether the post is with the publisher (Zernio has it or is about to).
 * @param {PrismPost} post Post.
 * @return {boolean} True while locked.
 */
function withPublisher(post: PrismPost): boolean {
  return post.publish?.state === "sending" || post.publish?.state === "scheduled";
}

/**
 * Whether a finished-but-unsuccessful publish run should be cleared so the scheduler re-evaluates the post.
 * @param {PrismPost} post Post.
 * @return {boolean} True for failed, manual or cancelled runs.
 */
function stalePublish(post: PrismPost): boolean {
  const s = post.publish?.state;
  return s === "failed" || s === "manual" || s === "cancelled";
}

const LOCKED_MESSAGE = "This post is scheduled to publish. Cancel auto-publish first.";

/**
 * Whether every selected channel has copy.
 * @param {PrismPost} post Post.
 * @return {boolean} True when complete.
 */
function hasAllVariants(post: Pick<PrismPost, "channels" | "variants">): boolean {
  return post.channels.length > 0 && post.channels.every((ch) => (post.variants[ch]?.text ?? "").trim().length > 0);
}

/**
 * Parses an ISO schedule time, or null.
 * @param {unknown} raw Raw value.
 * @return {?string} ISO string or null.
 */
function parseSchedule(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new HttpsError("invalid-argument", "scheduledAt must be a valid date.");
  return d.toISOString();
}

/**
 * Parses client variants for the selected channels.
 * @param {unknown} raw Raw variants map.
 * @param {!Array<PrismChannel>} channels Selected channels.
 * @return {Partial<Record<PrismChannel, {format: PrismFormat, text: string}>>} Clean variants.
 */
function parseVariants(
  raw: unknown,
  channels: PrismChannel[]
): Partial<Record<PrismChannel, {format: PrismFormat; text: string}>> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<PrismChannel, {format: PrismFormat; text: string}>> = {};
  for (const ch of channels) {
    const v = src[ch];
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const formats = PRISM_CHANNEL_FORMATS[ch];
    out[ch] = {
      format: formats.includes(o.format as PrismFormat) ? (o.format as PrismFormat) : formats[0],
      text: typeof o.text === "string" ? o.text.slice(0, PRISM_MAX_VARIANT_CHARS) : "",
    };
  }
  return out;
}

/**
 * Notifies users in-app (best effort).
 * @param {!Array<string>} userIds Recipients.
 * @param {string} title Title.
 * @param {string} message Body.
 * @param {string} postId Post id for the link.
 * @return {!Promise<void>}
 */
export async function notify(userIds: string[], title: string, message: string, postId: string): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  await Promise.all(
    unique.map((userId) =>
      db.collection("notifications").add({
        userId,
        title,
        message: message.slice(0, 300),
        type: "system",
        read: false,
        link: `/prism?post=${postId}`,
        createdAt: FieldValue.serverTimestamp(),
      })
    )
  ).catch((e) => logger.warn("[Prism] Notification failed", {postId, e: String(e)}));
}

/**
 * Owner plus active team member uids for an agency.
 * @param {string} agencyId Agency id.
 * @return {!Promise<!Array<string>>} User ids.
 */
export async function agencyTeamUids(agencyId: string): Promise<string[]> {
  const a = (await db.collection("agencies").doc(agencyId).get()).data() as
    | {ownerId?: string; team?: Array<{userId?: string; status?: string}>}
    | undefined;
  if (!a) return [];
  const ids = [a.ownerId ?? ""];
  for (const m of a.team ?? []) {
    if (m?.status === "active" && m.userId) ids.push(m.userId);
  }
  return ids.filter(Boolean);
}

/**
 * Creates or updates a post's idea, channels, schedule, and per-channel copy.
 * Editing copy on an approved post sends it back to draft.
 * @return {!Promise<{postId: string, status: string}>} Result.
 */
export const savePrismPost = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const d = (request.data ?? {}) as Record<string, unknown>;

  const strategy = await loadPrismBrandStrategy(c.agencyId);
  const pillarIds = strategy?.pillars.map((p) => p.id) ?? [];

  const title = typeof d.title === "string" ? d.title.trim().slice(0, 200) : "";
  const angle = typeof d.angle === "string" ? d.angle.trim().slice(0, 2000) : "";
  const pillarRaw = typeof d.pillar === "string" ? d.pillar.trim() : "";
  const pillar = pillarIds.includes(pillarRaw) ? pillarRaw : pillarIds[0] ?? pillarRaw.slice(0, 40);
  const channels = Array.isArray(d.channels) ?
    PRISM_CHANNELS.filter((ch) => (d.channels as unknown[]).includes(ch)) :
    [];
  if (!title) throw new HttpsError("invalid-argument", "Give the post a title.");
  if (channels.length === 0) throw new HttpsError("invalid-argument", "Pick at least one channel.");

  const scheduledAt = parseSchedule(d.scheduledAt);
  const incoming = parseVariants(d.variants, channels);
  const autoPublish = typeof d.autoPublish === "boolean" ? d.autoPublish : undefined;
  const now = new Date().toISOString();

  if (typeof d.postId === "string" && d.postId.trim()) {
    const {ref, post, postId} = await loadPrismPost(c, d.postId);
    if (post.status === "posted") {
      throw new HttpsError("failed-precondition", "This post is already marked posted. Reopen it to edit.");
    }
    const variants: Partial<Record<PrismChannel, PrismVariant>> = {};
    let copyChanged = false;
    for (const ch of channels) {
      const prev = post.variants?.[ch];
      const next = incoming[ch];
      if (!next) {
        if (prev) variants[ch] = prev;
        continue;
      }
      const changed = !prev || prev.text !== next.text || prev.format !== next.format;
      if (changed) copyChanged = true;
      const merged: PrismVariant = {...(prev ?? {}), format: next.format, text: next.text, ...(changed ? {editedAt: now} : {})};
      if (prev && prev.format !== next.format) delete merged.assets;
      variants[ch] = merged;
    }
    if (channels.some((ch) => !post.channels.includes(ch)) || channels.length !== post.channels.length) {
      copyChanged = true;
    }

    let status: PrismPostStatus = post.status;
    const events: PrismPostEvent[] = [];
    if (copyChanged && (status === "approved" || status === "in_review")) {
      status = "draft";
      events.push(prismEvent(c, "edited — back to draft"));
    } else if (status === "idea" && Object.values(variants).some((v) => v?.text.trim())) {
      status = "draft";
    }
    const scheduleChanged = post.scheduledAt !== scheduledAt;
    if (scheduleChanged) {
      events.push(prismEvent(c, scheduledAt ? `scheduled for ${scheduledAt}` : "unscheduled"));
    }
    const autoPublishChanged = autoPublish !== undefined && autoPublish !== (post.autoPublish !== false);
    const changed = copyChanged || scheduleChanged || autoPublishChanged || title !== post.title;
    if (changed && withPublisher(post)) throw new HttpsError("failed-precondition", LOCKED_MESSAGE);

    await ref.update({
      title,
      angle,
      pillar,
      channels,
      scheduledAt,
      variants,
      status,
      ...(autoPublish !== undefined ? {autoPublish} : {}),
      ...(changed && stalePublish(post) ? {publish: FieldValue.delete()} : {}),
      history: appendHistory(post.history, ...events),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: c.uid,
    });
    return {postId, status};
  }

  const variants: Partial<Record<PrismChannel, PrismVariant>> = {};
  for (const ch of channels) {
    const v = incoming[ch];
    if (v) variants[ch] = {format: v.format, text: v.text, ...(v.text ? {editedAt: now} : {})};
  }
  const post: PrismPost = {
    agencyId: c.agencyId,
    title,
    angle,
    pillar,
    channels,
    scheduledAt,
    status: Object.values(variants).some((v) => v?.text.trim()) ? "draft" : "idea",
    variants,
    history: [prismEvent(c, "created")],
    source: "manual",
    ...(autoPublish === false ? {autoPublish} : {}),
    createdBy: c.uid,
    createdByName: c.name,
  };
  const ref = db.collection(PRISM_POSTS).doc();
  await ref.set({...post, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
  logger.info("[Prism] Post created", {postId: ref.id, agencyId: c.agencyId, channels});
  return {postId: ref.id, status: post.status};
});

/**
 * Calendar title for a Studio draft: the planned hook, else the first line of copy.
 * Mirrors the worker's studioTitle.
 * @param {string} hook Planned hook.
 * @param {string} markdown Draft copy.
 * @param {string} fallback Fallback (item id).
 * @return {string} Title.
 */
function studioTitle(hook: string, markdown: string, fallback: string): string {
  const firstLine = markdown.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
  return (hook.trim() || firstLine).replace(/^[-*\d/.\s]+/, "").slice(0, 120) || fallback;
}

/**
 * Puts a draft from an older Studio job on the calendar (newer jobs do this automatically).
 * Returns the existing post if the draft is already there.
 * @return {!Promise<{postId: string, existing: boolean}>} Result.
 */
export const addStudioDraftToCalendar = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const jobId = typeof request.data?.jobId === "string" ? request.data.jobId.trim() : "";
  const outputId = typeof request.data?.outputId === "string" ? request.data.outputId.trim() : "";
  if (!jobId || !outputId) throw new HttpsError("invalid-argument", "jobId and outputId are required.");

  const jobRef = db.collection("linkedin_os_jobs").doc(jobId);
  const postRef = db.collection(PRISM_POSTS).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const job = snap.data();
    if (!job) throw new HttpsError("not-found", "Studio job not found.");
    if (job.agencyId !== c.agencyId) throw new HttpsError("permission-denied", "Not your brand's job.");
    const outputs = Array.isArray(job.outputs) ? ([...job.outputs] as LinkedInOsJobOutput[]) : [];
    const idx = outputs.findIndex((o) => o.id === outputId);
    if (idx < 0) throw new HttpsError("not-found", "Draft not found on this job.");
    const out = outputs[idx];
    if (out.postId) {
      const existing = await tx.get(db.collection(PRISM_POSTS).doc(out.postId));
      if (existing.exists) return {postId: out.postId, existing: true};
    }

    const items = Array.isArray(job.items) ? (job.items as LinkedInOsJobItem[]) : [];
    const item = items.find((i) => i.id === outputId);
    const channel: PrismChannel = isPrismChannel(out.channel) ? out.channel : "linkedin";
    const formats = PRISM_CHANNEL_FORMATS[channel];
    const format = formats.includes(out.format as PrismFormat) ? (out.format as PrismFormat) : formats[0];
    const variant: PrismVariant = {format, text: out.markdown, generatedAt: out.generatedAt};
    if (out.carouselAssets?.slides?.length) {
      variant.assets = {...out.carouselAssets, renderedAt: out.generatedAt};
    }
    const post: PrismPost = {
      agencyId: c.agencyId,
      title: studioTitle(item?.hook ?? "", out.markdown, out.id),
      angle: item?.productTruth ?? "",
      pillar: out.pillar,
      channels: [channel],
      scheduledAt: out.scheduledAt ?? item?.scheduledAt ?? null,
      status: "draft",
      variants: {[channel]: variant},
      history: [prismEvent(c, "added from Studio")],
      source: "studio",
      studio: {jobId, itemId: outputId},
      createdBy: c.uid,
      createdByName: c.name,
    };
    tx.set(postRef, {...post, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
    outputs[idx] = {...out, postId: postRef.id};
    tx.update(jobRef, {outputs});
    return {postId: postRef.id, existing: false};
  });
  logger.info("[Prism] Studio draft added to calendar", {jobId, outputId, ...result});
  return result;
});

const CAROUSEL_FORMATS = new Set<PrismFormat>(["carousel_outline", "ig_carousel"]);

/**
 * Renders (or re-renders) carousel slides from a post's current outline for one channel, via the worker.
 * @return {!Promise<{slides: number}>} Slide count.
 */
export const renderPrismSlides = onCall({timeoutSeconds: 180}, async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const {ref, post, postId} = await loadPrismPost(c, request.data?.postId);
  const channel = request.data?.channel;
  if (!isPrismChannel(channel) || !post.channels.includes(channel)) {
    throw new HttpsError("invalid-argument", "Pick one of the post's channels.");
  }
  const variant = post.variants?.[channel];
  if (!variant || !CAROUSEL_FORMATS.has(variant.format)) {
    throw new HttpsError("failed-precondition", "Switch this channel to a carousel format first.");
  }
  if (!variant.text.trim()) throw new HttpsError("failed-precondition", "Write the carousel outline first.");
  if (post.status === "posted") throw new HttpsError("failed-precondition", "This post is already marked posted.");
  if (withPublisher(post)) throw new HttpsError("failed-precondition", LOCKED_MESSAGE);

  const workerUrl = LINKEDIN_OS_WORKER_URL.value().trim();
  const secret = LINKEDIN_OS_WORKER_SHARED_SECRET.value().trim();
  if (!workerUrl || !secret) throw new HttpsError("unavailable", "The slide renderer isn't configured.");

  const body = await withPrismUsage(c.agencyId, {slideRender: true}, async () => {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/render-slides`, {
      method: "POST",
      headers: {"Content-Type": "application/json", "x-verza-linkedin-os-secret": secret},
      body: JSON.stringify({postId, channel}),
    });
    const json = (await res.json().catch(() => ({}))) as {error?: string; slides?: number};
    if (!res.ok) {
      logger.error("[Prism] Slide render failed", {postId, channel, status: res.status, error: json.error});
      throw new HttpsError(
        res.status === 400 ? "failed-precondition" : "internal",
        res.status === 400 && json.error ? json.error : "Could not render the slides. Try again."
      );
    }
    return json;
  });

  const fresh = (await ref.get()).data() as PrismPost | undefined;
  await ref.update({
    history: appendHistory(fresh?.history ?? post.history, prismEvent(c, `rendered ${PRISM_CHANNEL_LABELS[channel]} slides`)),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: c.uid,
  });
  return {slides: body.slides ?? 0};
});

/**
 * Deletes a post.
 * @return {!Promise<{ok: boolean}>} Result.
 */
export const deletePrismPost = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const {ref, post, postId} = await loadPrismPost(c, request.data?.postId);
  if (withPublisher(post)) throw new HttpsError("failed-precondition", LOCKED_MESSAGE);
  await ref.delete();
  logger.info("[Prism] Post deleted", {postId, uid: c.uid});
  return {ok: true};
});

type TransitionAction = "submit" | "approve" | "request_changes" | "mark_posted" | "reopen";
const ACTIONS = new Set<TransitionAction>(["submit", "approve", "request_changes", "mark_posted", "reopen"]);

/**
 * Moves a post through review: submit → approve / request changes → mark posted, or reopen.
 * When approval is required, authors can't approve their own posts unless they're an owner or admin.
 * @return {!Promise<{postId: string, status: string}>} Result.
 */
export const transitionPrismPost = onCall(async (request) => {
  const c = await prismCaller(request.auth?.uid);
  const {ref, post, postId} = await loadPrismPost(c, request.data?.postId);
  const action = String(request.data?.action ?? "") as TransitionAction;
  if (!ACTIONS.has(action)) throw new HttpsError("invalid-argument", "Unknown action.");
  const comment = typeof request.data?.comment === "string" ? request.data.comment.trim().slice(0, 1000) : "";

  const strategy = await loadPrismBrandStrategy(c.agencyId);
  const approvalRequired = strategy?.approvalRequired !== false;
  const isLead = c.role === "agency_owner" || c.role === "agency_admin";
  const from = post.status;
  let to: PrismPostStatus;
  const update: Record<string, unknown> = {};
  if (withPublisher(post) && action !== "mark_posted") throw new HttpsError("failed-precondition", LOCKED_MESSAGE);
  if (stalePublish(post) && action !== "mark_posted") update.publish = FieldValue.delete();

  switch (action) {
  case "submit":
    if (!["idea", "draft", "changes_requested"].includes(from)) {
      throw new HttpsError("failed-precondition", "Only drafts can be sent for review.");
    }
    if (!hasAllVariants(post)) {
      throw new HttpsError("failed-precondition", "Write copy for every channel before sending for review.");
    }
    to = "in_review";
    break;
  case "approve": {
    const canSkipReview = !approvalRequired && ["idea", "draft", "changes_requested"].includes(from);
    if (from !== "in_review" && !canSkipReview) {
      throw new HttpsError("failed-precondition", "Send the post for review first.");
    }
    if (!hasAllVariants(post)) {
      throw new HttpsError("failed-precondition", "Every channel needs copy before approval.");
    }
    if (approvalRequired && post.createdBy === c.uid && !isLead) {
      throw new HttpsError("permission-denied", "Ask a teammate to approve your post.");
    }
    to = "approved";
    break;
  }
  case "request_changes":
    if (from !== "in_review") throw new HttpsError("failed-precondition", "Only posts in review can be sent back.");
    if (!comment) throw new HttpsError("invalid-argument", "Say what should change.");
    to = "changes_requested";
    break;
  case "mark_posted": {
    const ok = from === "approved" || (!approvalRequired && ["idea", "draft", "changes_requested"].includes(from));
    if (!ok) throw new HttpsError("failed-precondition", "Approve the post before marking it posted.");
    const urls = request.data?.postedUrls && typeof request.data.postedUrls === "object" ?
      (request.data.postedUrls as Record<string, unknown>) :
      {};
    const variants = {...post.variants};
    for (const [ch, url] of Object.entries(urls)) {
      if (!isPrismChannel(ch) || !variants[ch] || typeof url !== "string" || !url.trim()) continue;
      variants[ch] = {...variants[ch]!, postedUrl: url.trim().slice(0, 500)};
    }
    update.variants = variants;
    update.postedAt = FieldValue.serverTimestamp();
    to = "posted";
    break;
  }
  default:
    to = "draft";
  }

  const label: Record<TransitionAction, string> = {
    submit: "sent for review",
    approve: "approved",
    request_changes: "requested changes",
    mark_posted: "marked posted",
    reopen: "reopened",
  };
  await ref.update({
    ...update,
    status: to,
    history: appendHistory(post.history, prismEvent(c, label[action], comment || undefined)),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: c.uid,
  });

  if (action === "submit") {
    const team = (await agencyTeamUids(c.agencyId)).filter((id) => id !== c.uid);
    await notify(team, "Post ready for review", `${c.name} sent "${post.title}" for approval.`, postId);
  } else if ((action === "approve" || action === "request_changes") && post.createdBy !== c.uid) {
    await notify(
      [post.createdBy],
      action === "approve" ? "Post approved" : "Changes requested",
      action === "approve" ? `${c.name} approved "${post.title}".` : `${c.name}: ${comment}`,
      postId
    );
  }

  logger.info("[Prism] Post transition", {postId, from, to, uid: c.uid});
  return {postId, status: to};
});

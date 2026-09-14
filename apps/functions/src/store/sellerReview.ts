import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import sgMail from "@sendgrid/mail";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import * as params from "../config/params";
import type {
  StoreSellerReviewRequest,
  StoreSellerStatus,
  UserProfileFirestoreData,
} from "../types";

const REVIEW_COLLECTION = "storeSellerReviews";

export function hasConnectedSocial(user: UserProfileFirestoreData): boolean {
  return !!(
    user.instagramConnected ||
    user.youtubeConnected ||
    user.tiktokConnected
  );
}

export function normalizeStoreSellerStatus(
  status: unknown
): StoreSellerStatus {
  if (
    status === "pending_review" ||
    status === "approved" ||
    status === "rejected" ||
    status === "suspended" ||
    status === "none"
  ) {
    return status;
  }
  return "none";
}

/**
 * Whether the seller may receive Store checkouts.
 * Legacy sellers (never reviewed) stay sellable until suspended/rejected.
 */
export function canReceiveStoreCheckout(user: UserProfileFirestoreData): boolean {
  const status = normalizeStoreSellerStatus(user.storeSellerStatus);
  if (status === "suspended" || status === "rejected") return false;
  if (status === "approved") return true;
  // Legacy unset / pending with already-live catalog.
  return status === "none" || status === "pending_review";
}

/**
 * Enforce Connect + social + review before a product can become active.
 * Already-active products may keep updating unless suspended/rejected.
 * First save of a legacy active product auto-approves the seller.
 */
export async function assertCanPublishStoreProduct(
  creatorId: string,
  user: UserProfileFirestoreData,
  opts: {wasAlreadyActive: boolean}
): Promise<UserProfileFirestoreData> {
  if (!user.stripeAccountId || !user.stripePayoutsEnabled) {
    throw new HttpsError(
      "failed-precondition",
      "Connect payouts must be enabled in Settings before publishing a product."
    );
  }

  const status = normalizeStoreSellerStatus(user.storeSellerStatus);

  if (status === "suspended") {
    throw new HttpsError(
      "failed-precondition",
      "Your Store selling privileges are suspended. Contact support@tryverza.com."
    );
  }
  if (status === "rejected") {
    throw new HttpsError(
      "failed-precondition",
      user.storeSellerRejectReason?.trim()
        ? `Store application was not approved: ${user.storeSellerRejectReason.trim()}`
        : "Store application was not approved. Update your profile and resubmit for review."
    );
  }

  if (opts.wasAlreadyActive) {
    if (status === "none") {
      // Grandfather sellers who already had live products before the review gate.
      await db.collection("users").doc(creatorId).update({
        storeSellerStatus: "approved",
        storeSellerReviewedAt: FieldValue.serverTimestamp(),
        storeSellerReviewNote: "legacy_auto_approve",
      });
      await db.collection(REVIEW_COLLECTION).doc(creatorId).set(
        {
          uid: creatorId,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
          status: "approved",
          reviewedAt: FieldValue.serverTimestamp(),
          reviewedBy: "system",
          note: "legacy_auto_approve",
          updatedAt: FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
      return {...user, storeSellerStatus: "approved"};
    }
    return user;
  }

  if (status === "pending_review") {
    throw new HttpsError(
      "failed-precondition",
      "Your Store application is under review. You’ll be able to publish once it’s approved."
    );
  }
  if (status !== "approved") {
    throw new HttpsError(
      "failed-precondition",
      "Submit your Store for review before publishing. Connect payouts and at least one social account in Insights, then request review from the Store page."
    );
  }
  if (!hasConnectedSocial(user)) {
    throw new HttpsError(
      "failed-precondition",
      "Connect Instagram, YouTube, or TikTok in Insights before publishing."
    );
  }
  return user;
}

function reviewerEmailSet(): Set<string> {
  const raw = params.STORE_REVIEWER_EMAILS.value() || "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function assertStoreReviewer(uid: string): Promise<{email: string}> {
  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.data() as UserProfileFirestoreData | undefined;
  const email = (user?.email || "").trim().toLowerCase();
  if (!email || !reviewerEmailSet().has(email)) {
    throw new HttpsError(
      "permission-denied",
      "Only Verza Store reviewers can do that."
    );
  }
  return {email};
}

async function notifySupportOfStoreReview(payload: {
  uid: string;
  email: string | null;
  displayName: string | null;
}): Promise<void> {
  const sendgridKey = params.SENDGRID_API_KEY.value();
  if (!sendgridKey) {
    logger.warn("[store] SENDGRID_API_KEY missing; skip review notify email");
    return;
  }
  sgMail.setApiKey(sendgridKey);
  const appUrl = params.APP_URL.value().replace(/\/$/, "");
  const recipients = [...reviewerEmailSet()];
  if (recipients.length === 0) {
    recipients.push("support@tryverza.com");
  }
  try {
    await sgMail.send({
      to: recipients,
      from: {
        name: "Verza Store",
        email: params.SENDGRID_FROM_EMAIL.value() || "invoices@tryverza.com",
      },
      subject: `Store review: ${payload.displayName || payload.email || payload.uid}`,
      html: `
        <p>A creator submitted their Store for review.</p>
        <ul>
          <li><strong>Name:</strong> ${payload.displayName || "—"}</li>
          <li><strong>Email:</strong> ${payload.email || "—"}</li>
          <li><strong>UID:</strong> ${payload.uid}</li>
        </ul>
        <p><a href="${appUrl}/admin/store-reviews">Open Store reviews</a></p>
      `,
    });
  } catch (error) {
    logger.error("[store] Failed to email Store review notify", error);
  }
}

/**
 * Creator requests approval to sell (course / tip jar / link).
 */
export const submitStoreSellerReview = onCall(async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to submit for review.");
    }
    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.data() as UserProfileFirestoreData | undefined;
    if (!user) {
      throw new HttpsError("not-found", "User profile not found.");
    }
    if (user.role !== "individual_creator" && user.role !== "talent") {
      throw new HttpsError(
        "permission-denied",
        "Only creators can apply to sell in the Store."
      );
    }

    const status = normalizeStoreSellerStatus(user.storeSellerStatus);
    if (status === "approved") {
      return {success: true as const, status: "approved" as const};
    }
    if (status === "pending_review") {
      return {success: true as const, status: "pending_review" as const};
    }
    if (status === "suspended") {
      throw new HttpsError(
        "failed-precondition",
        "Your Store selling privileges are suspended. Contact support@tryverza.com."
      );
    }

    if (!user.stripeAccountId || !user.stripePayoutsEnabled) {
      throw new HttpsError(
        "failed-precondition",
        "Connect payouts in Settings before requesting Store review."
      );
    }
    if (!hasConnectedSocial(user)) {
      throw new HttpsError(
        "failed-precondition",
        "Connect at least one Instagram, YouTube, or TikTok account in Insights before requesting review."
      );
    }

    const note =
      typeof request.data?.note === "string"
        ? request.data.note.trim().slice(0, 500)
        : "";

    const reviewDoc: StoreSellerReviewRequest = {
      uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      status: "pending_review",
      stripeAccountId: user.stripeAccountId ?? null,
      stripePayoutsEnabled: !!user.stripePayoutsEnabled,
      hasConnectedSocial: true,
      instagramConnected: !!user.instagramConnected,
      youtubeConnected: !!user.youtubeConnected,
      tiktokConnected: !!user.tiktokConnected,
      submittedAt: FieldValue.serverTimestamp() as never,
      reviewedAt: null,
      reviewedBy: null,
      rejectReason: null,
      note: note || null,
      updatedAt: FieldValue.serverTimestamp() as never,
    };

    await db.collection(REVIEW_COLLECTION).doc(uid).set(reviewDoc, {merge: true});
    await db.collection("users").doc(uid).update({
      storeSellerStatus: "pending_review",
      storeSellerSubmittedAt: FieldValue.serverTimestamp(),
      storeSellerRejectReason: null,
      storeSellerReviewedAt: null,
      storeSellerReviewedBy: null,
      storeSellerReviewNote: note || null,
    });

    await notifySupportOfStoreReview({
      uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
    });

    logger.info("[store] Seller submitted for review", {uid});
    return {success: true as const, status: "pending_review" as const};
  }
);

/**
 * Staff approve / reject / suspend a Store seller.
 */
export const reviewStoreSeller = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const reviewer = await assertStoreReviewer(request.auth.uid);
  const {creatorId, decision, reason} = request.data as {
    creatorId?: unknown;
    decision?: unknown;
    reason?: unknown;
  };
  if (typeof creatorId !== "string" || !creatorId.trim()) {
    throw new HttpsError("invalid-argument", "creatorId is required.");
  }
  if (
    decision !== "approved" &&
    decision !== "rejected" &&
    decision !== "suspended"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "decision must be approved, rejected, or suspended."
    );
  }
  const rejectReason =
    typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (decision === "rejected" && !rejectReason) {
    throw new HttpsError(
      "invalid-argument",
      "A reason is required when rejecting."
    );
  }

  const uid = creatorId.trim();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "Creator not found.");
  }
  const user = userSnap.data() as UserProfileFirestoreData;

  await userRef.update({
    storeSellerStatus: decision,
    storeSellerReviewedAt: FieldValue.serverTimestamp(),
    storeSellerReviewedBy: reviewer.email,
    storeSellerRejectReason:
      decision === "rejected" || decision === "suspended" ? rejectReason : null,
    storeSellerReviewNote:
      decision === "approved" ? "manual_approve" : rejectReason || null,
  });

  await db.collection(REVIEW_COLLECTION).doc(uid).set(
    {
      uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      status: decision,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: reviewer.email,
      rejectReason:
        decision === "rejected" || decision === "suspended" ? rejectReason : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true}
  );

  if (decision === "suspended" || decision === "rejected") {
    const active = await db
      .collection("storeProducts")
      .where("creatorId", "==", uid)
      .where("status", "==", "active")
      .get();
    const batch = db.batch();
    active.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        status: "draft",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    if (!active.empty) {
      await batch.commit();
    }
  }

  logger.info("[store] Seller reviewed", {
    uid,
    decision,
    by: reviewer.email,
  });
  return {success: true as const, status: decision};
});

/**
 * Staff list pending (and recent) Store seller applications.
 */
export const listStoreSellerReviews = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  await assertStoreReviewer(request.auth.uid);
  const statusFilter =
    typeof request.data?.status === "string" ? request.data.status.trim() : "pending_review";

  let query = db.collection(REVIEW_COLLECTION).limit(80);
  if (
    statusFilter === "pending_review" ||
    statusFilter === "approved" ||
    statusFilter === "rejected" ||
    statusFilter === "suspended"
  ) {
    query = db
      .collection(REVIEW_COLLECTION)
      .where("status", "==", statusFilter)
      .limit(80);
  }

  const snap = await query.get();
  const toMs = (value: unknown): number => {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as {toMillis?: unknown}).toMillis === "function"
    ) {
      return (value as {toMillis: () => number}).toMillis();
    }
    return 0;
  };
  const reviews = snap.docs
    .map((d) => {
      const data = d.data() as StoreSellerReviewRequest;
      return {
        id: d.id,
        ...data,
        submittedAt: data.submittedAt ?? null,
        reviewedAt: data.reviewedAt ?? null,
        updatedAt: data.updatedAt ?? null,
      };
    })
    .sort((a, b) => toMs(b.submittedAt) - toMs(a.submittedAt));
  return {reviews};
});

/** Whether the signed-in user may review Store sellers (for UI gating). */
export const getStoreReviewerAccess = onCall(async (request) => {
  if (!request.auth) {
    return {isReviewer: false};
  }
  try {
    await assertStoreReviewer(request.auth.uid);
    return {isReviewer: true};
  } catch {
    return {isReviewer: false};
  }
});

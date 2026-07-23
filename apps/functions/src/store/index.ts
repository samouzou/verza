import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import * as params from "../config/params";
import type {
  StoreChapterContent,
  StoreChapterOutline,
  StoreLessonContent,
  StoreProduct,
  StoreProductContent,
  StoreProductKind,
  UserProfileFirestoreData,
} from "../types";
import {
  connectTransferMetadata,
  needsRecipientServiceAgreement,
  resolveLatestChargeId,
  transferToConnectAccountIfNeeded,
} from "../payments/stripeConnect";

/** Verza take rate on creator Store sales (Stripe card fees deducted separately). */
export const STORE_PLATFORM_FEE_FRACTION = 0.1;

const MIN_PRICE_CENTS = 100; // $1
const MAX_PRICE_CENTS = 10_000_00; // $10,000
const MAX_CHAPTERS = 40;
const MAX_CHAPTER_BODY = 20_000;

function getStripe(): Stripe {
  const stripeKey = params.STRIPE_SECRET_KEY.value();
  return new Stripe(stripeKey, {apiVersion: "2026-04-22.dahlia" as any});
}

function assertCreatorRole(role: string | undefined): void {
  if (role !== "individual_creator" && role !== "talent") {
    throw new HttpsError(
      "permission-denied",
      "Only creators can sell products in the Store."
    );
  }
}

function isHttpUrl(value: string): boolean {
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      // eslint-disable-next-line no-new
      new URL(value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function sanitizeOptionalUrl(
  value: unknown,
  fieldLabel: string
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${fieldLabel} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2000) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldLabel} must be under 2,000 characters.`
    );
  }
  if (
    (trimmed.startsWith("http://") || trimmed.startsWith("https://")) &&
    !isHttpUrl(trimmed)
  ) {
    throw new HttpsError("invalid-argument", `${fieldLabel} is not a valid URL.`);
  }
  return trimmed;
}

function isHtmlBodyEmpty(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !text;
}

function sanitizeChapters(
  raw: unknown,
  requireBodies = true
): StoreChapterContent[] {
  if (!Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "chapters must be an array.");
  }
  if (raw.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "Courses need at least one chapter."
    );
  }
  if (raw.length > MAX_CHAPTERS) {
    throw new HttpsError(
      "invalid-argument",
      `Courses support up to ${MAX_CHAPTERS} chapters.`
    );
  }

  return raw.map((item, index) => {
    const row = (item || {}) as Record<string, unknown>;
    const title =
      typeof row.title === "string" ? row.title.trim() : "";
    const summary =
      typeof row.summary === "string" ? row.summary.trim() : "";
    const body =
      typeof row.body === "string" ? row.body.trim() : "";
    const contentUrlRaw =
      typeof row.contentUrl === "string" ? row.contentUrl.trim() : "";
    const id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim().slice(0, 64)
        : `chapter_${index + 1}`;

    if (!title || title.length > 120) {
      throw new HttpsError(
        "invalid-argument",
        `Chapter ${index + 1}: title is required (max 120 characters).`
      );
    }
    if (summary.length > 500) {
      throw new HttpsError(
        "invalid-argument",
        `Chapter ${index + 1}: summary must be under 500 characters.`
      );
    }
    if (requireBodies) {
      if (!body || body.length > MAX_CHAPTER_BODY || isHtmlBodyEmpty(body)) {
        throw new HttpsError(
          "invalid-argument",
          `Chapter ${index + 1} (“${title || "untitled"}”): body is required before publishing (max ${MAX_CHAPTER_BODY} characters).`
        );
      }
    } else if (body.length > MAX_CHAPTER_BODY) {
      throw new HttpsError(
        "invalid-argument",
        `Chapter ${index + 1}: body must be under ${MAX_CHAPTER_BODY} characters.`
      );
    }
    let contentUrl: string | undefined;
    if (contentUrlRaw) {
      if (contentUrlRaw.length > 2000) {
        throw new HttpsError(
          "invalid-argument",
          `Chapter ${index + 1}: resource URL is too long.`
        );
      }
      if (
        (contentUrlRaw.startsWith("http://") ||
          contentUrlRaw.startsWith("https://")) &&
        !isHttpUrl(contentUrlRaw)
      ) {
        throw new HttpsError(
          "invalid-argument",
          `Chapter ${index + 1}: resource URL is not valid.`
        );
      }
      contentUrl = contentUrlRaw;
    }

    return {
      id,
      title,
      summary: summary || undefined,
      body,
      contentUrl,
      sortOrder: index,
    };
  });
}

/** Accept `chapters` or legacy `lessons` from older clients. */
function sanitizeCourseChapters(
  data: Record<string, unknown>,
  status: StoreProduct["status"]
): StoreChapterContent[] {
  const requireBodies = status === "active";
  if (Array.isArray(data.chapters) && data.chapters.length > 0) {
    return sanitizeChapters(data.chapters, requireBodies);
  }
  if (Array.isArray(data.lessons) && data.lessons.length > 0) {
    return sanitizeChapters(
      (data.lessons as Record<string, unknown>[]).map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        summary: lesson.summary,
        body:
          typeof lesson.body === "string" && lesson.body.trim()
            ? lesson.body
            : typeof lesson.summary === "string"
              ? lesson.summary
              : " ",
        contentUrl: lesson.contentUrl,
      })),
      requireBodies
    );
  }
  throw new HttpsError(
    "invalid-argument",
    "Courses need at least one chapter."
  );
}

function outlineFromChapters(
  chapters: StoreChapterContent[]
): StoreChapterOutline[] {
  return chapters.map((chapter) => {
    const row: StoreChapterOutline = {
      id: chapter.id,
      title: chapter.title,
    };
    if (chapter.summary) row.summary = chapter.summary;
    return row;
  });
}

/** Firestore rejects undefined — omit optional chapter fields. */
function chaptersForFirestore(chapters: StoreChapterContent[]) {
  return chapters.map((chapter) => {
    const row: StoreChapterContent = {
      id: chapter.id,
      title: chapter.title,
      body: chapter.body,
      sortOrder: chapter.sortOrder,
    };
    if (chapter.summary) row.summary = chapter.summary;
    if (chapter.contentUrl) row.contentUrl = chapter.contentUrl;
    return row;
  });
}

function legacyLessonsToChapters(
  lessons: StoreLessonContent[]
): StoreChapterContent[] {
  return lessons.map((lesson, index) => ({
    id: lesson.id,
    title: lesson.title,
    summary: lesson.summary,
    body: lesson.summary || "",
    contentUrl: lesson.contentUrl,
    sortOrder: lesson.sortOrder ?? index,
  }));
}

function courseChaptersFromContent(
  content: StoreProductContent | null
): StoreChapterContent[] {
  if (content?.chapters?.length) {
    return [...content.chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  if (content?.lessons?.length) {
    return legacyLessonsToChapters(content.lessons).sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
  }
  return [];
}

function sanitizeTipAmountsCents(
  raw: unknown,
  fallbackCents: number
): number[] {
  if (!Array.isArray(raw)) {
    return [fallbackCents];
  }
  const amounts = raw
    .map((value) => (typeof value === "number" ? Math.round(value) : Number.NaN))
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value >= MIN_PRICE_CENTS &&
        value <= MAX_PRICE_CENTS
    );
  const unique = [...new Set(amounts)].sort((a, b) => a - b);
  if (!unique.length) {
    return [fallbackCents];
  }
  if (unique.length > 6) {
    throw new HttpsError(
      "invalid-argument",
      "Tip jars support up to 6 preset amounts."
    );
  }
  return unique;
}

function parseProductKind(data: Record<string, unknown>): StoreProductKind {
  if (data.kind === "course") return "course";
  if (data.kind === "tip") return "tip";
  return "link";
}
function sanitizeProductInput(data: Record<string, unknown>): {
  title: string;
  description: string;
  priceCents: number;
  status: StoreProduct["status"];
  kind: StoreProductKind;
  coverImageUrl: string | null;
  accessUrl: string | null;
  chapters: StoreChapterContent[];
  tipAmountsCents: number[];
} {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  const priceCents =
    typeof data.priceCents === "number"
      ? Math.round(data.priceCents)
      : Number.NaN;
  const status =
    data.status === "draft" ||
    data.status === "active" ||
    data.status === "archived"
      ? data.status
      : "draft";
  const kind = parseProductKind(data);
  const coverImageUrl = sanitizeOptionalUrl(data.coverImageUrl, "Cover image");
  if (coverImageUrl && !isHttpUrl(coverImageUrl)) {
    throw new HttpsError(
      "invalid-argument",
      "Cover image must be an https URL."
    );
  }

  if (!title || title.length > 120) {
    throw new HttpsError(
      "invalid-argument",
      "Title is required (max 120 characters)."
    );
  }
  if (description.length > 2000) {
    throw new HttpsError(
      "invalid-argument",
      "Description must be under 2,000 characters."
    );
  }
  if (
    !Number.isFinite(priceCents) ||
    priceCents < MIN_PRICE_CENTS ||
    priceCents > MAX_PRICE_CENTS
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Price must be between $1 and $10,000."
    );
  }

  if (kind === "link") {
    const accessUrl = sanitizeOptionalUrl(data.accessUrl, "Access URL");
    if (!accessUrl) {
      throw new HttpsError(
        "invalid-argument",
        "Access URL / delivery link is required for link products."
      );
    }
    return {
      title,
      description,
      priceCents,
      status,
      kind,
      coverImageUrl,
      accessUrl,
      chapters: [],
      tipAmountsCents: [],
    };
  }

  if (kind === "tip") {
    const tipAmountsCents = sanitizeTipAmountsCents(
      data.tipAmountsCents,
      priceCents
    );
    return {
      title,
      description,
      priceCents: tipAmountsCents[0],
      status,
      kind,
      coverImageUrl,
      accessUrl: null,
      chapters: [],
      tipAmountsCents,
    };
  }

  const chapters = sanitizeCourseChapters(data, status);
  return {
    title,
    description,
    priceCents,
    status,
    kind,
    coverImageUrl,
    accessUrl: null,
    chapters,
    tipAmountsCents: [],
  };
}

async function loadPrivateContent(
  productId: string
): Promise<StoreProductContent | null> {
  const snap = await db.collection("storeProductContent").doc(productId).get();
  if (!snap.exists) return null;
  return snap.data() as StoreProductContent;
}

/** Draft saves may send empty bodies for chapters not currently open in the editor. */
async function preserveDraftChapterBodies(
  productId: string,
  incoming: StoreChapterContent[]
): Promise<StoreChapterContent[]> {
  const existing = await loadPrivateContent(productId);
  if (!existing?.chapters?.length) return incoming;
  const byId = new Map(existing.chapters.map((chapter) => [chapter.id, chapter]));
  return incoming.map((chapter) => {
    if (!isHtmlBodyEmpty(chapter.body)) return chapter;
    const prev = byId.get(chapter.id);
    if (prev?.body && !isHtmlBodyEmpty(prev.body)) {
      return {...chapter, body: prev.body};
    }
    return chapter;
  });
}

function resolveDelivery(
  product: StoreProduct,
  content: StoreProductContent | null
): {
  kind: StoreProductKind;
  accessUrl: string | null;
  chapters: StoreChapterContent[];
} {
  const kind = content?.kind || product.kind || "link";
  if (kind === "course") {
    const chapters = courseChaptersFromContent(content);
    return {kind, accessUrl: null, chapters};
  }
  if (kind === "tip") {
    return {kind: "tip", accessUrl: null, chapters: []};
  }
  const accessUrl =
    content?.accessUrl || product.accessUrl || null;
  return {kind: "link", accessUrl, chapters: []};
}

/**
 * Create or update a Store product. Publishing (active) requires Connect payouts.
 * Paid delivery is written to storeProductContent (not world-readable).
 */
export const upsertStoreProduct = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to manage your Store.");
  }

  const creatorId = request.auth.uid;
  const userSnap = await db.collection("users").doc(creatorId).get();
  const userData = userSnap.data() as UserProfileFirestoreData | undefined;
  if (!userData) {
    throw new HttpsError("not-found", "User profile not found.");
  }
  assertCreatorRole(userData.role);

  const {productId, ...raw} = request.data as {
    productId?: string;
  } & Record<string, unknown>;

  const fields = sanitizeProductInput(raw);

  if (fields.status === "active") {
    if (!userData.stripeAccountId || !userData.stripePayoutsEnabled) {
      throw new HttpsError(
        "failed-precondition",
        "Connect payouts must be enabled in Settings before publishing a product."
      );
    }
  }

  const now = FieldValue.serverTimestamp();
  let courseChapters = fields.chapters;
  if (
    productId &&
    typeof productId === "string" &&
    fields.kind === "course" &&
    fields.status !== "active"
  ) {
    courseChapters = await preserveDraftChapterBodies(productId, fields.chapters);
  }

  const chapterOutline =
    fields.kind === "course" ? outlineFromChapters(courseChapters) : [];

  const publicFields = {
    title: fields.title,
    description: fields.description,
    priceCents: fields.priceCents,
    kind: fields.kind,
    coverImageUrl: fields.coverImageUrl,
    chapterOutline,
    lessonOutline: FieldValue.delete(),
    status: fields.status,
    creatorDisplayName: userData.displayName || null,
    creatorAvatarUrl: userData.avatarUrl || null,
    updatedAt: now,
    // Stop exposing paid URLs on the public product doc.
    accessUrl: FieldValue.delete(),
    ...(fields.kind === "tip"
      ? {tipAmountsCents: fields.tipAmountsCents}
      : {tipAmountsCents: FieldValue.delete()}),
  };

  const writeContent = async (id: string, chapters: StoreChapterContent[]) => {
    await db.collection("storeProductContent").doc(id).set(
      {
        productId: id,
        creatorId,
        kind: fields.kind,
        accessUrl: fields.kind === "link" ? fields.accessUrl : null,
        chapters:
          fields.kind === "course" ? chaptersForFirestore(chapters) : [],
        lessons: FieldValue.delete(),
        updatedAt: now,
      },
      {merge: true}
    );
  };

  if (productId && typeof productId === "string") {
    const ref = db.collection("storeProducts").doc(productId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Product not found.");
    }
    const existing = snap.data() as StoreProduct;
    if (existing.creatorId !== creatorId) {
      throw new HttpsError("permission-denied", "Not your product.");
    }
    await ref.update(publicFields);
    await writeContent(productId, courseChapters);
    return {id: productId};
  }

  const ref = db.collection("storeProducts").doc();
  await ref.set({
    creatorId,
    creatorDisplayName: userData.displayName || null,
    creatorAvatarUrl: userData.avatarUrl || null,
    title: fields.title,
    description: fields.description,
    priceCents: fields.priceCents,
    currency: "usd",
    kind: fields.kind,
    ...(fields.kind === "tip"
      ? {tipAmountsCents: fields.tipAmountsCents}
      : {}),
    coverImageUrl: fields.coverImageUrl,
    chapterOutline,
    status: fields.status,
    salesCount: 0,
    revenueCents: 0,
    createdAt: now,
    updatedAt: now,
  });
  await writeContent(ref.id, courseChapters);
  return {id: ref.id};
});

type ManageStoreProductAction = "archive" | "restore" | "delete";

/**
 * Archive, restore to draft, or permanently delete a Store product.
 * Delete is only allowed when the product has no sales (buyers keep access via purchases).
 */
export const manageStoreProduct = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to manage your Store.");
  }

  const creatorId = request.auth.uid;
  const userSnap = await db.collection("users").doc(creatorId).get();
  const userData = userSnap.data() as UserProfileFirestoreData | undefined;
  if (!userData) {
    throw new HttpsError("not-found", "User profile not found.");
  }
  assertCreatorRole(userData.role);

  const productId =
    typeof request.data?.productId === "string" ? request.data.productId.trim() : "";
  const action = request.data?.action as ManageStoreProductAction;

  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }
  if (action !== "archive" && action !== "restore" && action !== "delete") {
    throw new HttpsError(
      "invalid-argument",
      "action must be archive, restore, or delete."
    );
  }

  const ref = db.collection("storeProducts").doc(productId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }
  const product = {id: snap.id, ...snap.data()} as StoreProduct;
  if (product.creatorId !== creatorId) {
    throw new HttpsError("permission-denied", "Not your product.");
  }

  const now = FieldValue.serverTimestamp();

  if (action === "archive") {
    if (product.status === "archived") {
      return {id: productId, status: "archived" as const};
    }
    await ref.update({status: "archived", updatedAt: now});
    logger.info("[store] Product archived", {productId, creatorId});
    return {id: productId, status: "archived" as const};
  }

  if (action === "restore") {
    if (product.status !== "archived") {
      throw new HttpsError(
        "failed-precondition",
        "Only archived products can be restored."
      );
    }
    await ref.update({status: "draft", updatedAt: now});
    logger.info("[store] Product restored to draft", {productId, creatorId});
    return {id: productId, status: "draft" as const};
  }

  const salesCount = product.salesCount || 0;
  if (salesCount > 0) {
    throw new HttpsError(
      "failed-precondition",
      "Products with sales cannot be deleted. Archive the product instead — buyers keep access."
    );
  }

  const contentRef = db.collection("storeProductContent").doc(productId);
  const batch = db.batch();
  batch.delete(ref);
  batch.delete(contentRef);
  await batch.commit();
  logger.info("[store] Product deleted", {productId, creatorId});
  return {id: productId, deleted: true as const};
});

/**
 * Creator-only: load private delivery content for editing.
 */
export const getStoreProductContent = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const productId =
    typeof request.data?.productId === "string" ? request.data.productId : "";
  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }

  const productSnap = await db.collection("storeProducts").doc(productId).get();
  if (!productSnap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }
  const product = productSnap.data() as StoreProduct;
  if (product.creatorId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Not your product.");
  }

  const content = await loadPrivateContent(productId);
  const resolved = resolveDelivery(product, content);
  return {
    kind: resolved.kind,
    accessUrl: resolved.accessUrl,
    chapters: resolved.chapters,
    // Legacy field for older store UI builds
    lessons: resolved.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      contentUrl: chapter.contentUrl || "",
      sortOrder: chapter.sortOrder,
      body: chapter.body,
    })),
  };
});

/**
 * Buyer unlocks paid content with the email used at checkout.
 */
export const getStoreAccess = onCall({
  enforceAppCheck: false,
  cors: true,
}, async (request) => {
  const productId =
    typeof request.data?.productId === "string" ? request.data.productId : "";
  const buyerEmail =
    typeof request.data?.buyerEmail === "string"
      ? request.data.buyerEmail.trim().toLowerCase()
      : "";

  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw new HttpsError("invalid-argument", "A valid buyer email is required.");
  }

  const purchaseSnap = await db
    .collection("storePurchases")
    .where("productId", "==", productId)
    .where("buyerEmail", "==", buyerEmail)
    .where("status", "==", "paid")
    .limit(1)
    .get();

  if (purchaseSnap.empty) {
    throw new HttpsError(
      "permission-denied",
      "No purchase found for that email on this product."
    );
  }

  const productSnap = await db.collection("storeProducts").doc(productId).get();
  if (!productSnap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }
  const product = {id: productSnap.id, ...productSnap.data()} as StoreProduct;
  const content = await loadPrivateContent(productId);
  const delivery = resolveDelivery(product, content);

  if (delivery.kind === "course") {
    if (!delivery.chapters.length) {
      throw new HttpsError(
        "failed-precondition",
        "Course content is not available yet. Contact the creator."
      );
    }
    return {
      kind: "course" as const,
      productTitle: product.title,
      productDescription: product.description || null,
      coverImageUrl: product.coverImageUrl || null,
      chapters: delivery.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        summary: chapter.summary || null,
        body: chapter.body,
        contentUrl: chapter.contentUrl || null,
        sortOrder: chapter.sortOrder,
      })),
    };
  }

  if (delivery.kind === "tip") {
    return {
      kind: "tip" as const,
      productTitle: product.title,
      creatorDisplayName: product.creatorDisplayName || null,
    };
  }

  if (!delivery.accessUrl) {
    throw new HttpsError(
      "failed-precondition",
      "Access link is not available yet. Contact the creator."
    );
  }

  return {
    kind: "link" as const,
    productTitle: product.title,
    accessUrl: delivery.accessUrl,
  };
});

/**
 * Public Checkout for a Store product. Buyer does not need a Verza account.
 */
export const createStoreCheckoutSession = onCall({
  enforceAppCheck: false,
  cors: true,
}, async (request) => {
  const productId =
    typeof request.data?.productId === "string" ? request.data.productId : "";
  const buyerEmail =
    typeof request.data?.buyerEmail === "string"
      ? request.data.buyerEmail.trim().toLowerCase()
      : "";

  if (!productId) {
    throw new HttpsError("invalid-argument", "productId is required.");
  }
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    throw new HttpsError("invalid-argument", "A valid buyer email is required.");
  }

  const productSnap = await db.collection("storeProducts").doc(productId).get();
  if (!productSnap.exists) {
    throw new HttpsError("not-found", "Product not found.");
  }
  const product = {id: productSnap.id, ...productSnap.data()} as StoreProduct;
  if (product.status !== "active") {
    throw new HttpsError("failed-precondition", "This product is not for sale.");
  }

  const creatorSnap = await db.collection("users").doc(product.creatorId).get();
  const creator = creatorSnap.data() as UserProfileFirestoreData | undefined;
  if (!creator?.stripeAccountId || !creator.stripePayoutsEnabled) {
    throw new HttpsError(
      "failed-precondition",
      "This creator cannot receive Store payments right now."
    );
  }

  const productKind = product.kind || "link";
  const tipAmounts =
    product.tipAmountsCents?.length ? product.tipAmountsCents : [product.priceCents];
  let amountCents = product.priceCents;
  if (productKind === "tip") {
    const requested =
      typeof request.data?.amountCents === "number"
        ? Math.round(request.data.amountCents)
        : tipAmounts[0];
    if (
      !Number.isFinite(requested) ||
      requested < MIN_PRICE_CENTS ||
      requested > MAX_PRICE_CENTS
    ) {
      throw new HttpsError(
        "invalid-argument",
        `Tip must be between $${MIN_PRICE_CENTS / 100} and $${MAX_PRICE_CENTS / 100}.`
      );
    }
    amountCents = requested;
  }
  const platformFee = Math.round(amountCents * STORE_PLATFORM_FEE_FRACTION);
  const stripeFee = Math.round(amountCents * 0.029) + 30;
  const totalFee = platformFee + stripeFee;
  const creatorNet = Math.max(0, amountCents - totalFee);

  if (creatorNet <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Product price is too low to cover fees."
    );
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (e) {
    logger.error("Stripe not configured", e);
    throw new HttpsError("failed-precondition", "Payments are not configured.");
  }

  const appUrl = params.APP_URL.value();
  const creatorName = creator.displayName || "Creator";
  const productImages =
    product.coverImageUrl && isHttpUrl(product.coverImageUrl)
      ? [product.coverImageUrl]
      : undefined;

  const creatorCountry = creator.country || "US";
  const useDestinationCharge = !needsRecipientServiceAgreement(creatorCountry);
  const storePayoutMode = useDestinationCharge ? "destination" : "transfer";
  const saleMetadata = {
    purchaseType: "storeSale",
    productId,
    creatorId: product.creatorId,
    buyerEmail,
    amountCents: String(amountCents),
    platformFeeCents: String(totalFee),
    creatorNetCents: String(creatorNet),
    storePayoutMode,
    ...(useDestinationCharge
      ? {}
      : connectTransferMetadata(creator.stripeAccountId, creatorNet)),
  };

  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData =
    {
      metadata: saleMetadata,
      ...(useDestinationCharge
        ? {
            application_fee_amount: totalFee,
            transfer_data: {destination: creator.stripeAccountId},
          }
        : {}),
    };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: buyerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: product.currency || "usd",
            unit_amount: amountCents,
            product_data: {
              name: product.title,
              description:
                product.description?.slice(0, 400) ||
                `Purchase from ${creatorName} on Verza Store`,
              ...(productImages ? {images: productImages} : {}),
            },
          },
        },
      ],
      success_url:
        `${appUrl}/s/${productId}/access?purchase=success&email=` +
        encodeURIComponent(buyerEmail),
      cancel_url: `${appUrl}/s/${productId}?purchase=cancelled`,
      payment_intent_data: paymentIntentData,
      metadata: saleMetadata,
    });

    if (!session.url) {
      throw new HttpsError("internal", "Checkout session missing URL.");
    }
    return {url: session.url};
  } catch (error: any) {
    logger.error("createStoreCheckoutSession failed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error?.message || "Could not start checkout."
    );
  }
});

/**
 * Fulfill a paid Store sale from Stripe payment_intent.succeeded metadata.
 * Idempotent on paymentIntentId.
 */
export async function fulfillStoreSale(
  stripe: Stripe,
  metadata: Stripe.Metadata | Record<string, string>,
  paymentIntentId: string,
  latestChargeId: string | undefined
): Promise<void> {
  const productId = metadata.productId;
  const creatorId = metadata.creatorId;
  const buyerEmail = metadata.buyerEmail;
  if (!productId || !creatorId || !buyerEmail) {
    logger.warn("storeSale metadata incomplete", {paymentIntentId, metadata});
    return;
  }

  const existing = await db
    .collection("storePurchases")
    .where("paymentIntentId", "==", paymentIntentId)
    .limit(1)
    .get();
  if (!existing.empty) {
    logger.info(`Store sale already fulfilled for ${paymentIntentId}`);
    return;
  }

  if (metadata.storePayoutMode !== "destination") {
    await transferToConnectAccountIfNeeded(
      stripe,
      metadata,
      await resolveLatestChargeId(stripe, paymentIntentId, latestChargeId)
    );
  }

  const productRef = db.collection("storeProducts").doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    logger.error(`Store product ${productId} missing after payment ${paymentIntentId}`);
    return;
  }
  const product = productSnap.data() as StoreProduct;
  const content = await loadPrivateContent(productId);
  const delivery = resolveDelivery(product, content);

  const amountCents =
    parseInt(metadata.amountCents || "0", 10) || product.priceCents;
  const platformFeeCents = parseInt(metadata.platformFeeCents || "0", 10) || 0;
  const creatorNetCents =
    parseInt(metadata.creatorNetCents || "0", 10) ||
    Math.max(0, amountCents - platformFeeCents);

  const appUrl = params.APP_URL.value();
  const accessPageUrl =
    `${appUrl}/s/${productId}/access?email=` +
    encodeURIComponent(buyerEmail);

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(productRef);
    if (!fresh.exists) throw new Error("Product vanished during fulfill");
    tx.update(productRef, {
      salesCount: FieldValue.increment(1),
      revenueCents: FieldValue.increment(creatorNetCents),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const purchaseRef = db.collection("storePurchases").doc();
    tx.set(purchaseRef, {
      productId,
      productTitle: product.title,
      creatorId,
      buyerEmail,
      amountCents,
      platformFeeCents,
      creatorNetCents,
      paymentIntentId,
      kind: delivery.kind,
      accessUrl: delivery.kind === "link" ? delivery.accessUrl : null,
      status: "paid",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info(
    `Store sale fulfilled: product=${productId} creator=${creatorId} pi=${paymentIntentId}`
  );

  // Best-effort delivery email
  try {
    const sendgridKey = params.SENDGRID_API_KEY.value();
    if (!sendgridKey) return;
    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(sendgridKey);
    const creatorSnap = await db.collection("users").doc(creatorId).get();
    const creatorName =
      (creatorSnap.data() as UserProfileFirestoreData | undefined)?.displayName ||
      "your creator";

    const isCourse = delivery.kind === "course";
    const isTip = delivery.kind === "tip";
    const bodyHtml = isCourse
      ? `
        <p>Thanks for buying <strong>${product.title}</strong> from ${creatorName}.</p>
        <p>Your course is ready. Open it with the email you used at checkout:</p>
        <p><a href="${accessPageUrl}">Open your course</a></p>
        <p style="color:#718096;font-size:12px;">Powered by Verza Store</p>
      `
      : isTip
        ? `
        <p>Thanks for supporting <strong>${creatorName}</strong> with a tip!</p>
        <p>Your generosity means a lot. You can view your receipt anytime:</p>
        <p><a href="${accessPageUrl}">View your tip</a></p>
        <p style="color:#718096;font-size:12px;">Powered by Verza Store</p>
      `
        : `
        <p>Thanks for buying <strong>${product.title}</strong> from ${creatorName}.</p>
        <p>Your access link:</p>
        <p><a href="${delivery.accessUrl || accessPageUrl}">${
  delivery.accessUrl || accessPageUrl
}</a></p>
        <p>You can also reopen it anytime: <a href="${accessPageUrl}">View purchase</a></p>
        <p style="color:#718096;font-size:12px;">Powered by Verza Store</p>
      `;

    await sgMail.send({
      to: buyerEmail,
      from: {
        name: "Verza Store",
        email: params.SENDGRID_FROM_EMAIL.value() || "invoices@tryverza.com",
      },
      subject: `Your purchase: ${product.title}`,
      html: bodyHtml,
    });
  } catch (emailErr) {
    logger.warn("Store purchase delivery email failed", emailErr);
  }
}

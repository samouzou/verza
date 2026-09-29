import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import type {BrandGuide, BrandProduct, Gig} from "../types";
import {setPublicBrandKitFlag} from "../gigs/publicCampaigns";

export function brandKitRef(agencyId: string) {
  return db.collection("agencies").doc(agencyId).collection("private").doc("brandKit");
}

function accessRef(agencyId: string, uid: string) {
  return db.collection("agencies").doc(agencyId).collection("brandKitAccess").doc(uid);
}

function hasGuideContent(guide: unknown): boolean {
  return !!guide && typeof guide === "object" && Object.keys(guide as object).length > 0;
}

/** Everyone a campaign unlocks the kit for: accepted creators and assigned agents. */
function unlockedUids(gig: Partial<Gig> | null | undefined): Set<string> {
  const uids = new Set<string>();
  if (!gig) return uids;
  for (const id of gig.acceptedCreatorIds ?? []) if (id) uids.add(id);
  for (const id of gig.agentIds ?? []) if (id) uids.add(id);
  for (const a of Object.values(gig.assignments ?? {})) {
    const agentId = (a as {agentId?: string})?.agentId;
    if (agentId) uids.add(agentId);
  }
  return uids;
}

async function grantAccess(agencyId: string, gigId: string, uids: Iterable<string>): Promise<void> {
  const batch = db.batch();
  let n = 0;
  for (const uid of uids) {
    batch.set(accessRef(agencyId, uid), {
      gigIds: FieldValue.arrayUnion(gigId),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    n++;
  }
  if (n) await batch.commit();
}

async function revokeAccess(agencyId: string, gigId: string, uids: Iterable<string>): Promise<void> {
  for (const uid of uids) {
    const ref = accessRef(agencyId, uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const remaining = ((snap.data()?.gigIds as string[] | undefined) ?? []).filter((id) => id !== gigId);
      if (remaining.length === 0) tx.delete(ref);
      else tx.update(ref, {gigIds: remaining, updatedAt: FieldValue.serverTimestamp()});
    });
  }
}

export const syncBrandKitAccess = onDocumentWritten("gigs/{gigId}", async (event) => {
  const gigId = event.params.gigId;
  const before = event.data?.before?.exists ? (event.data.before.data() as Gig) : null;
  const after = event.data?.after?.exists ? (event.data.after.data() as Gig) : null;
  const brandId = after?.brandId || before?.brandId;
  if (!brandId) return;

  const prev = unlockedUids(before);
  const next = unlockedUids(after);
  const added = [...next].filter((uid) => !prev.has(uid));
  const removed = [...prev].filter((uid) => !next.has(uid));
  try {
    if (added.length) await grantAccess(brandId, gigId, added);
    if (removed.length) await revokeAccess(brandId, gigId, removed);
  } catch (err) {
    logger.error("syncBrandKitAccess failed", {gigId, brandId, err});
  }
});

/** Moves a legacy `brandGuide` / `products` off the agency doc (readable by any signed-in user). */
async function migrateLegacyKit(agencyId: string, data: FirebaseFirestore.DocumentData): Promise<boolean> {
  const legacyGuide = data.brandGuide as BrandGuide | undefined;
  const legacyProducts = data.products as BrandProduct[] | undefined;
  if (legacyGuide === undefined && legacyProducts === undefined) return false;

  const kitRef = brandKitRef(agencyId);
  const agencyRef = db.collection("agencies").doc(agencyId);
  await db.runTransaction(async (tx) => {
    const kitSnap = await tx.get(kitRef);
    const kit = kitSnap.exists ? kitSnap.data()! : {};
    // Rules block client writes of these agency fields, so legacy values predate the kit: never overwrite it.
    const patch: Record<string, unknown> = {};
    if (legacyGuide !== undefined && !hasGuideContent(kit.brandGuide)) patch.brandGuide = legacyGuide;
    if (legacyProducts !== undefined && !Array.isArray(kit.products)) patch.products = legacyProducts;
    if (Object.keys(patch).length) {
      tx.set(kitRef, {...patch, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    }
    tx.update(agencyRef, {
      brandGuide: FieldValue.delete(),
      products: FieldValue.delete(),
      hasBrandKit: hasGuideContent(kit.brandGuide) || hasGuideContent(legacyGuide),
    });
  });
  return true;
}

export const migrateAgencyBrandKit = onDocumentWritten("agencies/{agencyId}", async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  try {
    await migrateLegacyKit(event.params.agencyId, after.data()!);
  } catch (err) {
    logger.error("migrateAgencyBrandKit failed", {agencyId: event.params.agencyId, err});
  }
});

/** Keeps `agencies/{id}.hasBrandKit` in step so the locked teaser knows whether a kit exists. */
export const onBrandKitWritten = onDocumentWritten("agencies/{agencyId}/private/brandKit", async (event) => {
  const agencyId = event.params.agencyId;
  const after = event.data?.after;
  const hasKit = !!after?.exists && hasGuideContent(after.data()?.brandGuide);
  const agencyRef = db.collection("agencies").doc(agencyId);
  const agencySnap = await agencyRef.get();
  if (!agencySnap.exists || agencySnap.data()?.hasBrandKit === hasKit) return;
  await agencyRef.update({hasBrandKit: hasKit});
  await setPublicBrandKitFlag(agencyId, hasKit);
});

/** Daily: migrates any remaining legacy kits and backfills access for existing acceptances. */
export const reconcileBrandKits = onSchedule("every 24 hours", async () => {
  let migrated = 0;
  const agencies = await db.collection("agencies").select("brandGuide", "products").get();
  for (const doc of agencies.docs) {
    try {
      if (await migrateLegacyKit(doc.id, doc.data())) migrated++;
    } catch (err) {
      logger.error("reconcileBrandKits migrate failed", {agencyId: doc.id, err});
    }
  }

  let granted = 0;
  const gigs = await db.collection("gigs").select("brandId", "acceptedCreatorIds", "agentIds", "assignments").get();
  for (const doc of gigs.docs) {
    const gig = doc.data() as Partial<Gig>;
    const uids = unlockedUids(gig);
    if (!gig.brandId || uids.size === 0) continue;
    try {
      await grantAccess(gig.brandId, doc.id, uids);
      granted += uids.size;
    } catch (err) {
      logger.error("reconcileBrandKits grant failed", {gigId: doc.id, err});
    }
  }
  logger.info("reconcileBrandKits done", {migrated, granted, agencies: agencies.size, gigs: gigs.size});
});

/** Server-side mission statement lookup with a fallback for agencies not yet migrated. */
export async function loadBrandMission(agencyId: string, agencyData?: FirebaseFirestore.DocumentData): Promise<string> {
  const kitSnap = await brandKitRef(agencyId).get();
  const guide = (kitSnap.data()?.brandGuide ?? agencyData?.brandGuide) as {missionStatement?: string} | undefined;
  return typeof guide?.missionStatement === "string" ? guide.missionStatement.trim() : "";
}

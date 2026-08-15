import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {loadAgencyOpticBilling, requestLowCreditCheck, requestPilotTopUp} from "./billing";
import {loadExistingProfileUrlKeys, normalizeProfileUrl} from "./dedup";
import {saveLeadWithOpticCreditCharge} from "./credits";
import {urlPoolCap, vetDelayMs, workerSaveTarget} from "./limits";
import {Log} from "./logCopy";
import {generateSeedLeads, findCreators} from "./search";
import {persistOpticAvatarFromUrl} from "./avatar";
import {composeMatchScore} from "./matchScore";
import {createVetBrowserContext, scrapeCreatorProfileInContext} from "./scraper";
import {analyzeProfileWithGemini, type DraftBrandContext} from "./vision";

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log(`[optic-worker] Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type JobDoc = {
  status: string;
  agencyId: string;
  agencyName: string;
  platform: string;
  objectives: string;
  maxProfiles: number;
  brandContext: DraftBrandContext | null;
  audienceTier?: string | null;
  campaignId?: string | null;
  cancelRequested?: boolean;
};

export async function runDiscoveryJob(jobId: string): Promise<void> {
  const ref = db.collection("optic_jobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Job not found");
  }
  const job = snap.data() as JobDoc;
  if (job.status !== "queued") {
    console.log("[Optic worker] Skip job not in queued state:", jobId, job.status);
    return;
  }

  const targetSaved = workerSaveTarget(job.maxProfiles);
  const delayMs = vetDelayMs(targetSaved);

  await ref.update({
    status: "running",
    updatedAt: FieldValue.serverTimestamp(),
    workerStartedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "worker",
      message: Log.scoutStarted(),
    }),
  });

  const appendLog = async (phase: string, message: string) => {
    await ref.update({
      logs: FieldValue.arrayUnion({ts: Timestamp.now(), phase, message}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  };

  const brand = job.brandContext ?? undefined;

  try {
    if (job.maxProfiles > targetSaved) {
      await appendLog(
        "worker",
        `Requested ${job.maxProfiles} creators — vetting ${targetSaved} this run. Continue the mission for more.`
      );
    }
    const allUrls = new Set<string>();
    await appendLog("search", Log.shortlist());
    const seedLeads = await generateSeedLeads(
      job.platform,
      job.objectives,
      brand?.agencyName ?? null,
      targetSaved
    );
    seedLeads.forEach((lead) => allUrls.add(lead.url));

    let s0 = await ref.get();
    if (s0.data()?.cancelRequested) {
      await ref.update({
        status: "cancelled",
        updatedAt: FieldValue.serverTimestamp(),
        workerCompletedAt: FieldValue.serverTimestamp(),
        logs: FieldValue.arrayUnion({
          ts: Timestamp.now(),
          phase: "done",
          message: Log.jobCancelled(),
        }),
      });
      return;
    }

    await appendLog("search", Log.platformSearch(job.platform));
    const searchedUrls = await findCreators(job.platform, job.objectives, targetSaved);
    searchedUrls.forEach((url) => allUrls.add(url));

    if (allUrls.size === 0) {
      throw new Error("No creators found for the given criteria.");
    }

    const poolMax = urlPoolCap(targetSaved);
    const urlList = Array.from(allUrls).sort();
    const campaignId = job.campaignId?.trim() || null;
    const knownUrls = await loadExistingProfileUrlKeys(db, job.agencyId, campaignId);
    const freshUrls = urlList.filter((u) => !knownUrls.has(normalizeProfileUrl(u)));
    const skippedKnown = urlList.length - freshUrls.length;
    if (skippedKnown > 0) {
      await appendLog("search", Log.skippingKnown(skippedKnown));
    }
    const queue = freshUrls.slice(0, Math.min(poolMax, freshUrls.length));

    const vetContext = await createVetBrowserContext();
    let processed = 0;
    let billing = await loadAgencyOpticBilling(db, job.agencyId);

    try {
      for (let i = 0; i < queue.length && processed < targetSaved; i++) {
        const s = await ref.get();
        if (s.data()?.cancelRequested) {
          await appendLog("vet", Log.cancelled());
          break;
        }
        const url = queue[i];
        if (knownUrls.has(normalizeProfileUrl(url))) {
          await appendLog("vet", Log.alreadyKnown(url));
          continue;
        }
        await appendLog("vet", Log.vetVisit(url));
        try {
          const capture = await scrapeCreatorProfileInContext(vetContext, url);
          const leadData = await analyzeProfileWithGemini(
            capture.screenshotBase64,
            job.objectives,
            brand ?? null,
            job.platform
          );
          const payTitle = job.brandContext?.paySourceCampaignTitle?.trim() || null;
          const match = composeMatchScore({
            briefFitScore: leadData.briefFitScore ?? 65,
            matchReason: leadData.matchReason,
            followerCount: leadData.followerCount,
            email: leadData.email,
            audienceTier: job.audienceTier ?? "any",
          });
          const avatarUrl = await persistOpticAvatarFromUrl({
            agencyId: job.agencyId,
            profileUrl: url,
            avatarSourceUrl: capture.avatarSourceUrl,
          });
          const {
            briefFitScore: _briefFit,
            matchReason: _reason,
            ...enrichmentFields
          } = leadData;
          const leadPayload = {
            ...enrichmentFields,
            matchScore: match.matchScore,
            matchReason: match.matchReason,
            matchBreakdown: match.matchBreakdown,
            followerCountNumeric: match.followerCountNumeric,
            avatarUrl: avatarUrl ?? null,
            discoveryPlatform: job.platform,
            profileUrl: url,
            createdAt: FieldValue.serverTimestamp(),
            source: "Verza Optic (web worker)",
            agencyId: job.agencyId,
            agencyName: job.agencyName,
            campaignId: job.campaignId ?? null,
            campaignTitle: payTitle,
          };

          let saveResult = await saveLeadWithOpticCreditCharge({
            db,
            jobId,
            agencyId: job.agencyId,
            profileUrl: url,
            leadData: leadPayload,
            billing,
          });

          if (!saveResult.ok && saveResult.reason === "needs_top_up") {
            const topUp = await requestPilotTopUp(job.agencyId);
            if (topUp.ok) {
              billing = await loadAgencyOpticBilling(db, job.agencyId);
              await appendLog("vet", Log.topUpApplied());
              saveResult = await saveLeadWithOpticCreditCharge({
                db,
                jobId,
                agencyId: job.agencyId,
                profileUrl: url,
                leadData: leadPayload,
                billing,
              });
            } else {
              await appendLog("vet", Log.topUpFailed(topUp.reason));
            }
          }

          if (!saveResult.ok) {
            await appendLog("vet", Log.insufficientCredits());
            break;
          }
          if (saveResult.charged) {
            void requestLowCreditCheck(job.agencyId);
          }
          processed++;
          knownUrls.add(normalizeProfileUrl(url));
          await ref.update({processedCount: processed, updatedAt: FieldValue.serverTimestamp()});
          await appendLog("vet", Log.saved(leadData.creatorName || "Creator"));
        } catch {
          await appendLog("vet", Log.skip(url));
        }
        if (i < queue.length - 1 && processed < targetSaved && delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    } finally {
      await vetContext.close().catch(() => {});
    }

    const finalSnap = await ref.get();
    const cancelled = Boolean(finalSnap.data()?.cancelRequested);
    await ref.update({
      status: cancelled ? "cancelled" : "completed",
      updatedAt: FieldValue.serverTimestamp(),
      workerCompletedAt: FieldValue.serverTimestamp(),
      processedCount: processed,
      logs: FieldValue.arrayUnion({
        ts: Timestamp.now(),
        phase: "done",
        message: cancelled ? Log.jobCancelled() : Log.done(processed, targetSaved),
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ref.update({
      status: "failed",
      error: msg.slice(0, 2000),
      updatedAt: FieldValue.serverTimestamp(),
      workerCompletedAt: FieldValue.serverTimestamp(),
      logs: FieldValue.arrayUnion({
        ts: Timestamp.now(),
        phase: "error",
        message: msg.slice(0, 500),
      }),
    });
    throw e;
  }
}

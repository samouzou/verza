import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {OPTIC_MAX_SAVED_PER_RUN, urlPoolCap, vetDelayMs} from "./limits";
import {Log} from "./logCopy";
import {generateSeedLeads, findCreators} from "./search";
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

  const targetSaved = Math.min(OPTIC_MAX_SAVED_PER_RUN, Math.max(1, job.maxProfiles));
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
    const queue = urlList.slice(0, Math.min(poolMax, urlList.length));

    const vetContext = await createVetBrowserContext();
    let processed = 0;

    try {
      for (let i = 0; i < queue.length && processed < targetSaved; i++) {
        const s = await ref.get();
        if (s.data()?.cancelRequested) {
          await appendLog("vet", Log.cancelled());
          break;
        }
        const url = queue[i];
        await appendLog("vet", Log.vetVisit());
        try {
          const imageBase64 = await scrapeCreatorProfileInContext(vetContext, url);
          const leadData = await analyzeProfileWithGemini(imageBase64, job.objectives, brand ?? null);
          const payTitle = job.brandContext?.paySourceCampaignTitle?.trim() || null;
          await db.collection("optic_outreach_leads").add({
            ...leadData,
            profileUrl: url,
            createdAt: FieldValue.serverTimestamp(),
            source: "Verza Optic (web worker)",
            agencyId: job.agencyId,
            agencyName: job.agencyName,
            campaignId: job.campaignId ?? null,
            campaignTitle: payTitle,
          });
          processed++;
          await ref.update({processedCount: processed, updatedAt: FieldValue.serverTimestamp()});
          await appendLog("vet", Log.saved(leadData.creatorName || "Creator"));
        } catch {
          await appendLog("vet", Log.skip());
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

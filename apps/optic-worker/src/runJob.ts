import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {generateSeedLeads, findCreators} from "./search";
import {createVetBrowserContext, scrapeCreatorProfileInContext} from "./scraper";
import {analyzeProfileWithGemini, type DraftBrandContext} from "./vision";

// Match Firebase emulator Firestore (see root firebase.json). Set in apps/optic-worker/.env for local dev.
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
  cancelRequested?: boolean;
};

const VET_DELAY_MS = 2000;

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

  await ref.update({
    status: "running",
    updatedAt: FieldValue.serverTimestamp(),
    workerStartedAt: FieldValue.serverTimestamp(),
    logs: FieldValue.arrayUnion({
      ts: Timestamp.now(),
      phase: "worker",
      message: "Worker started",
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
    await appendLog("search", "Generating seed leads from Gemini knowledge...");
    const seedLeads = await generateSeedLeads(job.platform, job.objectives, brand?.agencyName ?? null);
    seedLeads.forEach((lead) => allUrls.add(lead.url));

    let s0 = await ref.get();
    if (s0.data()?.cancelRequested) {
      await ref.update({
        status: "cancelled",
        updatedAt: FieldValue.serverTimestamp(),
        workerCompletedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    await appendLog("search", `Launching scout on ${job.platform}...`);
    const searchedUrls = await findCreators(job.platform, job.objectives);
    searchedUrls.forEach((url) => allUrls.add(url));

    if (allUrls.size === 0) {
      throw new Error("No creators found for the given criteria.");
    }

    const urlList = Array.from(allUrls).sort();
    const cap = job.maxProfiles;
    const toVisit = urlList.slice(0, Math.min(cap, urlList.length));

    const vetContext = await createVetBrowserContext();
    let processed = 0;

    try {
      for (let i = 0; i < toVisit.length; i++) {
        const s = await ref.get();
        if (s.data()?.cancelRequested) {
          await appendLog("vet", "Cancelled by user.");
          break;
        }
        const url = toVisit[i];
        await appendLog("vet", `Visiting: ${url}`);
        try {
          const imageBase64 = await scrapeCreatorProfileInContext(vetContext, url);
          const leadData = await analyzeProfileWithGemini(imageBase64, job.objectives, brand ?? null);
          await db.collection("optic_outreach_leads").add({
            ...leadData,
            profileUrl: url,
            createdAt: FieldValue.serverTimestamp(),
            source: "Verza Optic (web worker)",
            agencyId: job.agencyId,
            agencyName: job.agencyName,
          });
          processed++;
          await ref.update({processedCount: processed, updatedAt: FieldValue.serverTimestamp()});
          await appendLog("vet", `Saved lead: ${leadData.creatorName}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await appendLog("vet", `Skipped ${url}: ${msg}`);
        }
        if (i < toVisit.length - 1 && VET_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, VET_DELAY_MS));
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
        message: cancelled ? "Job cancelled." : `Completed. Saved ${processed} lead(s).`,
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

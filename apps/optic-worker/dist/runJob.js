"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDiscoveryJob = runDiscoveryJob;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const billing_1 = require("./billing");
const dedup_1 = require("./dedup");
const credits_1 = require("./credits");
const limits_1 = require("./limits");
const logCopy_1 = require("./logCopy");
const search_1 = require("./search");
const avatar_1 = require("./avatar");
const matchScore_1 = require("./matchScore");
const scraper_1 = require("./scraper");
const vision_1 = require("./vision");
if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`[optic-worker] Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
}
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
async function runDiscoveryJob(jobId) {
    const ref = db.collection("optic_jobs").doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new Error("Job not found");
    }
    const job = snap.data();
    if (job.status !== "queued") {
        console.log("[Optic worker] Skip job not in queued state:", jobId, job.status);
        return;
    }
    const targetSaved = (0, limits_1.workerSaveTarget)(job.maxProfiles);
    const delayMs = (0, limits_1.vetDelayMs)(targetSaved);
    await ref.update({
        status: "running",
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        workerStartedAt: firestore_1.FieldValue.serverTimestamp(),
        logs: firestore_1.FieldValue.arrayUnion({
            ts: firestore_1.Timestamp.now(),
            phase: "worker",
            message: logCopy_1.Log.scoutStarted(),
        }),
    });
    const appendLog = async (phase, message) => {
        await ref.update({
            logs: firestore_1.FieldValue.arrayUnion({ ts: firestore_1.Timestamp.now(), phase, message }),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    };
    const brand = job.brandContext ?? undefined;
    try {
        if (job.maxProfiles > targetSaved) {
            await appendLog("worker", `Requested ${job.maxProfiles} creators — vetting ${targetSaved} this run. Continue the mission for more.`);
        }
        const allUrls = new Set();
        await appendLog("search", logCopy_1.Log.shortlist());
        const seedLeads = await (0, search_1.generateSeedLeads)(job.platform, job.objectives, brand?.agencyName ?? null, targetSaved);
        seedLeads.forEach((lead) => allUrls.add((0, scraper_1.canonicalizeCreatorUrl)(lead.url, job.platform)));
        let s0 = await ref.get();
        if (s0.data()?.cancelRequested) {
            await ref.update({
                status: "cancelled",
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
                workerCompletedAt: firestore_1.FieldValue.serverTimestamp(),
                logs: firestore_1.FieldValue.arrayUnion({
                    ts: firestore_1.Timestamp.now(),
                    phase: "done",
                    message: logCopy_1.Log.jobCancelled(),
                }),
            });
            return;
        }
        await appendLog("search", logCopy_1.Log.platformSearch(job.platform));
        const searchedUrls = await (0, search_1.findCreators)(job.platform, job.objectives, targetSaved);
        searchedUrls.forEach((url) => allUrls.add((0, scraper_1.canonicalizeCreatorUrl)(url, job.platform)));
        if (allUrls.size === 0) {
            throw new Error("No creators found for the given criteria.");
        }
        const poolMax = (0, limits_1.urlPoolCap)(targetSaved);
        const urlList = Array.from(allUrls).sort();
        const campaignId = job.campaignId?.trim() || null;
        const knownUrls = await (0, dedup_1.loadExistingProfileUrlKeys)(db, job.agencyId, campaignId);
        const freshUrls = urlList.filter((u) => !knownUrls.has((0, dedup_1.normalizeProfileUrl)(u)));
        const skippedKnown = urlList.length - freshUrls.length;
        if (skippedKnown > 0) {
            await appendLog("search", logCopy_1.Log.skippingKnown(skippedKnown));
        }
        const queue = freshUrls.slice(0, Math.min(poolMax, freshUrls.length));
        const vetContext = await (0, scraper_1.createVetBrowserContext)();
        let processed = 0;
        let billing = await (0, billing_1.loadAgencyOpticBilling)(db, job.agencyId);
        try {
            for (let i = 0; i < queue.length && processed < targetSaved; i++) {
                const s = await ref.get();
                if (s.data()?.cancelRequested) {
                    await appendLog("vet", logCopy_1.Log.cancelled());
                    break;
                }
                const url = queue[i];
                if (knownUrls.has((0, dedup_1.normalizeProfileUrl)(url))) {
                    await appendLog("vet", logCopy_1.Log.alreadyKnown(url));
                    continue;
                }
                await appendLog("vet", logCopy_1.Log.vetVisit(url));
                try {
                    const capture = await (0, scraper_1.scrapeCreatorProfileInContext)(vetContext, url, job.platform);
                    const leadData = await (0, vision_1.analyzeProfileWithGemini)(capture.screenshotBase64, job.objectives, brand ?? null, job.platform);
                    const followerCount = capture.signals.followerCount || leadData.followerCount || null;
                    const postCount = capture.signals.postCount || leadData.postCount || null;
                    const email = capture.signals.email || leadData.email || null;
                    const externalUrl = capture.signals.externalUrl || leadData.externalUrl || null;
                    const gate = (0, matchScore_1.checkAudienceGate)({
                        followerCount,
                        postCount,
                        bio: capture.signals.bio || leadData.niche || leadData.creatorName,
                        externalUrl,
                    }, job.audienceTier ?? "any");
                    if (!gate.ok) {
                        await appendLog("vet", `Skipped ${url} — ${gate.reason}.`);
                        continue;
                    }
                    const payTitle = job.brandContext?.paySourceCampaignTitle?.trim() || null;
                    const match = (0, matchScore_1.composeMatchScore)({
                        briefFitScore: leadData.briefFitScore ?? 65,
                        matchReason: leadData.matchReason,
                        followerCount,
                        postCount,
                        email,
                        externalUrl,
                        audienceTier: job.audienceTier ?? "any",
                    });
                    const avatarUrl = await (0, avatar_1.persistOpticAvatar)({
                        agencyId: job.agencyId,
                        profileUrl: url,
                        avatarBytes: capture.avatarBytes,
                        avatarContentType: capture.avatarContentType,
                        avatarSourceUrl: capture.avatarSourceUrl,
                    });
                    const { briefFitScore: _briefFit, matchReason: _reason, postCount: _posts, externalUrl: _ext, ...enrichmentFields } = leadData;
                    const leadPayload = {
                        ...enrichmentFields,
                        email,
                        followerCount: followerCount || leadData.followerCount,
                        matchScore: match.matchScore,
                        matchReason: match.matchReason,
                        matchBreakdown: match.matchBreakdown,
                        followerCountNumeric: match.followerCountNumeric,
                        postCountNumeric: match.postCountNumeric,
                        avatarUrl: avatarUrl ?? null,
                        discoveryPlatform: job.platform,
                        profileUrl: url,
                        createdAt: firestore_1.FieldValue.serverTimestamp(),
                        source: "Verza Optic (web worker)",
                        agencyId: job.agencyId,
                        agencyName: job.agencyName,
                        campaignId: job.campaignId ?? null,
                        campaignTitle: payTitle,
                    };
                    let saveResult = await (0, credits_1.saveLeadWithOpticCreditCharge)({
                        db,
                        jobId,
                        agencyId: job.agencyId,
                        profileUrl: url,
                        leadData: leadPayload,
                        billing,
                    });
                    if (!saveResult.ok && saveResult.reason === "needs_top_up") {
                        const topUp = await (0, billing_1.requestPilotTopUp)(job.agencyId);
                        if (topUp.ok) {
                            billing = await (0, billing_1.loadAgencyOpticBilling)(db, job.agencyId);
                            await appendLog("vet", logCopy_1.Log.topUpApplied());
                            saveResult = await (0, credits_1.saveLeadWithOpticCreditCharge)({
                                db,
                                jobId,
                                agencyId: job.agencyId,
                                profileUrl: url,
                                leadData: leadPayload,
                                billing,
                            });
                        }
                        else {
                            await appendLog("vet", logCopy_1.Log.topUpFailed(topUp.reason));
                        }
                    }
                    if (!saveResult.ok) {
                        await appendLog("vet", logCopy_1.Log.insufficientCredits());
                        break;
                    }
                    if (saveResult.charged) {
                        void (0, billing_1.requestLowCreditCheck)(job.agencyId);
                    }
                    processed++;
                    knownUrls.add((0, dedup_1.normalizeProfileUrl)(url));
                    await ref.update({ processedCount: processed, updatedAt: firestore_1.FieldValue.serverTimestamp() });
                    await appendLog("vet", logCopy_1.Log.saved(leadData.creatorName || "Creator"));
                }
                catch {
                    await appendLog("vet", logCopy_1.Log.skip(url));
                }
                if (i < queue.length - 1 && processed < targetSaved && delayMs > 0) {
                    await new Promise((r) => setTimeout(r, delayMs));
                }
            }
        }
        finally {
            await vetContext.close().catch(() => { });
        }
        const finalSnap = await ref.get();
        const cancelled = Boolean(finalSnap.data()?.cancelRequested);
        await ref.update({
            status: cancelled ? "cancelled" : "completed",
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            workerCompletedAt: firestore_1.FieldValue.serverTimestamp(),
            processedCount: processed,
            logs: firestore_1.FieldValue.arrayUnion({
                ts: firestore_1.Timestamp.now(),
                phase: "done",
                message: cancelled ? logCopy_1.Log.jobCancelled() : logCopy_1.Log.done(processed, targetSaved),
            }),
        });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await ref.update({
            status: "failed",
            error: msg.slice(0, 2000),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            workerCompletedAt: firestore_1.FieldValue.serverTimestamp(),
            logs: firestore_1.FieldValue.arrayUnion({
                ts: firestore_1.Timestamp.now(),
                phase: "error",
                message: msg.slice(0, 500),
            }),
        });
        throw e;
    }
}

import type {
  ClaimedJob,
  ExtensionAudienceFilter,
  ExtensionProgressPhase,
  ScrapedInstagramProfile,
} from "./shared/types";
import { callFunction, sleep } from "./shared/api";
import {
  instagramProfileUrl,
  instagramUsernameFromUrl,
  parseCompactCount,
} from "./shared/instagram";
import { EXTENSION_VERSION } from "./shared/types";

const DEFAULT_AUDIENCE_FILTER: ExtensionAudienceFilter = {
  minFollowers: 100,
  maxFollowers: null,
  minPostCount: 3,
  poolMultiplier: 3,
};

/** Why a profile was skipped. "Any size" has no bounds, so it only ever skips on quality. */
type AudienceRejection = { reason: string; kind: "size" | "quality" };

/**
 * Mirrors `checkAudienceGate` in apps/functions. Unknown counts never reject, so a
 * flaky scrape cannot silently discard a good creator.
 */
function audienceRejectReason(
  profile: ScrapedInstagramProfile,
  filter: ExtensionAudienceFilter
): AudienceRejection | null {
  const posts = parseCompactCount(profile.postCount);
  if (posts !== null && posts < filter.minPostCount) {
    return { reason: "barely posts anything", kind: "quality" };
  }

  const hasBio = Boolean(profile.bio?.trim());
  const hasLink = Boolean(profile.externalUrl?.trim());
  if (!hasBio && !hasLink && posts === null) {
    return { reason: "their profile is empty", kind: "quality" };
  }

  const followers = parseCompactCount(profile.followerCount);
  if (followers === null) return null;
  if (filter.minFollowers !== null && followers < filter.minFollowers) {
    return { reason: "smaller than the audience size you picked", kind: "size" };
  }
  if (filter.maxFollowers !== null && followers > filter.maxFollowers) {
    return { reason: "bigger than the audience size you picked", kind: "size" };
  }
  return null;
}

const OPTIC_BRIDGE_URLS = [
  "http://localhost/*",
  "http://127.0.0.1/*",
  "https://app.tryverza.com/*",
  "https://dev-app.tryverza.com/*",
];

const PROFILE_PAUSE_MS = 1200;
const POST_PAUSE_MS = 1000;

async function reinjectOpticBridge() {
  const tabs = await chrome.tabs.query({ url: OPTIC_BRIDGE_URLS });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["dist/verza-bridge.js"],
        });
      } catch {
        /* ignore */
      }
    })
  );
}

chrome.runtime.onInstalled.addListener(() => {
  void reinjectOpticBridge();
});

chrome.runtime.onStartup.addListener(() => {
  void reinjectOpticBridge();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  const isOpticPage =
    /^https:\/\/app\.tryverza\.com\/optic/.test(tab.url) ||
    /^https:\/\/dev-app\.tryverza\.com\/optic/.test(tab.url) ||
    /^http:\/\/localhost:\d+\/optic/.test(tab.url) ||
    /^http:\/\/127\.0\.0\.1:\d+\/optic/.test(tab.url);
  if (!isOpticPage) return;
  void chrome.scripting
    .executeScript({ target: { tabId }, files: ["dist/verza-bridge.js"] })
    .catch(() => {});
});

type RunState = {
  running: boolean;
  jobId: string | null;
  idToken: string | null;
  projectId: string | null;
  useFunctionsEmulator: boolean;
};

const state: RunState = {
  running: false,
  jobId: null,
  idToken: null,
  projectId: null,
  useFunctionsEmulator: false,
};

type ProgressReporter = (
  phase: ExtensionProgressPhase,
  message: string,
  opts?: { discovered?: number; target?: number; logMessage?: string }
) => Promise<void>;

async function waitForTabLoad(tabId: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      await sleep(2500);
      return;
    }
    await sleep(500);
  }
  throw new Error("Instagram took too long to load. Check your connection and try again.");
}

async function injectOpticApi(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["dist/injected.js"],
  });
}

async function runInTab<T>(tabId: number, method: string, args: unknown[] = []): Promise<T> {
  await injectOpticApi(tabId);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (m: string, callArgs: unknown[]) => {
      const api = window.__VERZA_OPTIC;
      if (!api) return null;
      const fn = (api as Record<string, (...a: unknown[]) => unknown>)[m];
      if (typeof fn !== "function") return null;
      return await fn(...callArgs);
    },
    args: [method, args],
  });
  return result as T;
}

function postBudget(maxProfiles: number): number {
  return Math.min(150, Math.max(24, maxProfiles * 4));
}

function profilePauseMs(maxProfiles: number): number {
  return maxProfiles >= 50 ? 700 : maxProfiles >= 25 ? 900 : PROFILE_PAUSE_MS;
}

async function broadcastProgressToOpticTabs(payload: Record<string, unknown>) {
  const tabs = await chrome.tabs.query({ url: OPTIC_BRIDGE_URLS });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "OPTIC_PROGRESS_BROADCAST", ...payload });
      } catch {
        /* tab may not have bridge */
      }
    })
  );
}

function createProgressReporter(
  jobId: string,
  idToken: string,
  projectId: string,
  useFunctionsEmulator: boolean,
  target: number
): ProgressReporter {
  let lastMessage = "";

  return async (phase, message, opts) => {
    const discovered = opts?.discovered;
    const payload = { phase, message, discovered, target: opts?.target ?? target };

    void broadcastProgressToOpticTabs({ jobId, ...payload });

    if (message === lastMessage && !opts?.logMessage) return;
    lastMessage = message;

    await callFunction(
      projectId,
      "reportOpticExtensionProgress",
      idToken,
      {
        jobId,
        phase,
        message,
        discovered,
        target: opts?.target ?? target,
        logMessage: opts?.logMessage ?? null,
      },
      useFunctionsEmulator
    ).catch(() => {
      /* non-fatal */
    });
  };
}

async function resolveAuthorsFromPosts(
  postUrls: string[],
  selfUsername: string | null,
  report: ProgressReporter,
  target: number
): Promise<string[]> {
  const handles = new Set<string>();
  if (selfUsername) handles.add(selfUsername.toLowerCase());

  for (let i = 0; i < postUrls.length; i += 1) {
    if (handles.size >= target * 4) break;

    await report("posts", `Opening post ${i + 1} of ${postUrls.length}…`, {
      discovered: handles.size,
      target,
    });

    const postUrl = postUrls[i];
    const postTab = await chrome.tabs.create({ url: postUrl, active: false });
    if (!postTab.id) continue;

    try {
      await waitForTabLoad(postTab.id);
      const author = await runInTab<string | null>(postTab.id, "scrapePostAuthor", [selfUsername]);
      if (author) handles.add(author.toLowerCase());
    } catch {
      /* skip */
    } finally {
      await chrome.tabs.remove(postTab.id).catch(() => {});
      await sleep(POST_PAUSE_MS);
    }
  }

  return Array.from(handles).map((h) => instagramProfileUrl(h));
}

async function discoverFromHashtag(
  hashtag: string,
  maxProfiles: number,
  selfUsername: string | null,
  report: ProgressReporter,
  target: number,
  onSelfDetected?: (username: string | null) => void
): Promise<string[]> {
  const hashtagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`;
  const tab = await chrome.tabs.create({ url: hashtagUrl, active: true });
  if (!tab.id) return [];

  try {
    await waitForTabLoad(tab.id);

    const detectedSelf = await runInTab<string | null>(tab.id, "detectLoggedInUsername");
    onSelfDetected?.(detectedSelf);
    const exclude = selfUsername ?? detectedSelf;

    const prepared = await runInTab<{ ready: boolean; reason?: string }>(tab.id, "prepareHashtagExplore");
    if (!prepared?.ready) {
      if (prepared?.reason === "login_required") {
        throw new Error("Please sign in to Instagram in Chrome, then start the mission again.");
      }
      return [];
    }

    const postUrls = await runInTab<string[]>(tab.id, "collectHashtagPostUrls", [postBudget(maxProfiles)]);
    if (postUrls.length === 0) return [];

    await report("hashtag", `Found ${postUrls.length} posts under #${hashtag} — checking who posted them…`, {
      logMessage: `Browsing #${hashtag}: ${postUrls.length} posts to review.`,
    });

    return await resolveAuthorsFromPosts(postUrls, exclude, report, target);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function discoverFromKeyword(
  searchQuery: string,
  maxProfiles: number,
  selfUsername: string | null,
  report: ProgressReporter,
  target: number
): Promise<string[]> {
  const searchUrl = `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(searchQuery)}`;
  const tab = await chrome.tabs.create({ url: searchUrl, active: true });
  if (!tab.id) return [];

  try {
    await waitForTabLoad(tab.id);
    const prepared = await runInTab<{ ready: boolean; reason?: string }>(tab.id, "prepareKeywordSearch");
    if (!prepared?.ready) return [];

    const profileUrls = await runInTab<string[]>(tab.id, "collectKeywordAccountUrls", [
      postBudget(maxProfiles),
      selfUsername,
    ]);

    await report("keyword", `Found ${profileUrls.length} accounts matching “${searchQuery}”.`, {
      discovered: profileUrls.length,
      target,
      logMessage: `Searched “${searchQuery}”: ${profileUrls.length} accounts found.`,
    });

    return profileUrls;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function discoverProfileUrls(claimed: ClaimedJob, report: ProgressReporter): Promise<string[]> {
  const target = claimed.maxProfiles;
  const multiplier = claimed.audienceFilter?.poolMultiplier ?? DEFAULT_AUDIENCE_FILTER.poolMultiplier;
  const minPool = Math.max(target * multiplier, 8);
  const ordered: string[] = [];
  // Seeding with vault handles makes addUrls drop creators we already saved, so
  // continuation batches keep searching until they find genuinely new profiles.
  const seen = new Set<string>((claimed.excludeUsernames ?? []).map((u) => u.toLowerCase()));
  const alreadyInVault = seen.size;

  const addUrls = (urls: string[]) => {
    for (const url of urls) {
      const user = instagramUsernameFromUrl(url);
      if (!user) continue;
      const key = user.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(instagramProfileUrl(user));
    }
  };

  // Keeps current behaviour at multiplier 2 and widens the crawl for narrower bands.
  const budgetTarget = Math.ceil((target * multiplier) / 2);
  let selfUsername: string | null = null;

  if (claimed.seedProfileUrls.length > 0) {
    await report("seeds", `Lining up ${claimed.seedProfileUrls.length} creators who look like a fit…`, {
      target,
    });
    addUrls(claimed.seedProfileUrls);
    await report("seeds", `Shortlist ready — ${ordered.length} creators to look at.`, {
      discovered: ordered.length,
      target,
      logMessage: `Shortlisted ${ordered.length} creators who match your campaign.`,
    });
  }

  const hashtags = (claimed.hashtags?.length ? claimed.hashtags : [claimed.hashtag]).filter(Boolean);
  const searchQueries = (
    claimed.searchQueries?.length ? claimed.searchQueries : [claimed.searchQuery]
  ).filter(Boolean);

  for (const tag of hashtags) {
    if (ordered.length >= minPool) break;
    await report("hashtag", `Browsing #${tag} on Instagram…`, { discovered: ordered.length, target });

    const fromHashtag = await discoverFromHashtag(
      tag,
      budgetTarget,
      selfUsername,
      report,
      target,
      async (username) => {
        selfUsername = username;
      }
    );
    addUrls(fromHashtag);
  }

  for (const query of searchQueries) {
    if (ordered.length >= minPool) break;
    await report("keyword", `Searching Instagram for “${query}”…`, {
      discovered: ordered.length,
      target,
    });
    const fromKeyword = await discoverFromKeyword(
      query,
      budgetTarget,
      selfUsername,
      report,
      target
    );
    addUrls(fromKeyword);
  }

  if (ordered.length === 0) {
    throw new Error(
      alreadyInVault > 0
        ? "No new creators this time — everyone we found is already in your vault. " +
          "Try widening your campaign goals before the next batch."
        : "We couldn't find any Instagram creators. Make sure you're signed in to Instagram " +
          "in Chrome, and try broadening your campaign goals."
    );
  }

  await report("profiles", `Looking at ${ordered.length} creator profiles…`, {
    discovered: ordered.length,
    target,
    logMessage:
      alreadyInVault > 0
        ? `Ready to review ${ordered.length} new creators (${alreadyInVault} were already in your vault).`
        : `Ready to review ${ordered.length} creators.`,
  });

  return ordered;
}

async function runExtensionJob(
  jobId: string,
  idToken: string,
  projectId: string,
  useFunctionsEmulator: boolean
): Promise<void> {
  if (state.running) {
    throw new Error("A mission is already running in Chrome. Let it finish, then start the next one.");
  }

  state.running = true;
  state.jobId = jobId;
  state.idToken = idToken;
  state.projectId = projectId;
  state.useFunctionsEmulator = useFunctionsEmulator;
  await chrome.storage.session.set({ opticRunning: true, opticJobId: jobId });

  try {
    const claimed = await callFunction<ClaimedJob>(
      projectId,
      "claimOpticExtensionJob",
      idToken,
      { jobId },
      useFunctionsEmulator
    );

    const report = createProgressReporter(
      jobId,
      idToken,
      projectId,
      useFunctionsEmulator,
      claimed.maxProfiles
    );

    if (claimed.searchSummary) {
      await report("prepare", claimed.searchSummary, {
        target: claimed.maxProfiles,
        logMessage: `Where we're looking: ${claimed.searchSummary}`,
      });
    }

    const profileUrls = await discoverProfileUrls(claimed, report);
    let saved = claimed.processedCount ?? 0;
    let skippedSize = 0;
    let skippedQuality = 0;
    const target = claimed.maxProfiles;
    const audienceFilter = claimed.audienceFilter ?? DEFAULT_AUDIENCE_FILTER;

    for (let i = 0; i < profileUrls.length; i += 1) {
      if (saved >= target) break;

      const profileUrl = profileUrls[i];
      const username = instagramUsernameFromUrl(profileUrl) ?? "creator";

      await report("profiles", `Checking @${username} (${i + 1} of ${profileUrls.length})…`, {
        discovered: saved,
        target,
      });

      const tab = await chrome.tabs.create({ url: profileUrl, active: false });
      if (!tab.id) continue;

      try {
        await waitForTabLoad(tab.id);
        const profile = await runInTab<ScrapedInstagramProfile | null>(
          tab.id,
          "scrapeInstagramProfile"
        );

        if (!profile?.username) continue;

        // Filtering before submit is what keeps a rejected profile free — credits are
        // only charged when a lead is saved.
        const rejection = audienceRejectReason(profile, audienceFilter);
        if (rejection) {
          if (rejection.kind === "size") skippedSize += 1;
          else skippedQuality += 1;
          await report("profiles", `Passed on @${username} — ${rejection.reason}.`, {
            discovered: saved,
            target,
          });
          continue;
        }

        const submit = await callFunction<{
          ok: boolean;
          reason?: string;
          processedCount?: number;
        }>(
          projectId,
          "submitOpticExtensionLead",
          idToken,
          { jobId, profile },
          useFunctionsEmulator
        );

        if (!submit.ok) {
          if (submit.reason === "cancelled" || submit.reason === "insufficient_credits") break;
          continue;
        }
        saved = submit.processedCount ?? saved + 1;
        await report("profiles", `Added ${saved} of ${target} creators to your vault.`, {
          discovered: saved,
          target,
        });
      } catch {
        /* skip */
      } finally {
        await chrome.tabs.remove(tab.id).catch(() => {});
        await sleep(profilePauseMs(target));
      }
    }

    // Naming the real reason matters: "Any size" sets no bounds, so blaming audience
    // size for a quality skip reads as a bug to anyone who picked it.
    const skipNotes: string[] = [];
    if (skippedSize > 0) skipNotes.push(`${skippedSize} outside your audience size`);
    if (skippedQuality > 0) {
      skipNotes.push(`${skippedQuality} with inactive or empty profiles`);
    }
    const filteredNote = skipNotes.length > 0 ? ` Passed on ${skipNotes.join(" and ")}.` : "";
    await report("done", `All done — added ${saved} of ${target} creators to your vault.`, {
      discovered: saved,
      target,
      logMessage: `Finished with ${saved} of ${target} creators.${filteredNote}`,
    });

    await callFunction(
      projectId,
      "completeOpticExtensionJob",
      idToken,
      { jobId, status: "completed" },
      useFunctionsEmulator
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await callFunction(
      projectId,
      "completeOpticExtensionJob",
      idToken,
      { jobId, status: "failed", error: message },
      useFunctionsEmulator
    ).catch(() => {});
    throw e;
  } finally {
    state.running = false;
    state.jobId = null;
    state.idToken = null;
    state.projectId = null;
    state.useFunctionsEmulator = false;
    await chrome.storage.session.set({ opticRunning: false, opticJobId: null });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPTIC_GET_STATUS") {
    sendResponse({
      version: EXTENSION_VERSION,
      running: state.running,
      jobId: state.jobId,
    });
    return true;
  }
  if (message?.type === "OPTIC_START_JOB") {
    const { jobId, idToken, projectId, useFunctionsEmulator } = message as {
      jobId: string;
      idToken: string;
      projectId: string;
      useFunctionsEmulator?: boolean;
    };
    if (state.running) {
      sendResponse({
        ok: false,
        error: "A mission is already running in Chrome. Let it finish, then start the next one.",
      });
      return true;
    }
    // A mission runs for minutes, far longer than the page will wait for this
    // response, so acknowledge that it started rather than that it finished.
    // runExtensionJob reports the real outcome via completeOpticExtensionJob.
    void runExtensionJob(jobId, idToken, projectId, useFunctionsEmulator === true).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

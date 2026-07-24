import type { ClaimedJob, ExtensionProgressPhase } from "./shared/types";
import { callFunction, sleep } from "./shared/api";
import { instagramProfileUrl, instagramUsernameFromUrl } from "./shared/instagram";
import { EXTENSION_VERSION } from "./shared/types";

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
  throw new Error("Tab load timed out");
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
        throw new Error("Log into Instagram in this Chrome profile, then start the mission again.");
      }
      return [];
    }

    const postUrls = await runInTab<string[]>(tab.id, "collectHashtagPostUrls", [postBudget(maxProfiles)]);
    if (postUrls.length === 0) return [];

    await report("hashtag", `Found ${postUrls.length} posts under #${hashtag} — resolving creators…`, {
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

    await report("keyword", `Keyword search found ${profileUrls.length} accounts for “${searchQuery}”.`, {
      discovered: profileUrls.length,
      target,
      logMessage: `Keyword search “${searchQuery}”: ${profileUrls.length} accounts.`,
    });

    return profileUrls;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function discoverProfileUrls(claimed: ClaimedJob, report: ProgressReporter): Promise<string[]> {
  const target = claimed.maxProfiles;
  const minPool = Math.max(target * 2, 8);
  const ordered: string[] = [];
  const seen = new Set<string>();

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

  let selfUsername: string | null = null;

  if (claimed.seedProfileUrls.length > 0) {
    await report("seeds", `Checking ${claimed.seedProfileUrls.length} AI-suggested creators…`, { target });
    addUrls(claimed.seedProfileUrls);
    await report("seeds", `Shortlist ready — ${ordered.length} creators queued.`, {
      discovered: ordered.length,
      target,
      logMessage: `AI shortlist: ${ordered.length} creator profiles for this brief.`,
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
      claimed.maxProfiles,
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
    await report("keyword", `Trying keyword search: “${query}”…`, {
      discovered: ordered.length,
      target,
    });
    const fromKeyword = await discoverFromKeyword(
      query,
      claimed.maxProfiles,
      selfUsername,
      report,
      target
    );
    addUrls(fromKeyword);
  }

  if (ordered.length === 0) {
    throw new Error(
      "Could not find Instagram creators. Log into Instagram in Chrome and try broader campaign objectives."
    );
  }

  await report("profiles", `Reviewing ${ordered.length} creator profiles…`, {
    discovered: ordered.length,
    target,
    logMessage: `Ready to review ${ordered.length} profiles.`,
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
    throw new Error("A mission is already running in the extension.");
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
        logMessage: `Search plan: ${claimed.searchSummary}`,
      });
    }

    const profileUrls = await discoverProfileUrls(claimed, report);
    let saved = claimed.processedCount ?? 0;
    const target = claimed.maxProfiles;

    for (let i = 0; i < profileUrls.length; i += 1) {
      if (saved >= target) break;

      const profileUrl = profileUrls[i];
      const username = instagramUsernameFromUrl(profileUrl) ?? "creator";

      await report("profiles", `Reviewing @${username} (${i + 1}/${profileUrls.length})…`, {
        discovered: saved,
        target,
      });

      const tab = await chrome.tabs.create({ url: profileUrl, active: false });
      if (!tab.id) continue;

      try {
        await waitForTabLoad(tab.id);
        const profile = await runInTab<{
          username: string;
          displayName: string | null;
          bio: string | null;
          followerCount: string | null;
          externalUrl: string | null;
        } | null>(tab.id, "scrapeInstagramProfile");

        if (!profile?.username) continue;

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
        await report("profiles", `Saved ${saved} of ${target} creators to your vault.`, {
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

    await report("done", `Mission complete — saved ${saved} of ${target} creators.`, {
      discovered: saved,
      target,
      logMessage: `Done — saved ${saved} of ${target} creators.`,
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
    runExtensionJob(jobId, idToken, projectId, useFunctionsEmulator === true)
      .then(() => sendResponse({ ok: true }))
      .catch((e) =>
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      );
    return true;
  }
  return false;
});

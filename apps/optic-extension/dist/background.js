"use strict";
(() => {
  // src/shared/api.ts
  var REGION = "us-central1";
  var FUNCTIONS_EMULATOR_ORIGIN = "http://localhost:5001";
  function resolveCallableUrl(projectId, name, useFunctionsEmulator) {
    if (useFunctionsEmulator) {
      return `${FUNCTIONS_EMULATOR_ORIGIN}/${projectId}/${REGION}/${name}`;
    }
    return `https://${REGION}-${projectId}.cloudfunctions.net/${name}`;
  }
  async function callFunction(projectId, name, idToken, data, useFunctionsEmulator = false) {
    const url = resolveCallableUrl(projectId, name, useFunctionsEmulator);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ data })
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(json.error?.message || `Callable ${name} failed (${res.status})`);
    }
    return json.result;
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // src/shared/instagram.ts
  function instagramUsernameFromUrl(urlOrHandle) {
    const raw = urlOrHandle.trim();
    if (!raw) return null;
    if (raw.startsWith("@")) {
      const handle = raw.slice(1).split(/[/?#]/)[0];
      return handle || null;
    }
    try {
      const u = new URL(raw.includes("://") ? raw : `https://www.instagram.com/${raw}`);
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (!seg || ["p", "reel", "tv", "explore", "accounts"].includes(seg.toLowerCase())) {
        return null;
      }
      return seg;
    } catch {
      const handle = raw.replace(/^@/, "").split(/[/?#]/)[0];
      return handle || null;
    }
  }
  function instagramProfileUrl(username) {
    const clean = username.replace(/^@/, "").trim();
    return `https://www.instagram.com/${clean}/`;
  }
  var COUNT_SUFFIXES = { k: 1e3, m: 1e6, b: 1e9 };
  function parseCompactCount(raw) {
    if (!raw) return null;
    const text = raw.trim().toLowerCase().replace(/,/g, "").replace(/\+$/, "");
    const match = text.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value)) return null;
    const multiplier = match[2] ? COUNT_SUFFIXES[match[2]] : 1;
    return Math.round(value * multiplier);
  }

  // src/shared/handles.ts
  var X_SKIP = /* @__PURE__ */ new Set([
    "home",
    "search",
    "explore",
    "settings",
    "i",
    "intent",
    "compose",
    "messages",
    "notifications",
    "login",
    "tos",
    "privacy",
    "hashtag",
    "jobs",
    "about",
    "download"
  ]);
  function linkedinSlugFromUrl(urlOrSlug) {
    const raw = urlOrSlug.trim();
    if (!raw) return null;
    try {
      const u = raw.startsWith("/") ? new URL(raw, "https://www.linkedin.com") : new URL(raw.includes("://") ? raw : `https://www.linkedin.com/in/${raw}`);
      const m = u.pathname.match(/^\/in\/([^/]+)/);
      if (!m?.[1]) return null;
      const slug = decodeURIComponent(m[1]).replace(/\/+$/, "");
      return slug || null;
    } catch {
      const slug = raw.replace(/^\/?in\//, "").split(/[/?#]/)[0];
      return slug || null;
    }
  }
  function linkedinProfileUrl(slug) {
    const clean = linkedinSlugFromUrl(slug) ?? slug.replace(/^@/, "").trim();
    return `https://www.linkedin.com/in/${clean}`;
  }
  function twitterHandleFromUrl(urlOrHandle) {
    const raw = urlOrHandle.trim();
    if (!raw) return null;
    if (raw.startsWith("@")) {
      const handle = raw.slice(1).split(/[/?#]/)[0];
      return handle || null;
    }
    try {
      const u = raw.startsWith("/") ? new URL(raw, "https://x.com") : new URL(raw.includes("://") ? raw : `https://x.com/${raw}`);
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (!seg || X_SKIP.has(seg.toLowerCase()) || seg.startsWith("i")) return null;
      return seg;
    } catch {
      const handle = raw.replace(/^@/, "").split(/[/?#]/)[0];
      return handle || null;
    }
  }
  function twitterProfileUrl(handle) {
    const clean = twitterHandleFromUrl(handle) ?? handle.replace(/^@/, "").trim();
    return `https://x.com/${clean}`;
  }
  function creatorKeyFromUrl(url, platform) {
    if (platform === "linkedin") {
      const slug = linkedinSlugFromUrl(url);
      return slug ? slug.toLowerCase() : null;
    }
    if (platform === "twitter") {
      const handle = twitterHandleFromUrl(url);
      return handle ? handle.toLowerCase() : null;
    }
    return null;
  }
  function canonicalProfileUrl(url, platform) {
    if (platform === "linkedin") {
      const slug = linkedinSlugFromUrl(url);
      return slug ? linkedinProfileUrl(slug) : null;
    }
    if (platform === "twitter") {
      const handle = twitterHandleFromUrl(url);
      return handle ? twitterProfileUrl(handle) : null;
    }
    return null;
  }

  // src/shared/types.ts
  var EXTENSION_VERSION = "0.2.0";

  // src/background.ts
  var DEFAULT_AUDIENCE_FILTER = {
    minFollowers: 100,
    maxFollowers: null,
    minPostCount: 3,
    poolMultiplier: 3
  };
  function audienceRejectReason(profile, filter) {
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
  var OPTIC_BRIDGE_URLS = [
    "http://localhost/*",
    "http://127.0.0.1/*",
    "https://app.tryverza.com/*",
    "https://dev-app.tryverza.com/*"
  ];
  var PROFILE_PAUSE_MS = 1200;
  var POST_PAUSE_MS = 1e3;
  async function reinjectOpticBridge() {
    const tabs = await chrome.tabs.query({ url: OPTIC_BRIDGE_URLS });
    await Promise.all(
      tabs.map(async (tab) => {
        if (!tab.id) return;
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["dist/verza-bridge.js"]
          });
        } catch {
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
    const isOpticPage = /^https:\/\/app\.tryverza\.com\/optic/.test(tab.url) || /^https:\/\/dev-app\.tryverza\.com\/optic/.test(tab.url) || /^http:\/\/localhost:\d+\/optic/.test(tab.url) || /^http:\/\/127\.0\.0\.1:\d+\/optic/.test(tab.url);
    if (!isOpticPage) return;
    void chrome.scripting.executeScript({ target: { tabId }, files: ["dist/verza-bridge.js"] }).catch(() => {
    });
  });
  var state = {
    running: false,
    jobId: null,
    idToken: null,
    projectId: null,
    useFunctionsEmulator: false
  };
  async function waitForTabLoad(tabId, timeoutMs = 6e4) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        await sleep(2500);
        return;
      }
      await sleep(500);
    }
    throw new Error("This page took too long to load. Check your connection and try again.");
  }
  async function injectOpticApi(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/injected.js"]
    });
  }
  async function runInTab(tabId, method, args = []) {
    await injectOpticApi(tabId);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (m, callArgs) => {
        const api = window.__VERZA_OPTIC;
        if (!api) return null;
        const fn = api[m];
        if (typeof fn !== "function") return null;
        return await fn(...callArgs);
      },
      args: [method, args]
    });
    return result;
  }
  function postBudget(maxProfiles) {
    return Math.min(150, Math.max(24, maxProfiles * 4));
  }
  function profilePauseMs(maxProfiles, platform = "instagram") {
    if (platform === "linkedin") return maxProfiles >= 50 ? 1800 : 2800;
    if (platform === "twitter") return maxProfiles >= 50 ? 900 : 1600;
    return maxProfiles >= 50 ? 700 : maxProfiles >= 25 ? 900 : PROFILE_PAUSE_MS;
  }
  function scrapeMethodFor(platform) {
    if (platform === "linkedin") return "scrapeLinkedInProfile";
    if (platform === "twitter") return "scrapeXProfile";
    return "scrapeInstagramProfile";
  }
  function creatorKey(url, platform) {
    if (platform === "linkedin" || platform === "twitter") {
      return creatorKeyFromUrl(url, platform);
    }
    const user = instagramUsernameFromUrl(url);
    return user ? user.toLowerCase() : null;
  }
  function toCanonicalUrl(url, platform) {
    if (platform === "linkedin" || platform === "twitter") {
      return canonicalProfileUrl(url, platform);
    }
    const user = instagramUsernameFromUrl(url);
    return user ? instagramProfileUrl(user) : null;
  }
  async function broadcastProgressToOpticTabs(payload) {
    const tabs = await chrome.tabs.query({ url: OPTIC_BRIDGE_URLS });
    await Promise.all(
      tabs.map(async (tab) => {
        if (!tab.id) return;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "OPTIC_PROGRESS_BROADCAST", ...payload });
        } catch {
        }
      })
    );
  }
  function createProgressReporter(jobId, idToken, projectId, useFunctionsEmulator, target) {
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
          logMessage: opts?.logMessage ?? null
        },
        useFunctionsEmulator
      ).catch(() => {
      });
    };
  }
  async function resolveAuthorsFromPosts(postUrls, selfUsername, report, target) {
    const handles = /* @__PURE__ */ new Set();
    if (selfUsername) handles.add(selfUsername.toLowerCase());
    for (let i = 0; i < postUrls.length; i += 1) {
      if (handles.size >= target * 4) break;
      await report("posts", `Opening post ${i + 1} of ${postUrls.length}\u2026`, {
        discovered: handles.size,
        target
      });
      const postUrl = postUrls[i];
      const postTab = await chrome.tabs.create({ url: postUrl, active: false });
      if (!postTab.id) continue;
      try {
        await waitForTabLoad(postTab.id);
        const author = await runInTab(postTab.id, "scrapePostAuthor", [selfUsername]);
        if (author) handles.add(author.toLowerCase());
      } catch {
      } finally {
        await chrome.tabs.remove(postTab.id).catch(() => {
        });
        await sleep(POST_PAUSE_MS);
      }
    }
    return Array.from(handles).map((h) => instagramProfileUrl(h));
  }
  async function discoverFromHashtag(hashtag, maxProfiles, selfUsername, report, target, onSelfDetected) {
    const hashtagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`;
    const tab = await chrome.tabs.create({ url: hashtagUrl, active: true });
    if (!tab.id) return [];
    try {
      await waitForTabLoad(tab.id);
      const detectedSelf = await runInTab(tab.id, "detectLoggedInUsername");
      onSelfDetected?.(detectedSelf);
      const exclude = selfUsername ?? detectedSelf;
      const prepared = await runInTab(tab.id, "prepareHashtagExplore");
      if (!prepared?.ready) {
        if (prepared?.reason === "login_required") {
          throw new Error("Please sign in to Instagram in Chrome, then start the mission again.");
        }
        return [];
      }
      const postUrls = await runInTab(tab.id, "collectHashtagPostUrls", [postBudget(maxProfiles)]);
      if (postUrls.length === 0) return [];
      await report("hashtag", `Found ${postUrls.length} posts under #${hashtag} \u2014 checking who posted them\u2026`, {
        logMessage: `Browsing #${hashtag}: ${postUrls.length} posts to review.`
      });
      return await resolveAuthorsFromPosts(postUrls, exclude, report, target);
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => {
      });
    }
  }
  async function discoverFromKeyword(searchQuery, maxProfiles, selfUsername, report, target) {
    const searchUrl = `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(searchQuery)}`;
    const tab = await chrome.tabs.create({ url: searchUrl, active: true });
    if (!tab.id) return [];
    try {
      await waitForTabLoad(tab.id);
      const prepared = await runInTab(tab.id, "prepareKeywordSearch");
      if (!prepared?.ready) return [];
      const profileUrls = await runInTab(tab.id, "collectKeywordAccountUrls", [
        postBudget(maxProfiles),
        selfUsername
      ]);
      await report("keyword", `Found ${profileUrls.length} accounts matching \u201C${searchQuery}\u201D.`, {
        discovered: profileUrls.length,
        target,
        logMessage: `Searched \u201C${searchQuery}\u201D: ${profileUrls.length} accounts found.`
      });
      return profileUrls;
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => {
      });
    }
  }
  async function discoverInstagramProfileUrls(claimed, report) {
    const target = claimed.maxProfiles;
    const multiplier = claimed.audienceFilter?.poolMultiplier ?? DEFAULT_AUDIENCE_FILTER.poolMultiplier;
    const minPool = Math.max(target * multiplier, 8);
    const ordered = [];
    const seen = new Set((claimed.excludeUsernames ?? []).map((u) => u.toLowerCase()));
    const alreadyInVault = seen.size;
    const addUrls = (urls) => {
      for (const url of urls) {
        const user = instagramUsernameFromUrl(url);
        if (!user) continue;
        const key = user.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        ordered.push(instagramProfileUrl(user));
      }
    };
    const budgetTarget = Math.ceil(target * multiplier / 2);
    let selfUsername = null;
    if (claimed.seedProfileUrls.length > 0) {
      await report("seeds", `Lining up ${claimed.seedProfileUrls.length} creators who look like a fit\u2026`, {
        target
      });
      addUrls(claimed.seedProfileUrls);
      await report("seeds", `Shortlist ready \u2014 ${ordered.length} creators to look at.`, {
        discovered: ordered.length,
        target,
        logMessage: `Shortlisted ${ordered.length} creators who match your campaign.`
      });
    }
    const hashtags = (claimed.hashtags?.length ? claimed.hashtags : [claimed.hashtag]).filter(Boolean);
    const searchQueries = (claimed.searchQueries?.length ? claimed.searchQueries : [claimed.searchQuery]).filter(Boolean);
    for (const tag of hashtags) {
      if (ordered.length >= minPool) break;
      await report("hashtag", `Browsing #${tag} on Instagram\u2026`, { discovered: ordered.length, target });
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
      await report("keyword", `Searching Instagram for \u201C${query}\u201D\u2026`, {
        discovered: ordered.length,
        target
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
        alreadyInVault > 0 ? "No new creators this time \u2014 everyone we found is already in your vault. Try widening your campaign goals before the next batch." : "We couldn't find any Instagram creators. Make sure you're signed in to Instagram in Chrome, and try broadening your campaign goals."
      );
    }
    await report("profiles", `Looking at ${ordered.length} creator profiles\u2026`, {
      discovered: ordered.length,
      target,
      logMessage: alreadyInVault > 0 ? `Ready to review ${ordered.length} new creators (${alreadyInVault} were already in your vault).` : `Ready to review ${ordered.length} creators.`
    });
    return ordered;
  }
  async function discoverFromLinkedInSearch(searchQuery, maxProfiles, selfSlug, report, target) {
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`;
    const tab = await chrome.tabs.create({ url: searchUrl, active: true });
    if (!tab.id) return [];
    try {
      await waitForTabLoad(tab.id);
      const prepared = await runInTab(
        tab.id,
        "prepareLinkedInPeopleSearch"
      );
      if (!prepared?.ready) {
        if (prepared?.reason === "login_required") {
          throw new Error("Please sign in to LinkedIn in Chrome, then start the mission again.");
        }
        return [];
      }
      const profileUrls = await runInTab(tab.id, "collectLinkedInPeopleUrls", [
        postBudget(maxProfiles),
        selfSlug
      ]);
      await report("keyword", `Found ${profileUrls.length} people matching \u201C${searchQuery}\u201D.`, {
        discovered: profileUrls.length,
        target,
        logMessage: `Searched LinkedIn for \u201C${searchQuery}\u201D: ${profileUrls.length} profiles found.`
      });
      return profileUrls;
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => {
      });
    }
  }
  async function discoverLinkedInProfileUrls(claimed, report) {
    const target = claimed.maxProfiles;
    const multiplier = claimed.audienceFilter?.poolMultiplier ?? DEFAULT_AUDIENCE_FILTER.poolMultiplier;
    const minPool = Math.max(target * multiplier, 8);
    const ordered = [];
    const seen = new Set((claimed.excludeUsernames ?? []).map((u) => u.toLowerCase()));
    const alreadyInVault = seen.size;
    const budgetTarget = Math.ceil(target * multiplier / 2);
    const addUrls = (urls) => {
      for (const url of urls) {
        const canonical = toCanonicalUrl(url, "linkedin");
        const key = creatorKey(url, "linkedin");
        if (!canonical || !key || seen.has(key)) continue;
        seen.add(key);
        ordered.push(canonical);
      }
    };
    if (claimed.seedProfileUrls.length > 0) {
      await report("seeds", `Lining up ${claimed.seedProfileUrls.length} people who look like a fit\u2026`, {
        target
      });
      addUrls(claimed.seedProfileUrls);
      await report("seeds", `Shortlist ready \u2014 ${ordered.length} people to look at.`, {
        discovered: ordered.length,
        target,
        logMessage: `Shortlisted ${ordered.length} LinkedIn profiles who match your campaign.`
      });
    }
    const searchQueries = (claimed.searchQueries?.length ? claimed.searchQueries : [claimed.searchQuery]).filter(Boolean);
    for (const query of searchQueries) {
      if (ordered.length >= minPool) break;
      await report("keyword", `Searching LinkedIn for \u201C${query}\u201D\u2026`, {
        discovered: ordered.length,
        target
      });
      const fromSearch = await discoverFromLinkedInSearch(
        query,
        budgetTarget,
        null,
        report,
        target
      );
      addUrls(fromSearch);
    }
    if (ordered.length === 0) {
      throw new Error(
        alreadyInVault > 0 ? "No new people this time \u2014 everyone we found is already in your vault. Try widening your campaign goals before the next batch." : "We couldn't find LinkedIn profiles. Make sure you're signed in to LinkedIn in Chrome, and try broadening your campaign goals."
      );
    }
    await report("profiles", `Looking at ${ordered.length} LinkedIn profiles\u2026`, {
      discovered: ordered.length,
      target,
      logMessage: alreadyInVault > 0 ? `Ready to review ${ordered.length} new people (${alreadyInVault} were already in your vault).` : `Ready to review ${ordered.length} people.`
    });
    return ordered;
  }
  async function discoverFromXSearch(searchQuery, maxProfiles, selfHandle, report, target) {
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(searchQuery)}&src=typed_query&f=user`;
    const tab = await chrome.tabs.create({ url: searchUrl, active: true });
    if (!tab.id) return [];
    try {
      await waitForTabLoad(tab.id);
      const prepared = await runInTab(tab.id, "prepareXUserSearch");
      if (!prepared?.ready) {
        if (prepared?.reason === "login_required") {
          throw new Error("Please sign in to X in Chrome, then start the mission again.");
        }
        return [];
      }
      const profileUrls = await runInTab(tab.id, "collectXUserUrls", [
        postBudget(maxProfiles),
        selfHandle
      ]);
      await report("keyword", `Found ${profileUrls.length} accounts matching \u201C${searchQuery}\u201D.`, {
        discovered: profileUrls.length,
        target,
        logMessage: `Searched X for \u201C${searchQuery}\u201D: ${profileUrls.length} accounts found.`
      });
      return profileUrls;
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => {
      });
    }
  }
  async function discoverTwitterProfileUrls(claimed, report) {
    const target = claimed.maxProfiles;
    const multiplier = claimed.audienceFilter?.poolMultiplier ?? DEFAULT_AUDIENCE_FILTER.poolMultiplier;
    const minPool = Math.max(target * multiplier, 8);
    const ordered = [];
    const seen = new Set((claimed.excludeUsernames ?? []).map((u) => u.toLowerCase()));
    const alreadyInVault = seen.size;
    const budgetTarget = Math.ceil(target * multiplier / 2);
    const addUrls = (urls) => {
      for (const url of urls) {
        const canonical = toCanonicalUrl(url, "twitter");
        const key = creatorKey(url, "twitter");
        if (!canonical || !key || seen.has(key)) continue;
        seen.add(key);
        ordered.push(canonical);
      }
    };
    if (claimed.seedProfileUrls.length > 0) {
      await report("seeds", `Lining up ${claimed.seedProfileUrls.length} accounts who look like a fit\u2026`, {
        target
      });
      addUrls(claimed.seedProfileUrls);
      await report("seeds", `Shortlist ready \u2014 ${ordered.length} accounts to look at.`, {
        discovered: ordered.length,
        target,
        logMessage: `Shortlisted ${ordered.length} X accounts who match your campaign.`
      });
    }
    const searchQueries = (claimed.searchQueries?.length ? claimed.searchQueries : [claimed.searchQuery]).filter(Boolean);
    for (const query of searchQueries) {
      if (ordered.length >= minPool) break;
      await report("keyword", `Searching X for \u201C${query}\u201D\u2026`, {
        discovered: ordered.length,
        target
      });
      const fromSearch = await discoverFromXSearch(query, budgetTarget, null, report, target);
      addUrls(fromSearch);
    }
    if (ordered.length === 0) {
      throw new Error(
        alreadyInVault > 0 ? "No new accounts this time \u2014 everyone we found is already in your vault. Try widening your campaign goals before the next batch." : "We couldn't find X accounts. Make sure you're signed in to X in Chrome, and try broadening your campaign goals."
      );
    }
    await report("profiles", `Looking at ${ordered.length} X profiles\u2026`, {
      discovered: ordered.length,
      target,
      logMessage: alreadyInVault > 0 ? `Ready to review ${ordered.length} new accounts (${alreadyInVault} were already in your vault).` : `Ready to review ${ordered.length} accounts.`
    });
    return ordered;
  }
  async function discoverProfileUrls(claimed, report) {
    if (claimed.platform === "linkedin") return discoverLinkedInProfileUrls(claimed, report);
    if (claimed.platform === "twitter") return discoverTwitterProfileUrls(claimed, report);
    return discoverInstagramProfileUrls(claimed, report);
  }
  async function runExtensionJob(jobId, idToken, projectId, useFunctionsEmulator) {
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
      const claimed = await callFunction(
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
          logMessage: `Where we're looking: ${claimed.searchSummary}`
        });
      }
      const profileUrls = await discoverProfileUrls(claimed, report);
      let saved = claimed.processedCount ?? 0;
      let skippedSize = 0;
      let skippedQuality = 0;
      const target = claimed.maxProfiles;
      const audienceFilter = claimed.audienceFilter ?? DEFAULT_AUDIENCE_FILTER;
      const scrapeMethod = scrapeMethodFor(claimed.platform);
      for (let i = 0; i < profileUrls.length; i += 1) {
        if (saved >= target) break;
        const profileUrl = profileUrls[i];
        const username = creatorKey(profileUrl, claimed.platform) ?? instagramUsernameFromUrl(profileUrl) ?? "creator";
        await report("profiles", `Checking ${username} (${i + 1} of ${profileUrls.length})\u2026`, {
          discovered: saved,
          target
        });
        const tab = await chrome.tabs.create({ url: profileUrl, active: false });
        if (!tab.id) continue;
        try {
          await waitForTabLoad(tab.id);
          const profile = await runInTab(tab.id, scrapeMethod);
          if (!profile?.username) continue;
          const rejection = audienceRejectReason(profile, audienceFilter);
          if (rejection) {
            if (rejection.kind === "size") skippedSize += 1;
            else skippedQuality += 1;
            await report("profiles", `Passed on ${username} \u2014 ${rejection.reason}.`, {
              discovered: saved,
              target
            });
            continue;
          }
          const submit = await callFunction(
            projectId,
            "submitOpticExtensionLead",
            idToken,
            { jobId, profile: { ...profile, profileUrl } },
            useFunctionsEmulator
          );
          if (!submit.ok) {
            if (submit.reason === "cancelled" || submit.reason === "insufficient_credits") break;
            continue;
          }
          saved = submit.processedCount ?? saved + 1;
          await report("profiles", `Added ${saved} of ${target} creators to your vault.`, {
            discovered: saved,
            target
          });
        } catch {
        } finally {
          await chrome.tabs.remove(tab.id).catch(() => {
          });
          await sleep(profilePauseMs(target, claimed.platform));
        }
      }
      const skipNotes = [];
      if (skippedSize > 0) skipNotes.push(`${skippedSize} outside your audience size`);
      if (skippedQuality > 0) {
        skipNotes.push(`${skippedQuality} with inactive or empty profiles`);
      }
      const filteredNote = skipNotes.length > 0 ? ` Passed on ${skipNotes.join(" and ")}.` : "";
      await report("done", `All done \u2014 added ${saved} of ${target} creators to your vault.`, {
        discovered: saved,
        target,
        logMessage: `Finished with ${saved} of ${target} creators.${filteredNote}`
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
      ).catch(() => {
      });
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
        jobId: state.jobId
      });
      return true;
    }
    if (message?.type === "OPTIC_START_JOB") {
      const { jobId, idToken, projectId, useFunctionsEmulator } = message;
      if (state.running) {
        sendResponse({
          ok: false,
          error: "A mission is already running in Chrome. Let it finish, then start the next one."
        });
        return true;
      }
      void runExtensionJob(jobId, idToken, projectId, useFunctionsEmulator === true).catch(() => {
      });
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();

"use strict";
(() => {
  // src/instagram/scrape.ts
  var IG_SKIP_HANDLES = /* @__PURE__ */ new Set([
    "p",
    "reel",
    "reels",
    "tv",
    "stories",
    "explore",
    "accounts",
    "direct",
    "tags",
    "about",
    "legal",
    "privacy",
    "help",
    "login",
    "popular",
    "www"
  ]);
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function normalizePostUrl(href) {
    try {
      const url = href.startsWith("http") ? new URL(href) : new URL(href, "https://www.instagram.com");
      const path = url.pathname;
      if (!path.includes("/p/") && !path.includes("/reel/")) return null;
      return `https://www.instagram.com${path}`.replace(/\/$/, "") + "/";
    } catch {
      return null;
    }
  }
  function isProfileHandle(handle) {
    const lower = handle.toLowerCase();
    if (IG_SKIP_HANDLES.has(lower)) return false;
    if (handle.length < 2 || handle.length > 30) return false;
    return /^[A-Za-z0-9._]+$/.test(handle);
  }
  function detectLoggedInUsername() {
    const navProfile = document.querySelector(
      `a[href^="/"][href$="/"] img[alt*="profile picture" i], a[href^="/"][href$="/"] img[alt*="'s profile picture" i]`
    );
    const href = navProfile?.closest("a")?.getAttribute("href") || "";
    const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (match && isProfileHandle(match[1])) return match[1];
    return null;
  }
  function countHashtagPosts() {
    return document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]').length;
  }
  async function prepareHashtagExplore() {
    const path = window.location.pathname;
    if (path.includes("/accounts/login")) {
      return { ready: false, reason: "login_required" };
    }
    if (!path.includes("/explore/tags/")) {
      return { ready: false, reason: "wrong_page" };
    }
    const deadline = Date.now() + 25e3;
    while (Date.now() < deadline && countHashtagPosts() < 3) {
      await sleep(900);
    }
    if (countHashtagPosts() === 0) {
      const bodyText = document.body.innerText.toLowerCase();
      if (bodyText.includes("log in") && bodyText.includes("sign up")) {
        return { ready: false, reason: "login_required" };
      }
      return { ready: false, reason: "no_posts" };
    }
    const scrollTarget = document.querySelector("main") ?? document.documentElement;
    for (let round = 0; round < 6; round += 1) {
      scrollTarget.scrollTop = scrollTarget.scrollHeight;
      await sleep(1400 + round * 200);
    }
    scrollTarget.scrollTop = 0;
    await sleep(600);
    return { ready: countHashtagPosts() > 0 };
  }
  function collectHashtagPostUrls(maxPosts) {
    const seen = /* @__PURE__ */ new Set();
    const urls = [];
    document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]').forEach((node) => {
      const href = node.href || node.getAttribute("href") || "";
      const normalized = normalizePostUrl(href);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      urls.push(normalized);
    });
    return urls.slice(0, maxPosts);
  }
  function countKeywordAccounts() {
    let count = 0;
    document.querySelectorAll('main a[href^="/"]').forEach((node) => {
      const href = node.getAttribute("href") || "";
      const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (match && isProfileHandle(match[1])) count += 1;
    });
    return count;
  }
  async function prepareKeywordSearch() {
    const path = window.location.pathname;
    if (path.includes("/accounts/login")) {
      return { ready: false, reason: "login_required" };
    }
    if (!path.includes("/explore/search/")) {
      return { ready: false, reason: "wrong_page" };
    }
    const deadline = Date.now() + 25e3;
    while (Date.now() < deadline && countKeywordAccounts() < 2) {
      await sleep(900);
    }
    if (countKeywordAccounts() === 0) {
      return { ready: false, reason: "no_accounts" };
    }
    const scrollTarget = document.querySelector("main") ?? document.documentElement;
    for (let round = 0; round < 5; round += 1) {
      scrollTarget.scrollTop = scrollTarget.scrollHeight;
      await sleep(1200 + round * 150);
    }
    await sleep(500);
    return { ready: countKeywordAccounts() > 0 };
  }
  function collectKeywordAccountUrls(maxAccounts, excludeUsername) {
    const exclude = excludeUsername?.toLowerCase() ?? null;
    const seen = /* @__PURE__ */ new Set();
    const urls = [];
    document.querySelectorAll('main a[href^="/"]').forEach((node) => {
      const href = node.getAttribute("href") || "";
      const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (!match) return;
      const handle = match[1];
      if (!isProfileHandle(handle)) return;
      if (exclude && handle.toLowerCase() === exclude) return;
      const key = handle.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      urls.push(`https://www.instagram.com/${handle}/`);
    });
    return urls.slice(0, maxAccounts);
  }
  function scrapePostAuthor(excludeUsername) {
    const exclude = excludeUsername?.toLowerCase() ?? null;
    const candidates = [];
    const pushHandle = (href) => {
      const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (!match) return;
      const handle = match[1];
      if (!isProfileHandle(handle)) return;
      if (exclude && handle.toLowerCase() === exclude) return;
      candidates.push(handle);
    };
    document.querySelectorAll("header a[href^='/']").forEach((node) => {
      pushHandle(node.getAttribute("href") || "");
    });
    document.querySelectorAll('article a[href^="/"]').forEach((node) => {
      const href = node.getAttribute("href") || "";
      if (href.includes("/p/") || href.includes("/reel/")) return;
      pushHandle(href);
    });
    return candidates[0] ?? null;
  }
  var EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  var OBFUSCATED_EMAIL_RE = /([a-zA-Z0-9._%+-]+)\s*(?:\[?\s*at\s*\]?|\(@\)|\(at\))\s*([a-zA-Z0-9.-]+)\s*(?:\[?\s*dot\s*\]?|\(\.\))\s*([a-zA-Z]{2,})/gi;
  function normalizeEmail(raw) {
    if (!raw) return null;
    const trimmed = raw.trim().toLowerCase().replace(/^mailto:/i, "");
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed)) return null;
    if (trimmed.endsWith("@instagram.com") || trimmed.endsWith("@fb.com")) return null;
    return trimmed;
  }
  function extractEmailsFromText(text) {
    if (!text) return [];
    const found = /* @__PURE__ */ new Set();
    for (const match of text.matchAll(EMAIL_RE)) {
      const email = normalizeEmail(match[0]);
      if (email) found.add(email);
    }
    for (const match of text.matchAll(OBFUSCATED_EMAIL_RE)) {
      const email = normalizeEmail(`${match[1]}@${match[2]}.${match[3]}`);
      if (email) found.add(email);
    }
    return Array.from(found);
  }
  function collectMailtoEmails(root = document) {
    const found = /* @__PURE__ */ new Set();
    root.querySelectorAll('a[href^="mailto:"]').forEach((node) => {
      const href = node.getAttribute("href") || "";
      const email = normalizeEmail(href.split("?")[0]);
      if (email) found.add(email);
    });
    return Array.from(found);
  }
  function scrapeBio(header, displayName) {
    if (!header) return null;
    const skip = new Set(
      [displayName, "Follow", "Following", "Message", "Email", "Contact", "Options"].filter(Boolean).map((s) => String(s).trim().toLowerCase())
    );
    let best = null;
    header.querySelectorAll("span, div").forEach((node) => {
      if (node.querySelector("span, div")) return;
      const text = node.textContent?.trim();
      if (!text || text.length < 3 || text.length > 600) return;
      if (/^\d/.test(text)) return;
      if (/\b(followers|following|posts)\b/i.test(text) && text.length < 40) return;
      if (skip.has(text.toLowerCase())) return;
      if (!best || text.length > best.length) best = text;
    });
    return best;
  }
  function scrapeAvatarSourceUrl(header, username) {
    const imgs = header ? header.querySelectorAll("img") : document.querySelectorAll('header img, main img[alt*="profile picture" i]');
    for (const node of Array.from(imgs)) {
      const img = node;
      const alt = (img.getAttribute("alt") || "").toLowerCase();
      const src = img.currentSrc || img.src || img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) continue;
      if (alt.includes("profile picture") || alt.includes(`@${username.toLowerCase()}`) || alt.includes(`${username.toLowerCase()}'s`)) {
        return src;
      }
    }
    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og && /^https:\/\//i.test(og)) return og;
    return null;
  }
  async function fetchAvatarAsJpegDataUrl(src, maxSide = 256) {
    try {
      const res = await fetch(src, { credentials: "omit", mode: "cors", cache: "force-cache" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/") || blob.size < 32) return null;
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      if (dataUrl.length > 16e5) return null;
      return dataUrl;
    } catch {
      return null;
    }
  }
  async function scrapeInstagramProfile() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const profile = scrapeInstagramProfileOnce();
      if (profile && (profile.followerCount || profile.bio || profile.displayName || profile.email)) {
        if (profile.avatarUrl && !profile.avatarDataUrl) {
          profile.avatarDataUrl = await fetchAvatarAsJpegDataUrl(profile.avatarUrl);
        }
        return profile;
      }
      await sleep(1e3);
    }
    const fallback = scrapeInstagramProfileOnce();
    if (fallback?.avatarUrl && !fallback.avatarDataUrl) {
      fallback.avatarDataUrl = await fetchAvatarAsJpegDataUrl(fallback.avatarUrl);
    }
    return fallback;
  }
  function scrapeInstagramProfileOnce() {
    const pathMatch = window.location.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (!pathMatch) return null;
    const username = pathMatch[1];
    if (!isProfileHandle(username)) return null;
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    const displayName = document.querySelector("header h2, header h1")?.textContent?.trim() || ogTitle?.split("(")[0]?.trim() || null;
    const header = document.querySelector("header");
    const bio = scrapeBio(header, displayName);
    let followerCount = null;
    const followerMatch = document.body.innerText.match(/([\d,.]+[KMB]?)\s+followers/i);
    if (followerMatch) followerCount = followerMatch[1];
    let postCount = null;
    const postMatch = document.body.innerText.match(/([\d,.]+[KMB]?)\s+posts?\b/i);
    if (postMatch) postCount = postMatch[1];
    let externalUrl = null;
    const extLink = document.querySelector(
      'header a[rel~="me"], header a[href^="http"]:not([href*="instagram.com"]):not([href^="mailto:"])'
    );
    if (extLink) externalUrl = extLink.href;
    const mailtoEmails = collectMailtoEmails(header ?? document);
    const textEmails = [
      ...extractEmailsFromText(bio),
      ...extractEmailsFromText(header?.innerText ?? null),
      ...extractEmailsFromText(externalUrl)
    ];
    document.querySelectorAll('a, button, div[role="button"]').forEach((node) => {
      const label = node.textContent?.trim() ?? "";
      if (!/^e-?mail$/i.test(label) && !/contact/i.test(label)) return;
      const nearby = (node.parentElement?.innerText || node.textContent || "").trim();
      textEmails.push(...extractEmailsFromText(nearby));
    });
    const email = mailtoEmails[0] ?? textEmails[0] ?? null;
    const avatarUrl = scrapeAvatarSourceUrl(header, username);
    return {
      username,
      displayName,
      bio,
      followerCount,
      postCount,
      externalUrl,
      email,
      avatarUrl,
      avatarDataUrl: null
    };
  }

  // src/shared/avatar.ts
  async function fetchAvatarAsJpegDataUrl2(src, maxSide = 256) {
    try {
      const res = await fetch(src, { credentials: "omit", mode: "cors", cache: "force-cache" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/") || blob.size < 32) return null;
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      if (dataUrl.length > 16e5) return null;
      return dataUrl;
    } catch {
      return null;
    }
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

  // src/linkedin/scrape.ts
  function sleep2(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function isLoginWall() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes("/login") || path.includes("/authwall") || path.includes("/checkpoint") || path.includes("/uas/login")) {
      return true;
    }
    const host = window.location.hostname.toLowerCase();
    if (host.startsWith("login.")) return true;
    const body = document.body?.innerText?.slice(0, 2e3).toLowerCase() || "";
    if (document.querySelectorAll('a[href*="/in/"]').length > 0) return false;
    return body.includes("sign in") && body.includes("join now");
  }
  function detectLoggedInLinkedInSlug() {
    const candidates = [
      document.querySelector(".global-nav__me a[href*='/in/']"),
      document.querySelector("a[href*='/in/'] img.global-nav__me-photo")?.closest("a"),
      document.querySelector('a[data-control-name="identity_welcome_message"]')
    ];
    for (const el of candidates) {
      const href = el?.href;
      const slug = href ? linkedinSlugFromUrl(href) : null;
      if (slug) return slug;
    }
    return null;
  }
  function collectPeopleUrls(cap, excludeSlug) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const skipSelf = excludeSlug?.toLowerCase() ?? "";
    document.querySelectorAll('a[href*="/in/"]').forEach((a) => {
      const slug = linkedinSlugFromUrl(a.href);
      if (!slug) return;
      const key = slug.toLowerCase();
      if (key === skipSelf || seen.has(key)) return;
      seen.add(key);
      out.push(linkedinProfileUrl(slug));
    });
    return out.slice(0, cap);
  }
  async function prepareLinkedInPeopleSearch() {
    if (isLoginWall()) return { ready: false, reason: "login_required" };
    if (!/\/search\/results\/people/i.test(window.location.pathname)) {
      return { ready: false, reason: "wrong_page" };
    }
    const deadline = Date.now() + 25e3;
    while (Date.now() < deadline && collectPeopleUrls(3, null).length < 1) {
      window.scrollBy(0, 800);
      await sleep2(900);
    }
    if (collectPeopleUrls(1, null).length === 0) {
      return { ready: false, reason: isLoginWall() ? "login_required" : "no_results" };
    }
    return { ready: true };
  }
  async function collectLinkedInPeopleUrls(cap, excludeSlug) {
    const exclude = excludeSlug ?? detectLoggedInLinkedInSlug();
    for (let i = 0; i < 8; i += 1) {
      window.scrollBy(0, 1400);
      const more = document.querySelector(
        'button[aria-label*="more" i], button.infinite-scroller__show-more-button'
      );
      more?.click();
      await sleep2(800);
      if (collectPeopleUrls(cap, exclude).length >= cap) break;
    }
    return collectPeopleUrls(cap, exclude);
  }
  function scrapeLinkedInProfileOnce() {
    if (isLoginWall()) return null;
    const slug = linkedinSlugFromUrl(window.location.href);
    if (!slug) return null;
    const displayName = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.split("|")[0]?.trim() || null;
    const headline = document.querySelector(".text-body-medium.break-words")?.textContent?.replace(/\s+/g, " ").trim() || document.querySelector(".pv-text-details__left-panel .text-body-medium")?.textContent?.replace(/\s+/g, " ").trim() || document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() || null;
    const about = document.querySelector("#about ~ .display-flex .inline-show-more-text")?.textContent?.replace(/\s+/g, " ").trim() || null;
    const bio = [headline, about].filter(Boolean).join(" \u2014 ") || headline || about;
    const body = document.body?.innerText?.slice(0, 5e3) || "";
    const followerMatch = body.match(/([\d.,]+[KMB]?\+?)\s+(followers?|connections?)/i);
    const followerCount = followerMatch ? followerMatch[1] : null;
    let externalUrl = null;
    const links = Array.from(
      document.querySelectorAll(
        ".pv-text-details__left-panel a[href], .pv-top-card a[href], section.pv-contact-info a[href]"
      )
    );
    for (const a of links) {
      const href = a.href;
      if (!href || /linkedin\.com|javascript:/i.test(href)) continue;
      if (href.startsWith("mailto:")) continue;
      if (/^https?:\/\//i.test(href)) {
        externalUrl = href;
        break;
      }
    }
    const mailto = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.href.replace(/^mailto:/i, "").split("?")[0].trim()).find((e) => e.includes("@")) || null;
    let avatarUrl = null;
    const imgs = document.querySelectorAll(
      ".pv-top-card-profile-picture img, .pv-top-card img, button.pv-top-card-profile-picture img, img.profile-photo-edit__preview"
    );
    for (const node of Array.from(imgs)) {
      const img = node;
      const src = img.currentSrc || img.src || "";
      if (src && !src.startsWith("data:") && /^https?:\/\//i.test(src)) {
        avatarUrl = src;
        break;
      }
    }
    if (!avatarUrl) {
      const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
      if (og && /^https:\/\//i.test(og)) avatarUrl = og;
    }
    return {
      username: slug,
      displayName,
      bio,
      followerCount,
      postCount: null,
      externalUrl,
      email: mailto,
      avatarUrl,
      avatarDataUrl: null,
      profileUrl: linkedinProfileUrl(slug)
    };
  }
  async function scrapeLinkedInProfile() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const profile = scrapeLinkedInProfileOnce();
      if (profile && (profile.followerCount || profile.bio || profile.displayName)) {
        if (profile.avatarUrl && !profile.avatarDataUrl) {
          profile.avatarDataUrl = await fetchAvatarAsJpegDataUrl2(profile.avatarUrl);
        }
        return profile;
      }
      await sleep2(1e3);
    }
    const fallback = scrapeLinkedInProfileOnce();
    if (fallback?.avatarUrl && !fallback.avatarDataUrl) {
      fallback.avatarDataUrl = await fetchAvatarAsJpegDataUrl2(fallback.avatarUrl);
    }
    return fallback;
  }

  // src/x/scrape.ts
  function sleep3(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function isLoginWall2() {
    const href = window.location.href.toLowerCase();
    if (href.includes("/i/flow/login") || href.includes("login.x.com") || href.includes("/login")) {
      return true;
    }
    const body = document.body?.innerText?.slice(0, 1500).toLowerCase() || "";
    if (document.querySelector('[data-testid="UserCell"], [data-testid="UserName"]')) return false;
    return body.includes("sign in to x") || body.includes("log in") && body.includes("sign up");
  }
  function detectLoggedInXHandle() {
    const me = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    return me?.href ? twitterHandleFromUrl(me.href) : null;
  }
  function collectUserUrls(cap, excludeHandle) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const skipSelf = excludeHandle?.toLowerCase() ?? "";
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      const handle = twitterHandleFromUrl(href);
      if (!handle) return;
      const key = handle.toLowerCase();
      if (key === skipSelf || seen.has(key)) return;
      seen.add(key);
      out.push(twitterProfileUrl(handle));
    });
    return out.slice(0, cap);
  }
  async function prepareXUserSearch() {
    if (isLoginWall2()) return { ready: false, reason: "login_required" };
    if (!/\/search/i.test(window.location.pathname)) {
      return { ready: false, reason: "wrong_page" };
    }
    const deadline = Date.now() + 25e3;
    while (Date.now() < deadline && collectUserUrls(3, null).length < 1) {
      window.scrollBy(0, 900);
      await sleep3(900);
    }
    if (collectUserUrls(1, null).length === 0) {
      return { ready: false, reason: isLoginWall2() ? "login_required" : "no_results" };
    }
    return { ready: true };
  }
  async function collectXUserUrls(cap, excludeHandle) {
    const exclude = excludeHandle ?? detectLoggedInXHandle();
    for (let i = 0; i < 8; i += 1) {
      window.scrollBy(0, 1400);
      await sleep3(700);
      if (collectUserUrls(cap, exclude).length >= cap) break;
    }
    return collectUserUrls(cap, exclude);
  }
  function scrapeXProfileOnce() {
    if (isLoginWall2()) return null;
    const handle = twitterHandleFromUrl(window.location.href);
    if (!handle) return null;
    const nameBlock = document.querySelector('[data-testid="UserName"]');
    const displayName = nameBlock?.querySelector("span")?.textContent?.trim() || document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.split("(")[0]?.trim() || null;
    const bio = document.querySelector('[data-testid="UserDescription"]')?.textContent?.replace(/\s+/g, " ").trim() || document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() || null;
    const followerLink = document.querySelector('a[href$="/verified_followers"]') || document.querySelector('a[href$="/followers"]');
    const followerCount = followerLink?.textContent?.match(/([\d.,]+[KMB]?\+?)/i)?.[1] || document.body.innerText.match(/([\d.,]+[KMB]?\+?)\s+Followers/i)?.[1] || null;
    const postCount = document.body.innerText.match(/([\d.,]+[KMB]?\+?)\s+Posts?/i)?.[1] || null;
    const urlNode = document.querySelector(
      '[data-testid="UserUrl"] a, [data-testid="UserProfileHeader_Items"] a[href^="http"]'
    );
    const externalUrl = urlNode && !/x\.com|twitter\.com/i.test(urlNode.href) ? urlNode.href : null;
    const mailto = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.href.replace(/^mailto:/i, "").split("?")[0].trim()).find((e) => e.includes("@")) || null;
    let avatarUrl = null;
    const avatar = document.querySelector(
      `[data-testid="UserAvatar-Container-${handle}"] img, a[href$="/photo"] img`
    );
    const src = avatar?.currentSrc || avatar?.src || "";
    if (src && /^https?:\/\//i.test(src)) avatarUrl = src;
    if (!avatarUrl) {
      const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
      if (og && /^https:\/\//i.test(og)) avatarUrl = og;
    }
    return {
      username: handle,
      displayName,
      bio,
      followerCount,
      postCount,
      externalUrl,
      email: mailto,
      avatarUrl,
      avatarDataUrl: null,
      profileUrl: twitterProfileUrl(handle)
    };
  }
  async function scrapeXProfile() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const profile = scrapeXProfileOnce();
      if (profile && (profile.followerCount || profile.bio || profile.displayName)) {
        if (profile.avatarUrl && !profile.avatarDataUrl) {
          profile.avatarDataUrl = await fetchAvatarAsJpegDataUrl2(profile.avatarUrl);
        }
        return profile;
      }
      await sleep3(1e3);
    }
    const fallback = scrapeXProfileOnce();
    if (fallback?.avatarUrl && !fallback.avatarDataUrl) {
      fallback.avatarDataUrl = await fetchAvatarAsJpegDataUrl2(fallback.avatarUrl);
    }
    return fallback;
  }

  // src/injected.ts
  window.__VERZA_OPTIC = {
    prepareHashtagExplore,
    collectHashtagPostUrls,
    prepareKeywordSearch,
    collectKeywordAccountUrls,
    scrapePostAuthor,
    detectLoggedInUsername,
    scrapeInstagramProfile,
    prepareLinkedInPeopleSearch,
    collectLinkedInPeopleUrls,
    scrapeLinkedInProfile,
    detectLoggedInLinkedInSlug,
    prepareXUserSearch,
    collectXUserUrls,
    scrapeXProfile,
    detectLoggedInXHandle
  };
})();

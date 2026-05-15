import * as dotenv from "dotenv";
import * as path from "path";
import { app, BrowserWindow, ipcMain } from "electron";
import { createVetBrowserContext, scrapeCreatorProfileInContext } from "./scraper";
import { analyzeProfileWithGemini } from "./vision";
import { saveLeadToFirestore, getLeads } from "./storage";
import { findCreators, generateSeedLeads } from "./search";
import { getAppStatusSnapshot } from "./appStatus";
import { loadAgencyContextFromIdToken } from "./agencyContext";
import type { DraftBrandContext } from "./vision";
import type { BrowserContext } from "playwright";
import { clampMaxProfilesFromUi, getMsBetweenVets } from "./config";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(__dirname, "../.env.local") });
dotenv.config({ path: path.join(__dirname, "../.env") });

// Suppress EPIPE errors when stdout pipe breaks after Electron window launches
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") return;
});
process.stderr.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") return;
});

let authContext: BrowserContext | null = null;
let discoveryCancelRequested = false;

ipcMain.on("cancel-discovery", () => {
  discoveryCancelRequested = true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Verza Optic",
    backgroundColor: "#f5f2ed",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "../index.html"));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith("https://accounts.google.com") ||
      url.includes("firebaseapp.com/__/auth") ||
      url.includes("googleusercontent.com")
    ) {
      return { action: "allow" };
    }
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  if (authContext) {
    authContext.close().catch(() => {});
    authContext = null;
  }
});

app.on("window-all-closed", () => {
  if (authContext) {
    authContext.close().catch(() => {});
    authContext = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle("get-app-status", async () => getAppStatusSnapshot());

ipcMain.handle("get-app-metadata", async () => ({
  name: app.getName(),
  version: app.getVersion(),
}));

ipcMain.handle("get-firebase-web-config", async () => {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !projectId) {
    return {
      ok: false as const,
      error:
        "Missing NEXT_PUBLIC_FIREBASE_API_KEY or NEXT_PUBLIC_FIREBASE_PROJECT_ID. Copy them from apps/web into apps/desktop/.env",
    };
  }
  return {
    ok: true as const,
    config: {
      apiKey,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: storageBucket || "",
      messagingSenderId: messagingSenderId || "",
      appId: appId || "",
    },
  };
});

ipcMain.handle(
  "load-agency-from-token",
  async (_event, { idToken, campaignId }: { idToken: string; campaignId?: string | null }) => {
    try {
      const ctx = await loadAgencyContextFromIdToken(idToken, { campaignId: campaignId ?? undefined });
      return { ok: true as const, ...ctx };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: message };
    }
  }
);

ipcMain.handle("open-auth-browser", async (_event, platform = "youtube") => {
  try {
    if (authContext) {
      await authContext.close().catch(() => {});
      authContext = null;
    }

    const { chromium } = await import("playwright");
    const userDataDir = path.join(app.getPath("userData"), "optic-browser-profile");

    const platformUrls: Record<string, string> = {
      youtube: "https://www.youtube.com",
      instagram: "https://www.instagram.com",
      tiktok: "https://www.tiktok.com",
    };

    authContext = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
    });

    const page = await authContext.newPage();
    await page.goto(platformUrls[platform] || platformUrls.youtube, { timeout: 60_000 });
    return { ok: true as const };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: message };
  }
});

ipcMain.handle(
  "run-discovery",
  async (
    event,
    {
      platform,
      objectives,
      idToken,
      maxProfiles,
      campaignId,
    }: {
      platform: string;
      objectives: string;
      idToken?: string;
      maxProfiles?: number;
      campaignId?: string | null;
    }
  ) => {
    discoveryCancelRequested = false;
    try {
      let brand: DraftBrandContext | null = null;
      let agencyMeta: { agencyId: string; agencyName: string } | undefined;
      if (idToken && typeof idToken === "string") {
        try {
          const full = await loadAgencyContextFromIdToken(idToken, {
            campaignId: campaignId && typeof campaignId === "string" ? campaignId : undefined,
          });
          brand = {
            agencyName: full.agencyName,
            brandSummary: full.brandSummary,
            userDisplayName: full.userDisplayName,
            campaignPaySummary: full.campaignPaySummary,
            paySourceCampaignTitle: full.paySourceCampaignTitle,
          };
          agencyMeta = { agencyId: full.agencyId, agencyName: full.agencyName };
          event.sender.send("log", "search", `Signed in: drafts will use "${full.agencyName}".`);
          if (full.paySourceCampaignId && full.paySourceCampaignTitle) {
            event.sender.send(
              "log",
              "search",
              `Pay + scope locked to campaign: "${full.paySourceCampaignTitle}".`
            );
          } else if (full.activePaidCampaignCount > 0) {
            event.sender.send(
              "log",
              "search",
              `Loaded pay from ${full.activePaidCampaignCount} active Verza campaign(s) for transparent drafts.`
            );
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          event.sender.send("log", "search", `Agency context unavailable (${msg}). Using generic drafts.`);
        }
      }

      const allUrls = new Set<string>();

      event.sender.send("log", "search", `Consulting Gemini knowledge base for top ${platform} creators...`);
      const seedLeads = await generateSeedLeads(platform, objectives, brand?.agencyName);
      seedLeads.forEach((lead) => allUrls.add(lead.url));
      event.sender.send("log", "search", `Knowledge base returned ${seedLeads.length} seed candidates.`);

      if (discoveryCancelRequested) {
        return { success: true as const, processedCount: 0, leads: [], cancelled: true as const };
      }

      event.sender.send("log", "search", `Launching browser scout on ${platform}...`);
      const searchedUrls = await findCreators(platform, objectives);
      searchedUrls.forEach((url) => allUrls.add(url));
      event.sender.send(
        "log",
        "search",
        `Scout returned ${searchedUrls.length} additional leads. ${allUrls.size} unique total.`
      );

      if (allUrls.size === 0) {
        throw new Error("No creators found for the given criteria.");
      }

      const urlList = Array.from(allUrls).sort();
      const cap = clampMaxProfilesFromUi(maxProfiles);
      const toVisit = urlList.slice(0, Math.min(cap, urlList.length));
      if (urlList.length > toVisit.length) {
        event.sender.send(
          "log",
          "search",
          `Found ${urlList.length} unique URLs; deep-vetting the first ${toVisit.length} (cap ${cap}).`
        );
      }

      const results: unknown[] = [];
      const vetContext = await createVetBrowserContext();
      const delayMs = getMsBetweenVets();
      let cancelled = false;

      try {
        for (let i = 0; i < toVisit.length; i++) {
          if (discoveryCancelRequested) {
            cancelled = true;
            event.sender.send("log", "vet", "Mission cancelled by user.");
            break;
          }
          const url = toVisit[i];
          event.sender.send("log", "vet", `Visiting: ${url}`);
          try {
            const imageBase64 = await scrapeCreatorProfileInContext(vetContext, url);
            const leadData = await analyzeProfileWithGemini(imageBase64, objectives, brand);
            event.sender.send("log", "vet", `✓ Qualified: ${leadData.creatorName} (${leadData.niche})`);
            await saveLeadToFirestore(leadData, url, agencyMeta);
            results.push(leadData);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            event.sender.send("log", "vet", `✗ Skipped ${url}: ${msg}`);
          }
          if (i < toVisit.length - 1 && !discoveryCancelRequested && delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      } finally {
        await vetContext.close().catch(() => {});
      }

      if (results.length > 0) {
        event.sender.send("optic-notify", {
          title: "Verza Optic",
          body: `Saved ${results.length} new lead${results.length === 1 ? "" : "s"} to the Vault.`,
        });
      }

      return {
        success: true as const,
        processedCount: results.length,
        leads: results,
        ...(cancelled ? { cancelled: true as const } : {}),
      };
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      return { success: false as const, error: message };
    }
  }
);

ipcMain.handle("get-leads", async () => getLeads(100));

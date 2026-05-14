import * as dotenv from "dotenv";
import * as path from "path";
import { app, BrowserWindow, ipcMain } from "electron";
import { scrapeCreatorProfile } from "./scraper";
import { analyzeProfileWithGemini } from "./vision";
import { saveLeadToFirestore, getLeads } from "./storage";
import { sendSmsNotification } from "./notifications";
import { findCreators, generateSeedLeads } from "./search";
import { getAppStatusSnapshot } from "./appStatus";
import type { BrowserContext } from "playwright";

dotenv.config({ path: path.join(__dirname, "../.env") });

// Suppress EPIPE errors when stdout pipe breaks after Electron window launches
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") return;
});
process.stderr.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") return;
});

let authContext: BrowserContext | null = null;

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

ipcMain.handle("run-discovery", async (event, { platform, objectives }) => {
  try {
    const allUrls = new Set<string>();

    event.sender.send("log", "search", `Consulting Gemini knowledge base for top ${platform} creators...`);
    const seedLeads = await generateSeedLeads(platform, objectives);
    seedLeads.forEach((lead) => allUrls.add(lead.url));
    event.sender.send("log", "search", `Knowledge base returned ${seedLeads.length} seed candidates.`);

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

    const results: unknown[] = [];

    for (const url of allUrls) {
      event.sender.send("log", "vet", `Visiting: ${url}`);
      try {
        const imageBase64 = await scrapeCreatorProfile(url);
        const leadData = await analyzeProfileWithGemini(imageBase64, objectives);
        event.sender.send("log", "vet", `✓ Qualified: ${leadData.creatorName} (${leadData.niche})`);
        await saveLeadToFirestore(leadData, url);
        results.push(leadData);
        await sendSmsNotification(`New lead: ${leadData.creatorName}. Ready for review in Verza.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        event.sender.send("log", "vet", `✗ Skipped ${url}: ${msg}`);
      }
    }

    return { success: true, processedCount: results.length, leads: results };
  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle("get-leads", async () => getLeads(100));

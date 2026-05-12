
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { scrapeCreatorProfile } from './scraper';
import { analyzeProfileWithGemini } from './vision';
import { saveLeadToFirestore, getLeads } from './storage';
import { sendSmsNotification } from './notifications';
import { findCreators, generateSeedLeads } from './search';

// Suppress EPIPE errors when stdout pipe breaks after Electron window launches
process.stdout.on('error', (err: any) => { if (err.code === 'EPIPE') return; });
process.stderr.on('error', (err: any) => { if (err.code === 'EPIPE') return; });

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "Optic",
    backgroundColor: '#f5f2ed',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, '../index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handler: Full Discovery Mission
ipcMain.handle('run-discovery', async (event, { platform, objectives }) => {
  try {
    const allUrls = new Set<string>();

    // Phase 1: Knowledge Synthesis — ask Gemini who are the known best fits
    event.sender.send('log', 'search', `Consulting Gemini knowledge base for top ${platform} creators...`);
    const seedLeads = await generateSeedLeads(platform, objectives);
    seedLeads.forEach(lead => allUrls.add(lead.url));
    event.sender.send('log', 'search', `Knowledge base returned ${seedLeads.length} seed candidates.`);

    // Phase 2: Autonomous Search — visually scout the platform for more
    event.sender.send('log', 'search', `Launching browser scout on ${platform}...`);
    const searchedUrls = await findCreators(platform, objectives);
    searchedUrls.forEach(url => allUrls.add(url));
    event.sender.send('log', 'search', `Scout returned ${searchedUrls.length} additional leads. ${allUrls.size} unique total.`);

    if (allUrls.size === 0) {
      throw new Error(`No creators found for the given criteria.`);
    }

    const results: any[] = [];

    // Phase 3: Visual Vetting — screenshot + Gemini multimodal analysis on each
    for (const url of allUrls) {
      event.sender.send('log', 'vet', `Visiting: ${url}`);
      try {
        const imageBase64 = await scrapeCreatorProfile(url);
        const leadData = await analyzeProfileWithGemini(imageBase64, objectives);
        event.sender.send('log', 'vet', `✓ Qualified: ${leadData.creatorName} (${leadData.niche})`);
        await saveLeadToFirestore(leadData, url);
        results.push(leadData);
        await sendSmsNotification(`New lead: ${leadData.creatorName}. Ready for review in Verza.`);
      } catch (err: any) {
        event.sender.send('log', 'vet', `✗ Skipped ${url}: ${err.message}`);
      }
    }

    return { success: true, processedCount: results.length, leads: results };
  } catch (error: any) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

// IPC Handler: Fetch leads for the Vault view
ipcMain.handle('get-leads', async () => {
  return await getLeads(100);
});

// IPC Handler: Open persistent browser for platform authentication
ipcMain.on('open-auth-browser', async (event, platform = 'youtube') => {
  const { chromium } = require('playwright');
  const userDataDir = path.join(app.getPath('userData'), 'optic-browser-profile');
  
  const platformUrls: Record<string, string> = {
    youtube: 'https://www.youtube.com',
    instagram: 'https://www.instagram.com',
    tiktok: 'https://www.tiktok.com',
  };

  console.log(`[Optic] Opening auth browser for ${platform}...`);
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  await page.goto(platformUrls[platform] || platformUrls.youtube);
});

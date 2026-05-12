
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { scrapeCreatorProfile } from './scraper';
import { analyzeProfileWithGemini } from './vision';
import { saveLeadToFirestore } from './storage';
import { sendSmsNotification } from './notifications';

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    title: "Optic",
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For MVP simplicity, we'll use nodeIntegration
    },
  });

  // In production, we would load a built file
  // For dev, we can load a simple HTML
  win.loadFile(path.join(__dirname, '../index.html'));
  
  // Open DevTools in dev mode
  // win.webContents.openDevTools();
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

import { findCreators } from './search';

// IPC Handler for Discovery Mission
ipcMain.handle('run-discovery', async (event, { platform, objectives }) => {
  try {
    // 1. Search
    event.sender.send('log', 'search', `Hunting for ${platform} creators matching your persona...`);
    const urls = await findCreators(platform, objectives);
    
    if (urls.length === 0) {
      throw new Error(`No creators found for the given criteria.`);
    }

    event.sender.send('log', 'search', `Found ${urls.length} potential partners. Starting deep vetting...`);

    const results = [];

    // 2. Iterate & Process
    for (const url of urls) {
      event.sender.send('log', 'vet', `Evaluating: ${url}`);
      
      try {
        // Scrape
        const imageBase64 = await scrapeCreatorProfile(url);
        
        // Analyze
        const leadData = await analyzeProfileWithGemini(imageBase64, objectives);
        event.sender.send('log', 'vet', `Qualified: ${leadData.creatorName} (${leadData.niche})`);

        // Save
        await saveLeadToFirestore(leadData, url);
        
        results.push(leadData);

        // Notify (throttled/grouped could be better later, but for now 1 by 1)
        await sendSmsNotification(`Optic vetted a new lead: ${leadData.creatorName}. Ready for review.`);
      } catch (err: any) {
        event.sender.send('log', 'vet', `Skipped ${url}: ${err.message}`);
      }
    }

    return { success: true, processedCount: results.length };
  } catch (error: any) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

// New: Handler to open a browser for manual authentication
ipcMain.on('open-auth-browser', async () => {
  const { chromium } = require('playwright');
  const userDataDir = path.join(app.getPath('userData'), 'optic-browser-profile');
  
  console.log(`[Optic] Opening auth browser with profile: ${userDataDir}`);
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  await page.goto('https://www.youtube.com'); // Start with YouTube
});

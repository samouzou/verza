
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
    title: "Verza Optic",
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

// IPC Handler for Discovery
ipcMain.handle('run-discovery', async (event, { url, objectives }) => {
  try {
    event.sender.send('log', `Starting discovery for: ${url}`);
    
    // 1. Scrape
    const imageBase64 = await scrapeCreatorProfile(url);
    event.sender.send('log', `Screenshot captured.`);

    // 2. Analyze
    const leadData = await analyzeProfileWithGemini(imageBase64, objectives);
    event.sender.send('log', `Gemini analysis complete: ${leadData.creatorName}`);

    // 3. Save
    await saveLeadToFirestore(leadData, url);
    event.sender.send('log', `Lead saved to Firestore.`);

    // 4. Notify
    const notificationMsg = `Found creator: ${leadData.creatorName} (${leadData.niche}). Draft created.`;
    await sendSmsNotification(notificationMsg);
    
    return { success: true, leadData };
  } catch (error: any) {
    console.error(error);
    event.sender.send('log', `Error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

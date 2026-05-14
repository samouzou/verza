import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

export type AppStatus = {
  firestore: boolean;
  gemini: boolean;
  twilio: boolean;
};

contextBridge.exposeInMainWorld("optic", {
  runDiscovery: (payload: { platform: string; objectives: string }) =>
    ipcRenderer.invoke("run-discovery", payload) as Promise<{
      success: boolean;
      processedCount?: number;
      leads?: unknown[];
      error?: string;
    }>,

  getLeads: () => ipcRenderer.invoke("get-leads") as Promise<unknown[]>,

  getAppStatus: () => ipcRenderer.invoke("get-app-status") as Promise<AppStatus>,

  openAuthBrowser: (platform: string) =>
    ipcRenderer.invoke("open-auth-browser", platform) as Promise<{ ok: boolean; error?: string }>,

  onLog: (handler: (stepId: string, msg: string) => void) => {
    const listener = (_event: IpcRendererEvent, stepId: string, msg: string) =>
      handler(stepId, msg);
    ipcRenderer.on("log", listener);
    return () => {
      ipcRenderer.removeListener("log", listener);
    };
  },
});

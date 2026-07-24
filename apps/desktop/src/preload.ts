import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

export type AppStatus = {
  firestore: boolean;
  gemini: boolean;
  twilio: boolean;
  firebaseWeb: boolean;
};

contextBridge.exposeInMainWorld("optic", {
  getAppMetadata: () =>
    ipcRenderer.invoke("get-app-metadata") as Promise<{ name: string; version: string }>,

  cancelDiscovery: () => {
    ipcRenderer.send("cancel-discovery");
  },

  getFirebaseWebConfig: () =>
    ipcRenderer.invoke("get-firebase-web-config") as Promise<
      | { ok: true; config: Record<string, string> }
      | { ok: false; error: string }
    >,

  loadAgencyFromToken: (idToken: string, campaignId?: string | null) =>
    ipcRenderer.invoke("load-agency-from-token", { idToken, campaignId }) as Promise<
      | ({
          ok: true;
          agencyId: string;
          agencyName: string;
          brandSummary: string | null;
          userEmail: string | null;
          userDisplayName: string | null;
          campaignPaySummary: string | null;
          activePaidCampaignCount: number;
          campaignOptions: Array<{
            id: string;
            title: string;
            status: string;
            ratePerCreator: number;
            campaignType: string;
            platforms: string[];
          }>;
          paySourceCampaignId: string | null;
          paySourceCampaignTitle: string | null;
          paySourceCampaignType: string | null;
        })
      | { ok: false; error: string }
    >,

  runDiscovery: (payload: {
    platform: string;
    objectives: string;
    idToken?: string;
    maxProfiles?: number;
    campaignId?: string | null;
  }) =>
    ipcRenderer.invoke("run-discovery", payload) as Promise<{
      success: boolean;
      processedCount?: number;
      leads?: unknown[];
      error?: string;
      cancelled?: boolean;
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

  onNotify: (handler: (payload: { title: string; body: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { title: string; body: string }) =>
      handler(payload);
    ipcRenderer.on("optic-notify", listener);
    return () => {
      ipcRenderer.removeListener("optic-notify", listener);
    };
  },
});

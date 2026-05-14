export {};

declare global {
  interface Window {
    optic: {
      runDiscovery: (payload: {
        platform: string;
        objectives: string;
      }) => Promise<{
        success: boolean;
        processedCount?: number;
        leads?: unknown[];
        error?: string;
      }>;
      getLeads: () => Promise<Record<string, unknown>[]>;
      getAppStatus: () => Promise<{
        firestore: boolean;
        gemini: boolean;
        twilio: boolean;
      }>;
      openAuthBrowser: (
        platform: string
      ) => Promise<{ ok: boolean; error?: string }>;
      onLog: (handler: (stepId: string, msg: string) => void) => () => void;
    };
  }
}

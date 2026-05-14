export {};

declare global {
  interface Window {
    optic: {
      getFirebaseWebConfig: () => Promise<
        | { ok: true; config: Record<string, string> }
        | { ok: false; error: string }
      >;
      loadAgencyFromToken: (idToken: string) => Promise<
        | {
            ok: true;
            agencyId: string;
            agencyName: string;
            brandSummary: string | null;
            userEmail: string | null;
            userDisplayName: string | null;
          }
        | { ok: false; error: string }
      >;
      runDiscovery: (payload: {
        platform: string;
        objectives: string;
        idToken?: string;
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

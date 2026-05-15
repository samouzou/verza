export {};

declare global {
  interface Window {
    optic: {
      getAppMetadata: () => Promise<{ name: string; version: string }>;
      cancelDiscovery: () => void;
      getFirebaseWebConfig: () => Promise<
        | { ok: true; config: Record<string, string> }
        | { ok: false; error: string }
      >;
      loadAgencyFromToken: (
        idToken: string,
        campaignId?: string | null
      ) => Promise<
        | {
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
          }
        | { ok: false; error: string }
      >;
      runDiscovery: (payload: {
        platform: string;
        objectives: string;
        idToken?: string;
        maxProfiles?: number;
        campaignId?: string | null;
      }) => Promise<{
        success: boolean;
        processedCount?: number;
        leads?: unknown[];
        error?: string;
        cancelled?: boolean;
      }>;
      getLeads: () => Promise<Record<string, unknown>[]>;
      getAppStatus: () => Promise<{
        firestore: boolean;
        gemini: boolean;
        twilio: boolean;
        firebaseWeb: boolean;
      }>;
      openAuthBrowser: (
        platform: string
      ) => Promise<{ ok: boolean; error?: string }>;
      onLog: (handler: (stepId: string, msg: string) => void) => () => void;
      onNotify: (handler: (payload: { title: string; body: string }) => void) => () => void;
    };
  }
}

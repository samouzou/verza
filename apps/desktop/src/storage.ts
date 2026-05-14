
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

dotenv.config();

// Safe logger — prevents EPIPE crashes when Electron stdout pipe is broken
function safeLog(...args: any[]) {
  try { console.log(...args); } catch (_) {}
}

let db: admin.firestore.Firestore;

/** Plain objects safe for Electron IPC (Timestamps are not structured-clone friendly). */
function serializeLeadDoc(doc: admin.firestore.QueryDocumentSnapshot): Record<string, unknown> {
  const data = doc.data();
  const { createdAt, ...rest } = data;
  let createdAtIso: string | null = null;
  if (createdAt && typeof (createdAt as admin.firestore.Timestamp).toDate === "function") {
    try {
      createdAtIso = (createdAt as admin.firestore.Timestamp).toDate().toISOString();
    } catch {
      createdAtIso = null;
    }
  }
  return {
    id: doc.id,
    ...rest,
    createdAtIso,
  };
}

/**
 * Initializes Firestore using Application Default Credentials (ADC).
 * Run `gcloud auth application-default login` to authenticate locally.
 */
function initFirestore() {
  if (db) return;

  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID
    });
    db = admin.firestore();
    safeLog(`[Optic] Firestore initialized using ADC.`);
  } catch (error) {
    safeLog(`[Optic] Failed to initialize Firestore using ADC.`);
    safeLog(`[Optic] Run 'gcloud auth application-default login' or set GOOGLE_APPLICATION_CREDENTIALS.`);
    safeLog(`[Optic] Error details:`, error instanceof Error ? error.message : error);
  }
}

/**
 * Saves a lead to the optic_outreach_leads collection.
 * @param leadData The parsed JSON data from Gemini.
 * @param profileUrl The original URL of the creator.
 */
export async function saveLeadToFirestore(leadData: any, profileUrl: string) {
  initFirestore();

  const payload = {
    ...leadData,
    profileUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'Verza Optic MVP'
  };

  if (!db) {
    safeLog(`[Optic] [MOCK SAVE] Would have saved to Firestore:`, payload);
    return;
  }

  try {
    const docRef = await db.collection('optic_outreach_leads').add(payload);
    safeLog(`[Optic] Lead saved to Firestore with ID: ${docRef.id}`);
  } catch (error) {
    console.error(`[Optic] Firestore save error:`, error);
    throw error;
  }
}

/**
 * Fetches recent leads from the optic_outreach_leads collection.
 */
export async function getLeads(limit: number = 50): Promise<any[]> {
  initFirestore();
  if (!db) {
    safeLog(`[Optic] Firestore not available for getLeads.`);
    return [];
  }
  try {
    const snapshot = await db
      .collection('optic_outreach_leads')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snapshot.docs.map((doc) => serializeLeadDoc(doc));
  } catch (error) {
    safeLog(`[Optic] Error fetching leads:`, error);
    return [];
  }
}

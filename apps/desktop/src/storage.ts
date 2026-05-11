
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

dotenv.config();

let db: admin.firestore.Firestore;

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
    console.log(`[Optic] Firestore initialized using ADC.`);
  } catch (error) {
    console.warn(`[Optic] Failed to initialize Firestore using ADC.`);
    console.warn(`[Optic] Run 'gcloud auth application-default login' or set GOOGLE_APPLICATION_CREDENTIALS.`);
    console.warn(`[Optic] Error details:`, error instanceof Error ? error.message : error);
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
    console.log(`[Optic] [MOCK SAVE] Would have saved to Firestore:`, payload);
    return;
  }

  try {
    const docRef = await db.collection('optic_outreach_leads').add(payload);
    console.log(`[Optic] Lead saved to Firestore with ID: ${docRef.id}`);
  } catch (error) {
    console.error(`[Optic] Firestore save error:`, error);
    throw error;
  }
}

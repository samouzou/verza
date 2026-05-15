/**
 * Lightweight env snapshot for the UI (does not verify ADC or API reachability).
 */
export function getAppStatusSnapshot(): {
  firestore: boolean;
  gemini: boolean;
  twilio: boolean;
  firebaseWeb: boolean;
} {
  const firestore = Boolean(process.env.FIREBASE_PROJECT_ID?.trim());
  const gemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const twilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_PHONE_NUMBER?.trim() &&
      process.env.USER_PHONE_NUMBER?.trim()
  );
  const firebaseWeb = Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
  );
  return { firestore, gemini, twilio, firebaseWeb };
}

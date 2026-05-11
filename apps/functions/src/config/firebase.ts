import * as admin from "firebase-admin";

// Initialize Firebase Admin if it hasn't been initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();

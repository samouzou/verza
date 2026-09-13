import admin from "firebase-admin";

let initialized = false;

export function getAdmin(projectId: string): typeof admin {
  if (!initialized) {
    if (!admin.apps.length) {
      admin.initializeApp({projectId});
    }
    initialized = true;
  }
  return admin;
}

export function getDb(projectId: string): FirebaseFirestore.Firestore {
  return getAdmin(projectId).firestore();
}

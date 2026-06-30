import {getApps, initializeApp} from "firebase-admin/app";
import {getStorage} from "firebase-admin/storage";

/**
 * Resolves the Firebase Storage bucket name for uploads.
 * Cloud Run sets GOOGLE_CLOUD_PROJECT; bucket follows `{project}.firebasestorage.app`.
 * @return {string} Storage bucket name.
 */
export function resolveStorageBucketName(): string {
  const explicit =
    process.env.APP_STORAGE_BUCKET?.trim() ||
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;

  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim();
  if (projectId) return `${projectId}.firebasestorage.app`;

  throw new Error(
    "Storage bucket not configured. Set APP_STORAGE_BUCKET on the worker, or run with GOOGLE_CLOUD_PROJECT set."
  );
}

if (!getApps().length) {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim();
  const storageBucket = resolveStorageBucketName();

  initializeApp({
    ...(projectId ? {projectId} : {}),
    storageBucket,
  });
}

/**
 * Returns the configured default Storage bucket.
 * @return {import("@google-cloud/storage").Bucket} Storage bucket.
 */
export function getDefaultBucket() {
  return getStorage().bucket(resolveStorageBucketName());
}

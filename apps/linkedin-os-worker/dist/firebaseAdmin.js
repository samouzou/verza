"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStorageBucketName = resolveStorageBucketName;
exports.getDefaultBucket = getDefaultBucket;
const app_1 = require("firebase-admin/app");
const storage_1 = require("firebase-admin/storage");
/**
 * Resolves the Firebase Storage bucket name for uploads.
 * Cloud Run sets GOOGLE_CLOUD_PROJECT; bucket follows `{project}.firebasestorage.app`.
 * @return {string} Storage bucket name.
 */
function resolveStorageBucketName() {
    const explicit = process.env.APP_STORAGE_BUCKET?.trim() ||
        process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
    if (explicit)
        return explicit;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
        process.env.GCLOUD_PROJECT?.trim() ||
        process.env.FIREBASE_PROJECT_ID?.trim();
    if (projectId)
        return `${projectId}.firebasestorage.app`;
    throw new Error("Storage bucket not configured. Set APP_STORAGE_BUCKET on the worker, or run with GOOGLE_CLOUD_PROJECT set.");
}
if (!(0, app_1.getApps)().length) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
        process.env.GCLOUD_PROJECT?.trim() ||
        process.env.FIREBASE_PROJECT_ID?.trim();
    const storageBucket = resolveStorageBucketName();
    (0, app_1.initializeApp)({
        ...(projectId ? { projectId } : {}),
        storageBucket,
    });
}
/**
 * Returns the configured default Storage bucket.
 * @return {import("@google-cloud/storage").Bucket} Storage bucket.
 */
function getDefaultBucket() {
    return (0, storage_1.getStorage)().bucket(resolveStorageBucketName());
}

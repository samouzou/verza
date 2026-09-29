"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistOpticAvatar = persistOpticAvatar;
exports.persistOpticAvatarFromUrl = persistOpticAvatarFromUrl;
const node_crypto_1 = require("node:crypto");
const admin = __importStar(require("firebase-admin"));
const MAX_AVATAR_BYTES = 1_500_000;
function storageBucket() {
    const name = process.env.APP_STORAGE_BUCKET?.trim() ||
        process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
        "";
    return name ? admin.storage().bucket(name) : admin.storage().bucket();
}
function opticAvatarStoragePath(agencyId, profileUrl) {
    const key = (0, node_crypto_1.createHash)("sha256").update(profileUrl.trim().toLowerCase()).digest("hex").slice(0, 32);
    return `optic_avatars/${agencyId}/${key}.jpg`;
}
function refererFor(url) {
    try {
        return new URL(url).origin + "/";
    }
    catch {
        return "https://www.youtube.com/";
    }
}
async function fetchAvatarFromUrl(url, profileUrl) {
    try {
        if (!/^https:\/\//i.test(url))
            return null;
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                Referer: refererFor(profileUrl || url),
            },
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok)
            return null;
        const contentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
        if (!contentType.startsWith("image/"))
            return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!buffer.length || buffer.length > MAX_AVATAR_BYTES)
            return null;
        return { buffer, contentType };
    }
    catch {
        return null;
    }
}
async function uploadAvatar(args) {
    try {
        const bucket = storageBucket();
        const storagePath = opticAvatarStoragePath(args.agencyId, args.profileUrl);
        const file = bucket.file(storagePath);
        const token = (0, node_crypto_1.randomUUID)();
        await file.save(args.buffer, {
            resumable: false,
            metadata: {
                contentType: args.contentType.startsWith("image/") ? args.contentType : "image/jpeg",
                cacheControl: "public,max-age=31536000",
                metadata: { firebaseStorageDownloadTokens: token },
            },
        });
        const encoded = encodeURIComponent(storagePath);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
    }
    catch (e) {
        console.warn("[Optic avatar] Upload failed", e instanceof Error ? e.message : String(e));
        return null;
    }
}
/** Stores a durable Firebase download URL from in-browser bytes or a remote URL. */
async function persistOpticAvatar(args) {
    let decoded = null;
    if (args.avatarBytes && args.avatarBytes.length && args.avatarBytes.length <= MAX_AVATAR_BYTES) {
        decoded = {
            buffer: args.avatarBytes,
            contentType: args.avatarContentType?.startsWith("image/")
                ? args.avatarContentType
                : "image/jpeg",
        };
    }
    else if (args.avatarSourceUrl?.trim()) {
        decoded = await fetchAvatarFromUrl(args.avatarSourceUrl.trim(), args.profileUrl);
    }
    if (!decoded)
        return null;
    return uploadAvatar({
        agencyId: args.agencyId,
        profileUrl: args.profileUrl,
        buffer: decoded.buffer,
        contentType: decoded.contentType,
    });
}
/** @deprecated Prefer persistOpticAvatar with in-browser bytes. */
async function persistOpticAvatarFromUrl(args) {
    return persistOpticAvatar(args);
}

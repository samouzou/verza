# Verza Optic Chrome Extension

Runs Instagram creator discovery in the **user's logged-in Chrome session** instead of a headless Cloud Run worker. This unlocks follower counts, bios, and contact info that Instagram blocks for automated browsers.

## Build (local dev)

```bash
cd apps/optic-extension
npm install
npm run build
```

Load unpacked in Chrome → select `apps/optic-extension` (the folder with `manifest.json`).

## Package for web download

Creates a production zip and copies it to the web app for `/downloads/verza-optic-scout.zip`:

```bash
cd apps/optic-extension
npm run package
```

Run this before deploying the web app so Optic’s install link works.

## Chrome Web Store (recommended for production users)

1. `npm run package` — uses `manifest.prod.json` (no localhost permissions)
2. Upload `release/verza-optic-scout.zip` to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Set the store URL in the web app:
   ```bash
   NEXT_PUBLIC_OPTIC_EXTENSION_CHROME_STORE_URL=https://chrome.google.com/webstore/detail/YOUR_EXTENSION_ID
   ```
4. Redeploy the web app — Optic will show **Add to Chrome** instead of the zip download

Until the store listing is live, users install via **Optic → Download extension** or `/optic/extension`.

## How it works

1. On Optic, choose **Instagram** and enable **Use my browser for Instagram search**
2. Start a mission — Verza queues a job with `runner: "extension"`
3. The web app passes your Firebase ID token to the extension
4. The extension opens Instagram hashtag explore + profile pages in background tabs
5. Scraped profiles are enriched with Gemini and saved to your Optic vault via Cloud Functions

## Deploy Cloud Functions (required for cloud missions)

Extension missions skip the optic-worker. Deploy these callables to your Firebase project:

**Dev**
```bash
firebase deploy --only functions:enqueueOpticDiscoveryJob,functions:claimOpticExtensionJob,functions:submitOpticExtensionLead,functions:completeOpticExtensionJob,functions:reportOpticExtensionProgress,functions:dispatchOpticJobToWorker --project verza-canvas-dev
```

**Production**
```bash
firebase deploy --only functions:enqueueOpticDiscoveryJob,functions:claimOpticExtensionJob,functions:submitOpticExtensionLead,functions:completeOpticExtensionJob,functions:reportOpticExtensionProgress,functions:dispatchOpticJobToWorker --project verza-canvas
```

No optic-worker deploy is needed for Instagram extension missions.

## Callable endpoints

- `claimOpticExtensionJob` — returns hashtag, keyword query, and AI seed profile URLs
- `reportOpticExtensionProgress` — live mission progress for the Optic UI
- `submitOpticExtensionLead`
- `completeOpticExtensionJob`

## Environments

| Host | Extension manifest | Functions target |
|------|-------------------|------------------|
| `http://localhost:9002` | dev manifest + bridge | Functions emulator (`localhost:5001`) |
| `https://dev-app.tryverza.com` | dev + prod manifests | Deployed `verza-canvas-dev` |
| `https://app.tryverza.com` | prod manifest | Deployed `verza-canvas` |

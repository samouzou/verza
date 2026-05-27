# LinkedIn OS worker

Separate **Cloud Run–style worker** from **Optic**: runs Verza company LinkedIn draft jobs triggered by Firestore `linkedin_os_jobs`.

## Flow

1. Authorized caller invokes Firebase callable **`enqueueLinkedInOsDraftJob`** → creates `linkedin_os_jobs/{id}` with `status: "queued"`.
2. **`dispatchLinkedInOsJobToWorker`** (Firestore onCreate) POSTs to this service `/internal/run-job` with `x-verza-linkedin-os-secret`.
3. Worker loads prompt context from **`linkedin_os_prompts/default`** and writes **`outputs`** on the job doc.
4. For **carousel** items, the worker also renders **1080×1080 branded PNG slides**, a **multi-page PDF** (LinkedIn document upload), and a PNG ZIP — uploaded to Storage under `linkedin_os_carousels/{agencyId}/…`.

## Environment

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `LINKEDIN_OS_WORKER_SHARED_SECRET` | yes | Must match Firebase param `LINKEDIN_OS_WORKER_SHARED_SECRET` |
| `GEMINI_API_KEY` | yes | Google AI Studio / Gemini API key (same name as `apps/functions/src/config/params.ts` `GEMINI_API_KEY`) |
| `GEMINI_MODEL` | no | Default `gemini-3-flash-preview` (aligned with `apps/optic-worker`) |
| `APP_STORAGE_BUCKET` | no | Firebase Storage bucket. If unset, worker uses `{GOOGLE_CLOUD_PROJECT}.firebasestorage.app` (set automatically on Cloud Run). |
| `PORT` | no | Default `8080` |

Firebase Admin uses **Application Default Credentials** (Cloud Run service account).

**Breaking change:** `OPENAI_API_KEY` / `OPENAI_MODEL` are no longer read. Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) on Cloud Run or locally.

## Local dev

```bash
cd apps/linkedin-os-worker
npm install
export LINKEDIN_OS_WORKER_SHARED_SECRET=devsecret
export GEMINI_API_KEY=...
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
npm run dev
```

POST:

```bash
curl -s -X POST http://localhost:8080/internal/run-job \
  -H "Content-Type: application/json" \
  -H "x-verza-linkedin-os-secret: devsecret" \
  -d '{"jobId":"<queued-job-id>"}'
```

## Build

```bash
npm run build
node dist/index.js
```

## Deploy to Cloud Run

From repo root (requires [gcloud CLI](https://cloud.google.com/sdk/docs/install) and billing enabled).

```bash
export PROJECT_ID=verza-canvas-dev   # or verza-canvas for prod
export REGION=us-central1
export SERVICE=linkedin-os-worker

# Pick a long random secret; use the same value in Firebase Functions params.
export LINKEDIN_OS_WORKER_SHARED_SECRET="$(openssl rand -hex 32)"

cd apps/linkedin-os-worker

gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source=. \
  --port=8080 \
  --memory=512Mi \
  --timeout=300 \
  --min-instances=0 \
  --max-instances=5 \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_MODEL=gemini-3-flash-preview,LINKEDIN_OS_WORKER_SHARED_SECRET=${LINKEDIN_OS_WORKER_SHARED_SECRET}" \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

If you prefer plain env vars instead of Secret Manager for Gemini:

```bash
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source=. \
  --port=8080 \
  --memory=512Mi \
  --timeout=300 \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=YOUR_KEY,GEMINI_MODEL=gemini-3-flash-preview,LINKEDIN_OS_WORKER_SHARED_SECRET=${LINKEDIN_OS_WORKER_SHARED_SECRET}"
```

Get the service URL:

```bash
gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)'
```

Wire Functions (in `apps/functions/.env.$PROJECT_ID` or Firebase params UI):

```bash
LINKEDIN_OS_WORKER_URL=https://linkedin-os-worker-xxxxx-uc.a.run.app
LINKEDIN_OS_WORKER_SHARED_SECRET=<same secret as worker>
```

Redeploy functions:

```bash
cd apps/functions && npm run build
firebase deploy --only functions:enqueueLinkedInOsDraftJob,functions:dispatchLinkedInOsJobToWorker --project "$PROJECT_ID"
```

Also deploy Firestore rules/indexes if not yet done:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage --project "$PROJECT_ID"
```

The Cloud Run service account needs **Storage Object Admin** (or equivalent) on the Firebase bucket so carousel PNGs can be uploaded.

Carousel assets are stored at `linkedin_os_carousels/{agencyId}/{jobId}/{outputId}/` and download from **`/linkedin-os`** when a carousel job completes.

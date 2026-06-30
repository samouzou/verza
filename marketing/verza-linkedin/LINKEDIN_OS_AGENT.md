# LinkedIn OS agent (Optic-shaped, not Optic)

**LinkedIn OS** is Verza’s **separate** agent pipeline for company LinkedIn drafts: Firestore jobs, a callable enqueue, a Firestore trigger, and a **dedicated worker** (`apps/linkedin-os-worker`). It does **not** use Optic credits, Playwright, or `optic_jobs`.

## Architecture

```
You (Serge, signed in)
    → httpsCallable("enqueueLinkedInOsDraftJob") { weekLabel, reviewer, items[] }
        → Firestore linkedin_os_jobs/{jobId} { status: "queued", items, … }

onCreate linkedin_os_jobs
    → POST linkedin-os-worker /internal/run-job { jobId }
        → Reads linkedin_os_prompts/default (brand brief, strategy, banned copy)
        → Gemini → writes job.outputs[] + status completed | failed
```

## One-time Firebase setup

### 1) Params / env (Functions + worker)

Set Firebase **string params** (same names as local `.env` for emulators if you use them):

| Param | Purpose |
| ----- | ------- |
| `LINKEDIN_OS_WORKER_URL` | Base URL of the Cloud Run (or local) worker, no trailing slash. |
| `LINKEDIN_OS_WORKER_SHARED_SECRET` | Shared secret; worker checks header `x-verza-linkedin-os-secret`. |

**Access:** Any signed-in **agency owner, admin, or member** with a primary agency can use **`/linkedin-os`** in the web app or call `enqueueLinkedInOsDraftJob`. No UID allowlist required.

Worker env (Cloud Run): `LINKEDIN_OS_WORKER_SHARED_SECRET`, `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-3-flash-preview`). **`OPENAI_*` vars are no longer used.**

### 2) Seed prompt pack (Firestore)

Create collection **`linkedin_os_prompts`**, document id **`default`**, with string fields:

| Field | Content |
| ----- | ------- |
| `brandBrief` | Paste from `docs/BRAND_SIDE_TECHNICAL_BRIEF.md` (update when brief changes). |
| `socialStrategy` | Paste from `docs/VERZA_SOCIAL_CREATOR_STRATEGY.md` (or excerpt). |
| `bannedClaims` | Paste from `marketing/verza-linkedin/BANNED_CLAIMS.md`. |

Optional: `updatedAt` timestamp for your own tracking.

### 3) Deploy worker

Build and deploy `apps/linkedin-os-worker` to Cloud Run (same pattern as `optic-worker`). Point `LINKEDIN_OS_WORKER_URL` at the service URL.

### 4) Deploy functions

Deploy Cloud Functions so `enqueueLinkedInOsDraftJob` and `dispatchLinkedInOsJobToWorker` are live.

## Callable payload

`enqueueLinkedInOsDraftJob`:

- `weekLabel` (string, optional)
- `reviewer` (string, optional, default `"Serge"`)
- `items` (array, required): same shape as `marketing/verza-linkedin/queue.example.json` (`id`, `pillar`, `format`, `hook`, `productTruth`, `cta`, optional `notes`)

## Reading results

Open **Firebase Console → Firestore → `linkedin_os_jobs`**, or use the in-app **`/linkedin-os`** page (agency team login). Each completed job has an **`outputs`** array with `markdown` per slot—copy, edit, publish.

## Local script (no cloud)

The repo still has **`marketing/verza-linkedin/scripts/generate-drafts.mjs`** for laptop-only runs with `queue.json` and local file context.

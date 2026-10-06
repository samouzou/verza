# LinkedIn OS agent (Optic-shaped, not Optic)

**LinkedIn OS** is Verza’s **separate** agent pipeline for company LinkedIn drafts: Firestore jobs, a callable enqueue, a Firestore trigger, and a **dedicated worker** (`apps/linkedin-os-worker`). It does **not** use Optic credits, Playwright, or `optic_jobs`.

## Architecture

```
You (Serge, signed in)
    → httpsCallable("enqueueLinkedInOsDraftJob") { weekLabel, reviewer, items[], optional weeklyBrief… }
        → Firestore linkedin_os_jobs/{jobId} { status: "queued", items, … }

onCreate linkedin_os_jobs
    → POST linkedin-os-worker /internal/run-job { jobId }
        → Reads prism_brands/{agencyId} (brand brief, pillars, channels, banned copy)
        → Gemini → writes job.outputs[] + status completed | failed
        → creates one prism_posts draft per output (calendar post, with carousel slides attached)
```

## One-time Firebase setup

### 1) Params / env (Functions + worker)

Set Firebase **string params** (same names as local `.env` for emulators if you use them):

| Param | Purpose |
| ----- | ------- |
| `LINKEDIN_OS_WORKER_URL` | Base URL of the Cloud Run (or local) worker, no trailing slash. |
| `LINKEDIN_OS_WORKER_SHARED_SECRET` | Shared secret; worker checks header `x-verza-linkedin-os-secret`. |

**Access:** Any signed-in **agency owner, admin, or member** with a primary agency can use **`/prism`** (formerly `/linkedin-os`) in the web app or call `enqueueLinkedInOsDraftJob`. No UID allowlist required.

Worker env (Cloud Run): `LINKEDIN_OS_WORKER_SHARED_SECRET`, `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-3.6-flash`). **`OPENAI_*` vars are no longer used.**

### 2) Brand setup (per brand)

Each brand sets up Prism at **`/prism/setup`** (brief, audience, pillars, channels, banned claims). It's stored in
**`prism_brands/{agencyId}`**; planning and drafting refuse to run without it.

The old global **`linkedin_os_prompts/default`** pack is no longer read. To carry Verza's existing pack over to
Verza's own agency once:

```bash
cd apps/functions && node ../../scripts/migrate-prism-brand.mjs --agency <verzaAgencyId> --project verza-canvas
```

### 3) Deploy worker

Build and deploy `apps/linkedin-os-worker` to Cloud Run (same pattern as `optic-worker`). Point `LINKEDIN_OS_WORKER_URL` at the service URL.

### 4) Deploy functions

Deploy Cloud Functions so `enqueueLinkedInOsDraftJob` and `dispatchLinkedInOsJobToWorker` are live.

## Callable payload

`enqueueLinkedInOsDraftJob`:

- `weekLabel` (string, optional)
- `weekStart` (YYYY-MM-DD Monday, optional)
- `reviewer` (string, optional, default `"Serge"`)
- `items` (array, required): same shape as `marketing/verza-linkedin/queue.example.json` (`id`, `channel`, `pillar`, `format`, `hook`, `productTruth`, `cta`, optional `notes`, optional `date` YYYY-MM-DD — the post lands on that day at the channel's default time in the brand timezone)
- Optional **per-job context** (stored on the job doc and merged by the worker into Gemini system context):
  - `weeklyBrief` (string, markdown ok, max 6000 chars) — audience, campaign, or narrative not in the global prompt pack.
  - `mustMention` (string, max 500) — phrase the drafts should reflect.
  - `neverMention` (string, max 500) — topics or names to avoid.

## Reading results

Each draft becomes a post on the **`/prism`** calendar (`prism_posts`, `source: "studio"`, `studio.jobId`), where it's edited,
reviewed, approved and marked posted. **`/prism/studio`** lists a job's drafts with their live calendar status. The raw
copy also stays on the job's **`outputs`** array (`postId` links each output to its post).

## Auto-publishing (Prism Launch and Enterprise)

Publishing goes through [Zernio](https://zernio.com) (formerly Late). Code: `apps/functions/src/linkedinOs/publishing.ts`.

- **Connect:** `/prism/accounts` → `getPrismConnectUrl` creates one Zernio profile per brand and returns Zernio's hosted
  login. After the redirect back, `syncPrismConnections` stores the accounts in `prism_connections/{agencyId}`.
  Owners and admins only; Free brands get an upgrade prompt.
- **Send:** `publishDuePrismPosts` runs every 5 minutes. It picks approved posts with `autoPublish !== false` due in the
  next 10 minutes (up to 24h overdue), locks each one, and creates one Zernio post with each channel's copy and
  `scheduledFor`. Zernio publishes at the exact time. An `Idempotency-Key` on every send prevents double posts.
- **What goes out:** LinkedIn text and PDF carousels (rendered slides, caption = the draft's `## Caption` section, falling back to the post title), X posts and threads,
  Instagram carousels (rendered slides, `## Caption`). Instagram single images, Reels and TikTok videos are
  marked "post by hand".
- **Results:** `prismZernioWebhook` (HMAC-verified, deduped in `prism_webhook_events`) records each channel's link or
  error. Once every channel is live the post becomes `posted`. Failures notify the team in-app; network errors retry
  up to 3 times.
- **While queued** the post can't be edited, rescheduled, reopened or deleted until someone presses
  **Cancel auto-publish** (`cancelPrismPublish`). **Publish now** / **Retry now** call `publishPrismPostNow`.

Setup: set `ZERNIO_API_KEY` and `ZERNIO_WEBHOOK_SECRET` in `apps/functions/.env.<projectId>`, deploy the index on
`prism_posts (status, scheduledAt)`, then create the webhook in Zernio pointing at the `prismZernioWebhook` URL with the
same secret and the events `post.platform.published`, `post.platform.failed`, `post.published`, `post.partial`,
`post.failed`, `post.cancelled`, `account.connected`, `account.disconnected`. Connecting X needs a card on the Zernio
account (X API calls are passed through).

## Local script (no cloud)

The repo still has **`marketing/verza-linkedin/scripts/generate-drafts.mjs`** for laptop-only runs with `queue.json` and local file context.

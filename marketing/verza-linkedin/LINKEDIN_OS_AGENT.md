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

Each brand sets up Prism at **`/prism/setup`** (category, brief, audience, pillars, channels, banned claims). It's
stored in **`prism_brands/{agencyId}`**; planning and drafting refuse to run without it.

- **Category** (`dtc`, `saas`, `app`, `services`, `creator`, `local`) is required on save and inferred by the website
  draft. It adds category guidance to every writer prompt and picks the image slide layout: Screenshot for `saas` and
  `app`, Product for everything else.
- **Products** are the brand kit catalog (`agencies/{id}/private/brandKit.products`), edited in setup or at
  `/agency/products`. Each product has up to 6 `images` (`imageUrl` = the first). Writers see the catalog and may only
  name real products. Month plans and weekly plans can pick a product per idea (`productId` on the post, `product`
  name on Studio items); the composer has a picker too.
- **Product / Screenshot slides** (`## Slide N — Product` or `— Screenshot`, first line = exact catalog name) render
  the real image: product photos on a stage, screenshots in a browser frame (wide) or phone frame (tall). Without an
  image the slide falls back to a list.
- **Feed graphics** for a post with a featured product: product brands pass the product photo to Gemini as a reference
  to keep it exact; screenshot brands skip the image model and get a framed screenshot from the worker's
  `/internal/render-feed`.

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

## Plans and billing

Billing is per brand (agency doc). Code: `apps/functions/src/linkedinOs/billing.ts` (`PRISM_TIERS`), mirrored in
`apps/web/src/hooks/use-prism-plan.ts`.

| Plan | Price | AI actions / mo | Feed graphics / mo | Auto-publish | Video / mo | X fees included |
|---|---|---|---|---|---|---|
| No plan | $0 | — | — | no | — | — |
| Lifetime (AppSumo) | $69 once | 300 | 30 | no | packs | — |
| Starter | $29/mo, $290/yr | 300 | 30 | no | packs | — |
| Launch | $79/mo, $790/yr | 1,000 | 100 | yes | 30s | $5 |
| Pro | $149/mo, $1,490/yr | 3,000 | unlimited | yes | 120s | $10 |
| Enterprise | custom | unlimited | unlimited | yes | 120s | by contract |

There's no free AI plan. Without a plan a brand keeps the calendar, composer, approvals, brand setup and manual posting;
AI writing, Studio, renders, video and auto-publishing need a plan. A brand's first self-serve subscription gets a 7-day
trial with the card collected at Checkout (`PRISM_TRIAL_DAYS`), once per brand and once per Stripe customer
(`prismTrialUsed`, `prismTrialEnd` on the agency). Starter, Launch and Pro unlock Studio and unlimited carousels.
Lifetime is Starter for good; a Lifetime brand that subscribes and later cancels falls back to Lifetime.

- **Stripe prices** are found by lookup key `prism_{starter|launch|pro}_{monthly|yearly}`. Create or verify them with
  `STRIPE_SECRET_KEY=… node scripts/prism-stripe-plans.mjs [--dry-run]` (idempotent; also retires the old $199 Launch
  prices). Enterprise uses Payment Links whose price carries `metadata.prismPlanId = prism_enterprise_{monthly|yearly}`.
- **Checkout:** `createPrismSubscriptionCheckoutSession({plan, interval})` for Free and Lifetime brands.
  **Switching:** `previewPrismPlanChange` returns Stripe's prorated amount due now (or credit) and the next charge for
  the confirmation dialog; `changePrismPlan({plan, interval})` swaps the subscription's price in place; upgrades charge the
  prorated difference immediately and only apply once paid, downgrades leave a credit.
- **Webhook:** the plan comes from the subscription price's lookup key, then price metadata, then subscription metadata.
  A Launch subscription on a price without the current lookup key is on the retired $199 Launch and gets Pro.
- **Costs per brand at full use:** Launch about $40 (AI, graphics, 30s video, Zernio accounts, X allowance), Pro about
  $80. A brand connects at most one account per channel (four), which caps Zernio fees.

## Auto-publishing (Prism Launch, Pro and Enterprise)

Publishing goes through [Zernio](https://zernio.com) (formerly Late). Code: `apps/functions/src/linkedinOs/publishing.ts`.

- **Connect:** `/prism/accounts` → `getPrismConnectUrl` creates one Zernio profile per brand and returns Zernio's hosted
  login. After the redirect back, `syncPrismConnections` stores the accounts in `prism_connections/{agencyId}`.
  Owners and admins only; Free, Starter and Lifetime brands get an upgrade prompt.
- **Send:** `publishDuePrismPosts` runs every 5 minutes. It picks approved posts with `autoPublish !== false` due in the
  next 10 minutes (up to 24h overdue), locks each one, and creates one Zernio post with each channel's copy and
  `scheduledFor`. Zernio publishes at the exact time. An `Idempotency-Key` on every send prevents double posts.
- **What goes out:** LinkedIn text and PDF carousels (rendered slides, caption = the draft's `## Caption` section, falling back to the post title), X posts and threads,
  Instagram carousels (rendered slides, `## Caption`) and Instagram feed posts (the graphic `generatePrismGraphic` makes
  from `## Visual` with Gemini at 4:5, plus `## Caption`; it counts as a render). Instagram Reels and TikTok videos
  post the generated video (see Video below) with `## Caption`; without a video they're marked "post by hand". TikTok
  posts read the creator's allowed privacy levels first and are labeled AI-generated, duets and stitches off.
- **X fees:** Zernio passes X's API fees through ($0.015 per tweet, $0.20 with a link). Each X publish adds to
  `prism_usage/{agencyId}/months/{YYYY-MM}`. On the 1st, `billPrismXUsage` bills Launch and Pro brands for last month's
  fees above their allowance ($5 and $10), plus 5% for processing, as a Stripe invoice item (next renewal for monthly plans; its own invoice once
  $10+ is pending for yearly or canceled plans). Enterprise X usage is covered by contract.
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

## Video (Reels and TikToks)

The composer's **Make video** button on an `ig_reel` or `tiktok_video` variant turns the script into a 9:16 1080p video
with Gemini Omni (`gemini-omni-1.1-flash`). Code: `apps/functions/src/linkedinOs/video.ts`, `videoCredits.ts`, and
`apps/linkedin-os-worker/src/video/`.

- **Length:** 10, 20, 30 or 40 seconds. Omni makes the first 10s; each extra 10s uploads the last 10s back to Omni as a
  source clip and appends the new half. The featured product's images go in as references on every segment.
- **Pipeline:** `renderPrismVideo` (callable) spends credits and creates `prism_video_jobs/{id}` in one transaction, then
  queues `renderPrismVideoTask` (Cloud Tasks, 30 min). The task calls the worker's `/internal/render-video`, which plans
  the shots with Gemini, renders with Omni, records a Gemini TTS voiceover over the clip's own sound, stitches with
  ffmpeg, and stores `video.mp4` + `cover.jpg` under `linkedin_os_carousels/{agencyId}/posts/{postId}/`. One render at a
  time per brand. `onPrismVideoJobUpdated` mirrors progress onto the variant (`videoJob`), refunds failures once, and
  notifies whoever started it.
- **Credits:** 1 credit = 1 second. Launch gets 30 a month, Pro and Enterprise 120 (no rollover);
  Starter and Lifetime buy packs. Packs: 60 for
  $18, 200 for $55, 600 for $150 (Stripe prices with lookup keys `prism_video_credits_{60,200,600}`), bought by owners
  and admins through `createPrismVideoCreditCheckout`; the subscriptions webhook grants them on payment
  (`handlePrismVideoCreditsEvent`, idempotent per Checkout session). Spending uses the monthly allowance first, then
  purchased credits. Balance: `prism_video_credits/{agencyId}`, with a `ledger` subcollection.
- **Cost:** Omni at 1080p is about $0.15 per second, so packs keep roughly 40% to 50% margin; a fully used monthly allowance costs about $4.50 on Launch and
  $18 on Pro.

Setup: create the three Stripe prices (one product, `metadata.purpose = prism_video_credits`), deploy the worker with
`--timeout=1800 --memory=2Gi` (see the worker README), and give the Functions service account **Cloud Tasks Enqueuer**
and **Service Account User** so `renderPrismVideo` can queue the task.

## Local script (no cloud)

The repo still has **`marketing/verza-linkedin/scripts/generate-drafts.mjs`** for laptop-only runs with `queue.json` and local file context.

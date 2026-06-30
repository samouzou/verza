# Verza LinkedIn — standalone program

This folder is the **home base for Verza’s LinkedIn presence**: positioning, weekly rhythm, templates, and agent prompts. It is **intentionally separate from Optic**.

## Why not Optic?

| Optic | Verza LinkedIn |
| ----- | ---------------- |
| Outbound / discovery / leads for **customers’** goals | Brand narrative for **Verza the company** |
| Different compliance, tooling, and success metrics | Editorial calendar, voice, and founder/team approvals |
| Product surface inside the app | Mostly external (LinkedIn) + internal docs |

Keeping LinkedIn out of Optic avoids coupling **brand voice** to **lead-gen automation**, keeps access control simpler, and lets you ship social without touching worker queues or billing paths.

## What lives here

| File | Purpose |
| ---- | ------- |
| [WEEKLY_RUNBOOK.md](./WEEKLY_RUNBOOK.md) | Mon–Fri checklist: plan → draft → edit → schedule |
| [content-calendar.template.md](./content-calendar.template.md) | Copy into Notion/Sheet; track pillar, status, owner |
| [BANNED_CLAIMS.md](./BANNED_CLAIMS.md) | Non-negotiables for drafts (human + agent) |
| [AGENT_PROMPTS.md](./AGENT_PROMPTS.md) | LinkedIn-only prompts (Cursor, ChatGPT, etc.) |
| [LINKEDIN_OS_AGENT.md](./LINKEDIN_OS_AGENT.md) | Cloud agent: enqueue → worker → Firestore `outputs` (separate from Optic) |
| [scripts/](./scripts/) | **Draft generator** — Gemini first pass → `drafts/*.md` (local) |
| `queue.json` (local, gitignored) | Your weekly slots; copy from `queue.example.json` |

Strategy context (persona, pillars, governance) lives in **`docs/VERZA_SOCIAL_CREATOR_STRATEGY.md`**. Product facts for claims: **`docs/BRAND_SIDE_TECHNICAL_BRIEF.md`**.

## First-pass drafts (automated)

You (Serge) stay the **human in the loop**; the machine only kills the blank page.

### Option A — Laptop only (no deploy)

1. `cp marketing/verza-linkedin/queue.example.json marketing/verza-linkedin/queue.json`
2. Fill **hook**, **productTruth** (paste from the brand brief), **pillar**, **cta** per slot.
3. Run: `export GEMINI_API_KEY=...` then  
   `node marketing/verza-linkedin/scripts/generate-drafts.mjs`  
   Output: **`marketing/verza-linkedin/drafts/`** as markdown with `status: first_pass`.
4. You edit, then paste into LinkedIn / scheduler.

Details: **[scripts/README.md](./scripts/README.md)**.

### Option B — LinkedIn OS (Optic-shaped, **not** Optic)

Callable **`enqueueLinkedInOsDraftJob`** → Firestore **`linkedin_os_jobs`** → dedicated worker **`apps/linkedin-os-worker`** writes **`outputs`** (same item shape as `queue.example.json`). Uses Firestore **`linkedin_os_prompts/default`** for brief/strategy/banned text.

Full setup: **[LINKEDIN_OS_AGENT.md](./LINKEDIN_OS_AGENT.md)**.

## Cadence (LinkedIn-first)

- **3 posts / week** minimum (Tue / Thu + one flex Mon or Wed).
- **1 carousel / month** until design capacity grows.
- **1 “build in public”** post every 2 weeks (real shipping or learning).

## Owners

- **Strategic owner + editor + publisher (human in the loop):** Serge  

## Optional next step (code)

- **LinkedIn OS worker:** deploy `apps/linkedin-os-worker` (see [LINKEDIN_OS_AGENT.md](./LINKEDIN_OS_AGENT.md)).
- **Local cron:** [scripts/README.md](./scripts/README.md). Still **not** wired into `apps/optic-worker`.

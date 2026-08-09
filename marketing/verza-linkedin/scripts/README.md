# LinkedIn draft generator (first pass)

Runs **outside Optic**: reads your weekly `queue.json`, pulls context from `docs/`, calls **Google Gemini** (`@google/generative-ai`, same stack as `apps/optic-worker`), writes markdown drafts under `drafts/`.

## Prerequisites

- **Node.js 18+** (same as the rest of Verza).
- **`GEMINI_API_KEY`** (Google AI / Gemini). The package is hoisted from the monorepo root (`npm install` at repo root) alongside other apps that depend on `@google/generative-ai`.

## One-time setup

From repo root:

```bash
cp marketing/verza-linkedin/queue.example.json marketing/verza-linkedin/queue.json
```

Edit **`marketing/verza-linkedin/queue.json`** each week: hooks, pillars, product truths (copy from the brand brief—do not let the model invent facts).

## Run (local generator)

Reads markdown from `docs/` on disk. For the **cloud agent** (callable + Firestore job + `apps/linkedin-os-worker`), see **[../LINKEDIN_OS_AGENT.md](../LINKEDIN_OS_AGENT.md)**.

```bash
export GEMINI_API_KEY="..."
# optional: export GEMINI_MODEL="gemini-3.6-flash"

node marketing/verza-linkedin/scripts/generate-drafts.mjs
```

**Dry run** (no API; writes skeleton files only):

```bash
node marketing/verza-linkedin/scripts/generate-drafts.mjs --dry-run
```

## Cron / automation (optional)

Example: every Monday 08:00 on your machine (load key from your shell profile or `direnv`):

```bash
0 8 * * 1 cd /path/to/verza && export GEMINI_API_KEY=... && node marketing/verza-linkedin/scripts/generate-drafts.mjs
```

For GitHub Actions, use a repo **secret** `GEMINI_API_KEY` and a scheduled workflow that runs the same command and opens a PR with new drafts—only if you want drafts in-repo automatically.

## Human in the loop

**Serge** still edits every file before publish. The script only removes the “blank page” problem.

# Weekly LinkedIn runbook

Use this every week. Timeboxes are suggestions.

## Monday (45–60 min) — Plan + machine first pass

1. Open [content-calendar.template.md](./content-calendar.template.md) (or your live copy in Notion).
2. Pick **3 pillars** for the week (no repeats unless intentional).
3. For each slot, write **one hook line** (the first line people see before “see more”).
4. Note **one product truth** per post (from `docs/BRAND_SIDE_TECHNICAL_BRIEF.md` or an approved changelog). No truth → no post.
5. Copy those into **`queue.json`** (see [scripts/README.md](./scripts/README.md); start from `queue.example.json`).
6. Run **`node marketing/verza-linkedin/scripts/generate-drafts.mjs`** (with `GEMINI_API_KEY` set). This writes **`drafts/*.md`** — Serge’s first pass to edit.

## Tuesday (60 min) — Refine drafts (Serge)

1. Open each new file under **`drafts/`**; edit voice, cut claims, fix hook if needed.
2. Optional: re-run [AGENT_PROMPTS.md](./AGENT_PROMPTS.md) “Editor” in Cursor on a sticky paragraph only.
3. Self-check against [BANNED_CLAIMS.md](./BANNED_CLAIMS.md).
4. Mark status `approved` in frontmatter when happy, or `blocked` if you need a fact check.

## Wednesday (30 min) — Optional second pass (Serge)

1. Re-read `approved` posts with fresh eyes (or anything still `first_pass`).
2. Final cut on length; confirm CTA matches ladder (see strategy doc §7).
3. Status → `approved` or keep `blocked` with a one-line reason.

## Thu / Fri (15 min) — Publish

1. Publisher schedules in LinkedIn (native or your scheduler).
2. First comment: add context, link, or “what we’d do differently”—helps distribution.
3. After publish: set status `live` + drop URL in calendar.

## Friday (20 min) — Retro

1. Note **best reply** and **one surprise** (topic that over/under-performed).
2. One bullet for **next week’s theme** (feeds Monday).

## When to pause everything

- Production incident affecting money, payouts, or legal.
- Any unverified press or rumor touching Verza.

→ Flip calendar to `paused`; do not schedule until strategic owner clears.

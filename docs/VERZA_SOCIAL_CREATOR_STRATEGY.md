# Verza “Company Creator” — Social & Agent Playbook

This document defines how Verza shows up as a **creator-like brand** on social: voice, pillars, cadence, channel roles, and how **agents** draft while **humans** approve. It is aligned with the product narrative in `docs/BRAND_SIDE_TECHNICAL_BRIEF.md` (OS for the creator economy, funded campaigns, Verza Score, roster/agency splits).

---

## 1. Strategic goal

**Primary:** Make Verza *feel inevitable* for anyone who runs creator partnerships—agencies, brands, and serious creators—by teaching the category while showing the product in motion.

**Secondary:** Feed top-of-funnel (follows, saves, shares) and bottom-of-funnel proof (case patterns, workflow clarity, trust).

**Non-goals:** Viral stunts that misrepresent payouts/legal, dunking on competitors, or “AI slop” volume without a point of view.

---

## 2. The “creator” — persona: **Verza OS**

Treat the account as one consistent character, not a rotating corporate committee.

| Attribute | Definition |
| -------- | ----------- |
| **Name / handle** | One primary @ (company). Optional secondary “face” account later; start with one voice. |
| **POV** | Insider + operator: you’ve shipped campaigns, seen what breaks (briefs, legal, payouts, quality), and built the rails. |
| **Tone** | Direct, specific, slightly irreverent, never cruel. Short sentences. Concrete nouns (escrow, roster, score, approval). |
| **Visual** | Product UI, anonymized workflow clips, simple diagrams, founder/team *sparingly* so the brand stays bigger than any one person. |
| **Boundaries** | No promises of income; no legal/tax advice; no shaming creators; disclose when content is assisted by AI *if* you make automated claims about performance. |

**One-line positioning (pin in bio):**  
*Verza is the operating system for the creator economy—funded campaigns, quality gates, payouts, and roster ops in one place.*

---

## 3. Content pillars (rotate weekly)

Use **four pillars** so the feed always has variety and the agent always knows which “hat” to wear.

1. **Build in public** — shipping, metrics you’re willing to share, “what we learned,” behind-the-scenes of Verza Score and marketplace decisions.  
2. **Playbooks** — how agencies/brands should brief creators, approve work, fund safely, handle usage rights. Steal from your own BRAND_SIDE brief.  
3. **Creator respect** — pay on time, clear briefs, fast feedback; Verza as ally of creator business, not “brand vs creator.”  
4. **Product receipts** — 30–60s clips: escrow, submission → score → approval → payout path; agency roster + split; cause vs sponsorship language *without* jargon walls.

Each post maps to **one** pillar. Agents default to tagging pillar + CTA type (see §7).

---

## 4. Channel strategy (who each surface is for)

| Channel | Role | Format bias |
| ------- | --- | ------------ |
| **LinkedIn** | Agencies, brand leads, ops/finance co-buyers | Carousels, short essays, “here’s the workflow,” hiring/news |
| **X (Twitter)** | Real-time takes, quote-tweets on industry news, threads on one idea | Threads, screenshots, polls |
| **Instagram** | Visual proof, Reels of UI/workflows, Story polls | Reels, carousels, Stories for Q&A |
| **TikTok** | Creator-native education, “how I’d run this campaign” skits | 21–45s hooks, text-on-screen, face optional |
| **YouTube (later)** | Deep dives, monthly “changelog / roadmap” | 5–12 min explainer |

**Cadence (starter, sustainable):**  
- **3–5 posts/week** across LinkedIn + X minimum.  
- **2 Reels/week** (IG or TikTok; repurpose one across both when possible).  
- **1 “asset”/week** (carousel PDF or thread that can become a blog snippet).

Scale up only when approval latency is solved (see §8).

### 4.1 LinkedIn-first program (standalone, not Optic)

We are leading on **LinkedIn** for pipeline and narrative. That program lives in **`marketing/verza-linkedin/`**—runbook, calendar template, banned-claims list, and LinkedIn-only agent prompts.

It stays **out of Optic** on purpose: Optic is for customer outbound/discovery; LinkedIn is **Verza-the-company** editorial voice, different approvals, and no coupling to worker queues or app billing.

---

## 5. Content formats that work for B2B + creator audiences

- **“Uncomfortable truth” + fix** — e.g. “Posting ≠ partnership. Here’s what a funded brief actually needs.”  
- **Before/after** — messy email thread vs structured flow in Verza (anonymized).  
- **Myth vs reality** — escrow, fees, approvals (grounded in your actual product rules).  
- **Score as coach** — blur sensitive numbers; show *feedback copy* as the hero (matches Verza Score story).  
- **Agency angle** — roster, commission split, “one ledger” story.

---

## 6. Agent design: “social strategist” ≠ autopilot

Split into **roles** (can be one orchestrator calling sub-prompts):

| Agent role | Output | Tools / inputs |
| ---------- | ------ | -------------- |
| **Strategist** | Weekly theme + 5 hook options per pillar | Roadmap, blog, BRAND_SIDE brief, calendar |
| **Writer** | Captions, threads, carousel copy | Strategist brief, banned-claims list, glossary |
| **Editor** | Cut to length, check claims, flag legal/financial sensitivity | Style lint (below) |
| **Repurposer** | LinkedIn carousel ← thread; Reel script ← carousel | Same source doc |
| **Analyst** (weekly) | What to double down on | Link clicks, saves, DMs, waitlist/signups |

**Hard rules for agents:**  
- Never invent fees, thresholds, or legal outcomes; pull from repo/docs or approved copy deck.  
- Every outbound claim tied to a **source id** (doc section or product string).  
- **Human publishes** v1 for anything touching money, tax, or guarantees.

---

## 7. CTA ladder (avoid “sign up” fatigue)

Rotate CTAs:

1. **Follow / save** (algorithmic).  
2. **Comment prompt** (“Agencies: where do deals die—brief, legal, or payout?”).  
3. **Soft product** — “See how funded campaigns + approvals work” → landing or demo.  
4. **Hard product** — only when post is pure product receipt.

---

## 8. Governance (so you can sleep)

- **Brand kit** locked in Figma/Notion: logo, colors, 6 approved screenshots, 10 approved phrases.  
- **Banned phrases** (example): “guaranteed viral,” “passive income,” unverified competitor stats.  
- **Approval queue:** strategist proposes weekly plan → one owner approves batch → writer fills → editor → scheduled.  
- **Incident button:** pause all scheduled posts if a production bug or payout incident hits social.

---

## 9. KPIs (90-day)

| North star | Supporting |
| ---------- | ----------- |
| Qualified conversations (DMs / demo requests / inbound from social) | Saves, shares, comment quality |
| **Message clarity** | Survey: “In one sentence, what does Verza do?” on a small creator/agency panel |
| **Content efficiency** | Hours saved vs pre-agent baseline |

---

## 10. Agent starter prompts (paste into your agent harness)

**Strategist — weekly plan**  
```
You are Verza’s social strategist. Read docs/BRAND_SIDE_TECHNICAL_BRIEF.md themes only—do not invent product rules.
Output: (1) One theme for each pillar for next week. (2) Five hook lines per theme. (3) Recommended channel per idea.
Constraints: no income guarantees; no legal/tax advice; no competitor attacks.
```

**Writer — single post**  
```
Write one post for [PILLAR] on [CHANNEL], max [N] characters.
Voice: operator-insider, concrete, short sentences. CTA: [ladder step].
Include one specific product behavior (escrow, Verza Score, roster split, approvals) grounded in approved docs only.
End with 3 hashtags max or none for LinkedIn.
```

**Editor — safety pass**  
```
Given the draft below, list: (1) any unverifiable claims, (2) anything that could be read as legal/financial advice, (3) suggested fixes. Do not rewrite until claims are verified or removed.
```

---

## 11. Next build steps (engineering + marketing)

1. **Single source of truth** — export “approved claims” from product/marketing into a small JSON or Notion DB agents must cite.  
2. **Content calendar table** — pillar, channel, status, owner, source link, publish time.  
3. **Repurpose pipeline** — one “canonical” weekly memo → derivatives (optional script in repo or n8n/Make).  
4. **Analytics** — UTM on every CTA; weekly review in Notion.  
5. **Optional:** `@verza` “face” account later if a consistent host emerges; keep OS voice either way.

---

## 12. One-sentence north star for the “creator”

**Verza OS teaches the messy middle of the creator economy—money, quality, and ops—and shows how software makes it boring in the best way.**

When in doubt, ask: *Would a top agency operator save this post, or roll their eyes?*

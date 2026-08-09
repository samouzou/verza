#!/usr/bin/env node
/**
 * Verza LinkedIn — first-pass draft generator (standalone; not Optic).
 *
 * Usage:
 *   node marketing/verza-linkedin/scripts/generate-drafts.mjs
 *   node marketing/verza-linkedin/scripts/generate-drafts.mjs --dry-run
 *
 * Env:
 *   GEMINI_API_KEY (required unless --dry-run; same secret name as Firebase `params.ts`)
 *   GEMINI_MODEL (optional, default gemini-3.6-flash — matches apps/optic-worker)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINKEDIN_ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DRAFTS_DIR = path.join(LINKEDIN_ROOT, "drafts");
const QUEUE_PATH = path.join(LINKEDIN_ROOT, "queue.json");
const BRIEF_PATH = path.join(REPO_ROOT, "docs", "BRAND_SIDE_TECHNICAL_BRIEF.md");
const STRATEGY_PATH = path.join(REPO_ROOT, "docs", "VERZA_SOCIAL_CREATOR_STRATEGY.md");
const BANNED_PATH = path.join(LINKEDIN_ROOT, "BANNED_CLAIMS.md");

const DRY = process.argv.includes("--dry-run");
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const MAX_CTX = 14000;

function readTruncated(filePath) {
  if (!fs.existsSync(filePath)) {
    return `(missing file: ${path.relative(REPO_ROOT, filePath)})`;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.length > MAX_CTX ? raw.slice(0, MAX_CTX) + "\n\n[truncated…]" : raw;
}

function loadQueue() {
  if (!fs.existsSync(QUEUE_PATH)) {
    console.error(
      `Missing ${path.relative(REPO_ROOT, QUEUE_PATH)}.\n` +
        `Copy queue.example.json → queue.json and fill hooks + product truths.`,
    );
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    console.error("queue.json must contain a non-empty \"items\" array.");
    process.exit(1);
  }
  return data;
}

function buildSystemPrompt(brief, strategy, banned) {
  return `You are a LinkedIn ghostwriter for Verza (verza / tryverza). Verza is the operating system for the creator economy.

VOICE: operator-insider, concrete, respectful, no hype. Short lines. No hashtag spam (max 3 if any).

RULES:
- Use ONLY the product facts implied by the CONTEXT below plus the user's "productTruth" line for each task. Do not invent fees, thresholds, features, or legal outcomes.
- Obey the BANNED / sensitive list literally.
- LinkedIn: strong first line (hook). Use whitespace. Optional short numbered list (max 3 bullets).
- Never guarantee income, ROI, or virality. No legal/tax advice.

CONTEXT — BRAND / PRODUCT BRIEF:
---
${brief}
---

CONTEXT — SOCIAL STRATEGY (excerpt):
---
${strategy}
---

BANNED / SENSITIVE (compliance):
---
${banned}
---
`;
}

function userMessageForItem(item, weekLabel) {
  const pillar = item.pillar || "playbooks";
  const format = item.format || "short_post";
  const hook = (item.hook || "").trim() || "(author may supply hook—propose 2 hook options in line 1)";
  const truth = (item.productTruth || "").trim() || "(no productTruth supplied—keep post generic about category, no Verza-specific claims)";
  const cta = item.cta || "comment";
  const notes = (item.notes || "").trim();

  if (format === "carousel_outline") {
    return `Week: ${weekLabel}

Write a LinkedIn **document carousel outline** (7–10 slides).

Pillar: ${pillar}
Suggested hook direction: ${hook}
Product truth to reflect (do not exceed it): ${truth}
CTA type: ${cta}
Extra notes: ${notes || "none"}

Output format (markdown):
## Slide 1 — Hook
- title (5 words max)
- 1–2 bullets

Repeat ## Slide N for each slide. Last slide must be CTA only (soft, no hard sell unless cta is hard_product).

Do not claim specific Verza metrics not in the product truth.`;
  }

  return `Week: ${weekLabel}

Write ONE LinkedIn post (plain text, not markdown headings except optional one ## title is ok—prefer none).

Pillar: ${pillar}
Format: short post
Hook / direction: ${hook}
Product truth you may assume (do not exceed): ${truth}
CTA type: ${cta}  (map: follow = ask to follow for part 2; comment = ask a specific question; soft_product = point to app.tryverza.com lightly; hard_product = clearer CTA still honest)
Extra notes: ${notes || "none"}

Structure:
- Line 1 must work as LinkedIn preview ( punchy, under ~140 chars if possible).
- Then body: 4–10 short lines.
- End with one CTA line.`;
}

async function geminiComplete(system, user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set.");
  }
  const {GoogleGenerativeAI} = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(key);
  const genModel = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: system,
    generationConfig: {temperature: 0.7},
  });
  const result = await genModel.generateContent(user);
  const text = result.response.text();
  if (!text?.trim()) {
    throw new Error("Gemini returned no content.");
  }
  return text.trim();
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "draft";
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const queue = loadQueue();
  const weekLabel = queue.weekLabel || todayStamp();
  const reviewer = queue.reviewer || "Serge";

  const brief = readTruncated(BRIEF_PATH);
  const strategy = readTruncated(STRATEGY_PATH);
  const banned = readTruncated(BANNED_PATH);
  const system = buildSystemPrompt(brief, strategy, banned);

  if (!fs.existsSync(DRAFTS_DIR)) {
    fs.mkdirSync(DRAFTS_DIR, {recursive: true});
  }

  if (!DRY && !process.env.GEMINI_API_KEY) {
    console.error("Set GEMINI_API_KEY or use --dry-run.");
    process.exit(1);
  }

  for (const item of queue.items) {
    const id = item.id || "post";
    const userMsg = userMessageForItem(item, weekLabel);
    const stamp = todayStamp();
    const filename = `${stamp}-${slug(id)}.md`;
    const outPath = path.join(DRAFTS_DIR, filename);

    let body;
    if (DRY) {
      body =
        `_Dry run — no API call._\n\n` +
        `**Planned user prompt:**\n\n${userMsg}\n`;
    } else {
      process.stdout.write(`Generating ${id} (${MODEL})… `);
      body = await geminiComplete(system, userMsg);
      console.log("done.");
    }

    const front = [
      "---",
      `title: "LinkedIn — ${id}"`,
      `week_label: "${weekLabel}"`,
      `pillar: "${item.pillar || ""}"`,
      `format: "${item.format || "short_post"}"`,
      `cta: "${item.cta || ""}"`,
      `reviewer: "${reviewer}"`,
      `status: first_pass`,
      `generated_at: "${new Date().toISOString()}"`,
      `generator: marketing/verza-linkedin/scripts/generate-drafts.mjs`,
      `model: "${DRY ? "dry-run" : MODEL}"`,
      "---",
      "",
    ].join("\n");

    fs.writeFileSync(outPath, front + body + "\n", "utf8");
    console.log(`Wrote ${path.relative(REPO_ROOT, outPath)}`);
  }

  console.log(DRY ? "\nDry run complete." : "\nFirst passes ready for Serge’s edit.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

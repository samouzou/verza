"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlignLeft,
  ArrowRight,
  Banknote,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  LayoutGrid,
  Percent,
  Presentation,
  Target,
  Timer,
  UserCog,
  Users,
  Zap,
} from "lucide-react";

const SLIDE_COUNT = 8;

export default function AgencyOverviewDeck() {
  const [viewMode, setViewMode] = useState<"deck" | "scroll">("deck");
  const [activeSlide, setActiveSlide] = useState(0);
  const deckRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewMode !== "deck") return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setActiveSlide((p) => (p + 1) % SLIDE_COUNT);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActiveSlide((p) => (p - 1 + SLIDE_COUNT) % SLIDE_COUNT);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode]);

  const next = () => setActiveSlide((p) => (p + 1) % SLIDE_COUNT);
  const prev = () => setActiveSlide((p) => (p - 1 + SLIDE_COUNT) % SLIDE_COUNT);

  const thumbLabels = [
    { label: "Hero", icon: Zap },
    { label: "Collections", icon: Banknote },
    { label: "Roster", icon: Users },
    { label: "Splits", icon: Percent },
    { label: "Contracts", icon: FileText },
    { label: "Programs", icon: Target },
    { label: "Team", icon: UserCog },
    { label: "Get started", icon: LayoutGrid },
  ] as const;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-teal-500/30 selection:text-teal-100 overflow-x-hidden font-sans">
      <div className="absolute top-0 right-1/4 h-[480px] w-[480px] rounded-full bg-teal-600/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 h-[520px] w-[520px] rounded-full bg-emerald-600/10 blur-[130px] pointer-events-none" />

      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-teal-600 to-emerald-600 shadow-lg shadow-teal-500/20">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <span className="bg-gradient-to-r from-white via-slate-100 to-teal-400 bg-clip-text text-lg font-extrabold tracking-tight text-transparent sm:text-xl">
              VERZA
            </span>
            <span className="ml-2 whitespace-nowrap rounded border border-teal-500/20 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-teal-500">
              Agency deck
            </span>
          </div>
        </div>

        <div className="order-last flex w-full items-center justify-center sm:order-none sm:w-auto sm:justify-end">
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => setViewMode("deck")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3 ${
                viewMode === "deck"
                  ? "bg-teal-600 text-white shadow-md shadow-teal-600/25"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Presentation className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Slides</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("scroll")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3 ${
                viewMode === "scroll"
                  ? "bg-teal-600 text-white shadow-md shadow-teal-600/25"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <AlignLeft className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Scroll</span>
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/overview"
            className="hidden text-xs font-bold text-slate-400 transition-colors hover:text-slate-200 md:inline"
          >
            Brand deck
          </Link>
          <Link
            href="/overview/sponsorship"
            className="hidden text-xs font-bold text-slate-400 transition-colors hover:text-slate-200 lg:inline"
          >
            Sponsorship
          </Link>
          <Link
            href="/login"
            className="hidden text-xs font-bold text-slate-400 transition-colors hover:text-slate-200 sm:inline"
          >
            Sign in
          </Link>
          <a
            href="https://tryverza.com/demo"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-950 shadow transition-all hover:bg-slate-200 sm:px-4"
          >
            Book demo <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {viewMode === "deck" ? (
          <div className="animate-in fade-in space-y-6 duration-300">
            <div
              ref={deckRef}
              className="relative flex min-h-[560px] flex-col justify-between overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-2xl backdrop-blur-sm sm:min-h-[620px]"
            >
              <div className="flex h-1 w-full bg-slate-850">
                {Array.from({ length: SLIDE_COUNT }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-full flex-1 transition-all duration-300 ${
                      idx <= activeSlide ? "bg-teal-500" : "bg-slate-800"
                    }`}
                  />
                ))}
              </div>

              <div className="flex flex-1 flex-col justify-center p-6 sm:p-10 md:p-12">
                {activeSlide === 0 && <SlideAgencyHero />}
                {activeSlide === 1 && <SlideCollections />}
                {activeSlide === 2 && <SlideRoster />}
                {activeSlide === 3 && <SlideSplits />}
                {activeSlide === 4 && <SlideContracts />}
                {activeSlide === 5 && <SlidePrograms />}
                {activeSlide === 6 && <SlideTeam />}
                {activeSlide === 7 && <SlideAgencyCTA />}
              </div>

              <div className="flex flex-col items-stretch justify-between gap-3 border-t border-slate-800 bg-slate-900 px-4 py-4 sm:flex-row sm:items-center sm:px-8">
                <div className="text-center text-[11px] font-medium text-slate-500 sm:text-left">
                  <kbd className="rounded bg-slate-800 px-1 text-[10px]">←</kbd> /{" "}
                  <kbd className="rounded bg-slate-800 px-1 text-[10px]">→</kbd> or space
                </div>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-sm font-semibold text-slate-400">
                    <span className="text-slate-100">{activeSlide + 1}</span> / {SLIDE_COUNT}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={prev}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 transition-colors hover:bg-slate-800"
                      aria-label="Previous slide"
                    >
                      <ChevronLeft className="h-5 w-5 text-slate-200" />
                    </button>
                    <button
                      type="button"
                      onClick={next}
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 shadow-md shadow-teal-600/20 transition-colors hover:bg-teal-500"
                      aria-label="Next slide"
                    >
                      <ChevronRight className="h-5 w-5 text-white" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-8">
              {thumbLabels.map((t, idx) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setActiveSlide(idx)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-all sm:p-3 ${
                      activeSlide === idx
                        ? "border-teal-500/60 bg-teal-500/10 shadow-lg shadow-teal-500/10"
                        : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${activeSlide === idx ? "text-teal-500" : "text-slate-500"}`} />
                    <span className="line-clamp-2 text-[9px] font-bold leading-tight text-slate-400 sm:text-[10px]">
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in space-y-10 duration-300">
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideAgencyHero />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideCollections />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideRoster />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideSplits />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideContracts />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlidePrograms />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideTeam />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideAgencyCTA />
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/40 px-6 py-8 text-center text-xs text-slate-500">
        <p>
          © {new Date().getFullYear()} Verza Technologies, Inc. Agency overview — metrics and timelines on slides are
          illustrative unless cited as observed program outcomes.
        </p>
      </footer>
    </div>
  );
}

function SlideAgencyHero() {
  return (
    <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal-500">
          <Timer className="h-3 w-3" /> Built for agency velocity
        </div>
        <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl md:text-5xl">
          Roster talent faster.{" "}
          <span className="bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-300 bg-clip-text text-transparent">
            Collect from brands faster.
          </span>
        </h1>
        <p className="text-base leading-relaxed text-slate-400 md:text-lg">
          Verza is the operating layer for agencies who live in the gap between <strong>signed SOWs</strong> and{" "}
          <strong>cash in your account</strong>—roster onboarding, contract execution, automated invoice follow-ups,
          split payouts, and campaign funding in one workspace (not a stack of spreadsheets and status threads).
        </p>
        <ul className="grid gap-3 pt-2 sm:grid-cols-2">
          {[
            "Roster + permissions so the right people touch the right deals",
            "Automated invoice reminders—brands keep net 30/60/90; you still get paid sooner",
            "Automatic payment splits between agency and talent",
            "Contracts, e-sign, and audit trail tied to each program",
          ].map((line) => (
            <li key={line} className="flex gap-2 text-sm text-slate-300">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="lg:col-span-5">
        <div className="relative space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-500">What agencies optimize</span>
            <span className="text-[10px] font-semibold text-emerald-400">Live programs</span>
          </div>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Creators invited → cleared this month</span>
              <span className="font-mono text-slate-200">34 → 28</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Open client invoices (automated cadence)</span>
              <span className="font-mono text-slate-200">5</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Split payouts queued / sent</span>
              <span className="font-mono text-slate-200">$128k</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Contracts awaiting signature</span>
              <span className="font-mono text-amber-300">3</span>
            </div>
          </div>
          <p className="border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-500">
            When the workflow is in one system, finance stops chasing PDFs and account teams stop re-briefing creators—
            <strong className="text-slate-300"> speed is margin</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}

function SlideCollections() {
  return (
    <div className="mx-auto grid max-w-5xl items-start gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-400">
          <Banknote className="h-3.5 w-3.5" /> Collections
        </div>
        <h2 className="text-2xl font-black leading-tight text-white md:text-4xl">
          Automated invoice follow-ups—without changing the brand&apos;s terms
        </h2>
        <p className="text-sm leading-relaxed text-slate-400 md:text-base">
          Brands stay on <strong>net 30, 60, or 90</strong> in the contract. Verza still runs a disciplined reminder
          workflow on your invoices—sent, viewed, overdue, and payment events logged on each deal—so AP hears from you
          on a predictable cadence instead of when someone remembers to nudge.
        </p>
        <p className="text-sm leading-relaxed text-slate-400">
          In live programs we&apos;ve seen <strong>client invoices clear in about two weeks</strong> where the same
          brands historically paid on much longer nets—because the process is automated and visible, not because legal
          rewrote payment policy.
        </p>
      </div>
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Illustrative timeline</p>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>Typical net terms (unchanged)</span>
              <span className="font-mono text-slate-300">Net 60</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full w-[85%] rounded-full bg-slate-600" />
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>Observed cash on Verza programs (example)</span>
              <span className="font-mono text-emerald-400">~14 days</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full w-[22%] rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
            </div>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Bar lengths are schematic. Your results vary by client and category—the point is{" "}
          <strong className="text-slate-300">systematic follow-up</strong> compresses calendar time to cash without
          fighting procurement over clause edits.
        </p>
      </div>
    </div>
  );
}

function SlideRoster() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal-500">
          <Users className="h-3.5 w-3.5" /> Roster management
        </div>
        <h2 className="text-2xl font-black text-white md:text-4xl">One roster. Every client program.</h2>
        <p className="mx-auto max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
          Invite creators once, attach them to the right brand workspaces, and reuse them across campaigns. Per-creator
          commission defaults mean you are not re-keying economics on every insertion order—roster data and deal terms
          stay attached to the talent profile your team already trusts.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-bold text-slate-100">Faster onboarding</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Invites, acceptance, and banking/tax capture live in-product so &quot;we&apos;re waiting on W9 / wire
            details&quot; stops blocking roster activation.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-bold text-slate-100">Scoped to each client</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Brand guides, products, and campaign context travel with the deployment—creators see the right brief, ops
            sees the right budget, finance sees the right invoice.
          </p>
        </div>
      </div>
    </div>
  );
}

function SlideSplits() {
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal-500">
          <Percent className="h-3.5 w-3.5" /> Splits & payouts
        </div>
        <h2 className="text-2xl font-black leading-tight text-white md:text-4xl">
          Automatic payment splits—talent paid, agency share protected
        </h2>
        <p className="text-sm leading-relaxed text-slate-400 md:text-base">
          When a brand funds a program, Verza can route creator payouts and agency economics through the same rails you
          used to close the deal—fewer manual wires, fewer &quot;who owes who&quot; spreadsheets, and a clearer story
          for your GM on take rate per activation.
        </p>
        <p className="text-sm leading-relaxed text-slate-400">
          Consolidated billing to Verza (where applicable) means finance writes <strong>one check pattern</strong> while
          creators still get paid on time—automation handles the fan-out, not a coordinator with a CSV.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 text-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Example split</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="block text-slate-500">Creator gross</span>
            <span className="text-lg font-black text-white">$2,000</span>
          </div>
          <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-3">
            <span className="block text-teal-400/80">Agency commission (e.g. 20%)</span>
            <span className="text-lg font-black text-teal-300">$400</span>
          </div>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          Illustrative percentages. Production rules follow the commission and campaign configuration on each deal.
        </p>
      </div>
    </div>
  );
}

function SlideContracts() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/20 bg-emerald-600/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-500">
          <FileText className="h-3.5 w-3.5" /> Contract management
        </div>
        <h2 className="text-2xl font-black text-white md:text-4xl">Paperwork that keeps pace with pitches</h2>
        <p className="mx-auto max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
          Generate, send, and track agreements where the campaign already lives. Creators and clients e-sign in flow;
          versions and status are visible to account and legal—so you are not exporting PDFs to three different drives
          the night before a shoot.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "Single source of truth",
            body: "Deal terms, signatures, and invoice state linked to the same program record.",
          },
          {
            title: "Faster counter-parties",
            body: "Reminders and history on the document reduce “did you see my redlines?” latency.",
          },
          {
            title: "Client-ready discipline",
            body: "Brand guides and products attached to the workspace keep briefs aligned with what legal approved.",
          },
        ].map((c) => (
          <div key={c.title} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-center text-xs">
            <p className="font-bold text-slate-100">{c.title}</p>
            <p className="mt-2 leading-relaxed text-slate-500">{c.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlidePrograms() {
  return (
    <div className="mx-auto grid max-w-5xl items-start gap-8 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-400">
          <Target className="h-3.5 w-3.5" /> Programs & wallet
        </div>
        <h2 className="text-2xl font-black leading-tight text-white md:text-4xl">
          Fund deployments cleanly—release cash when work is real
        </h2>
        <p className="text-sm leading-relaxed text-slate-400 md:text-base">
          Sponsorships, grants, and performance-style programs run with <strong>headcount caps</strong> and{" "}
          <strong>escrow</strong> so brand money is committed before creators ship—and released on your approval. That
          keeps delivery, finance, and client reporting on the same rails: when the program closes, invoices and splits
          already know what happened.
        </p>
        <p className="text-sm leading-relaxed text-slate-400">
          Wallet balances separate <strong>available</strong> vs <strong>in escrow</strong> so account teams can answer
          “how much is left?” in one glance.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
          <span>Deployment</span>
          <span className="text-emerald-400">Funded</span>
        </div>
        <p className="mt-2 font-semibold text-slate-200">Q3 creator sprint — 12 creators · fixed fee each</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="block text-slate-500">Escrow held</span>
            <span className="text-lg font-black text-white">$24,000</span>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="block text-slate-500">Deliverables approved</span>
            <span className="text-lg font-black text-amber-300">8 / 12</span>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-slate-500">
          Illustrative numbers. Production balances reflect your workspace and live campaigns.
        </p>
      </div>
    </div>
  );
}

function SlideTeam() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-cyan-400">
          <UserCog className="h-3.5 w-3.5" /> Team & controls
        </div>
        <h2 className="text-2xl font-black text-white md:text-4xl">Owners, admins, members—same playbook</h2>
        <p className="mx-auto max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
          High-risk actions (billing, workspace settings) stay with owners; day-to-day operators move campaigns,
          roster, and contracts without sharing logins. Everyone pulls from the same data when the client asks for a
          Friday 4pm status update.
        </p>
      </div>
      <div className="grid gap-3 text-center text-xs sm:grid-cols-3">
        {[
          { title: "Agency owner", body: "Billing, workspace, funding sources, sensitive controls." },
          { title: "Admin / member", body: "Campaigns, roster invites, contracts, invoice touchpoints." },
          { title: "Creators", body: "Submissions, signatures, payouts—without DMs for wire instructions." },
        ].map((c) => (
          <div key={c.title} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <p className="font-bold text-slate-100">{c.title}</p>
            <p className="mt-2 leading-relaxed text-slate-500">{c.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideAgencyCTA() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 text-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-400">
        <LayoutGrid className="h-3.5 w-3.5" /> Why teams switch
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
        <table className="w-full text-left text-xs md:text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950 text-[10px] font-bold uppercase tracking-wider text-slate-500 md:text-xs">
              <th className="p-3 md:p-4">Motion</th>
              <th className="p-3 md:p-4 text-rose-400">Typical shop</th>
              <th className="bg-teal-500/5 p-3 md:p-4 text-teal-400">Verza</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-300">
            {[
              {
                motion: "Roster → paid",
                legacy: "Email threads, drive folders, and manual status for who is cleared to work.",
                verza: "Invites, roster, banking/tax, and payouts tied to the same creator record.",
              },
              {
                motion: "Brand collections",
                legacy: "Account lead remembers to ping AP; net terms slip without anyone noticing.",
                verza: "Automated invoice follow-ups and history—terms unchanged, calendar time shrinks.",
              },
              {
                motion: "Splits & finance",
                legacy: "Spreadsheet math after every PO; multiple wires per activation.",
                verza: "Configured splits and consolidated flows—fewer touches, clearer margin.",
              },
              {
                motion: "Contracts",
                legacy: "PDF ping-pong; version drift between account and legal.",
                verza: "E-sign, tracking, and program context in one workspace.",
              },
            ].map((r) => (
              <tr key={r.motion} className="hover:bg-slate-850/30">
                <td className="p-3 align-top font-bold text-slate-100 md:p-4">{r.motion}</td>
                <td className="p-3 align-top leading-relaxed text-slate-500 md:p-4">{r.legacy}</td>
                <td className="bg-teal-500/5 p-3 align-top leading-relaxed text-teal-100/90 md:p-4">
                  <div className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" />
                    <span>{r.verza}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="text-2xl font-black leading-tight text-white md:text-3xl">See it on your next SOW</h3>
      <p className="text-sm leading-relaxed text-slate-400">
        Bring a live client program—we&apos;ll map roster, contracts, invoices, and splits to how your team already
        works.
      </p>
      <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
        <a
          href="https://app.tryverza.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-8 py-3.5 text-sm font-black text-slate-950 shadow-lg transition-transform hover:-translate-y-0.5 hover:bg-slate-100"
        >
          Open Verza <ArrowRight className="h-4 w-4" />
        </a>
        <a
          href="https://tryverza.com/demo"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-slate-600 bg-slate-900/80 px-8 py-3 text-sm font-bold text-white transition-all hover:border-slate-500"
        >
          Schedule demo <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <p className="pt-4 text-[11px] text-slate-600">
        Creator-facing product story?{" "}
        <Link href="/overview" className="font-semibold text-teal-500 hover:underline">
          Brand overview deck
        </Link>
        .
      </p>
    </div>
  );
}

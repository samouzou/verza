"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  Banknote,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  Mic,
  Presentation,
  Sparkles,
  Users,
} from "lucide-react";

const SLIDE_COUNT = 4;

export default function SponsorshipDeckPage() {
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
    { label: "Title", icon: Sparkles },
    { label: "The room", icon: Users },
    { label: "Fireside", icon: Mic },
    { label: "Packages", icon: Banknote },
  ] as const;

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 font-sans text-slate-100 selection:bg-amber-500/25 selection:text-amber-50">
      <div className="pointer-events-none absolute right-1/4 top-0 h-[420px] w-[420px] rounded-full bg-amber-500/10 blur-[110px]" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-[480px] w-[480px] rounded-full bg-rose-600/10 blur-[120px]" />

      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/85 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/verza-icon.svg" alt="Verza" width={36} height={36} className="shrink-0 rounded-lg" />
          <div className="min-w-0">
            <span className="bg-gradient-to-r from-white via-amber-100 to-rose-200 bg-clip-text text-lg font-extrabold tracking-tight text-transparent sm:text-xl">
              VERZA
            </span>
            <span className="ml-2 whitespace-nowrap rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-400">
              Sponsorship
            </span>
          </div>
        </div>

        <div className="order-last flex w-full justify-center sm:order-none sm:w-auto sm:justify-end">
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => setViewMode("deck")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3 ${
                viewMode === "deck"
                  ? "bg-amber-600 text-white shadow-md shadow-amber-600/25"
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
                  ? "bg-amber-600 text-white shadow-md shadow-amber-600/25"
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
            href="/overview/sponsorship/cannes"
            className="hidden text-xs font-bold text-slate-400 transition-colors hover:text-slate-200 lg:inline"
          >
            World App
          </Link>
          <Link
            href="/overview/sponsorship/cannes-wellness"
            className="hidden text-xs font-bold text-slate-400 transition-colors hover:text-slate-200 lg:inline"
          >
            Cannes wellness
          </Link>
          <Link
            href="/overview"
            className="hidden text-xs font-bold text-slate-400 transition-colors hover:text-slate-200 lg:inline"
          >
            Brand deck
          </Link>
          <Link
            href="/overview/agencies"
            className="hidden text-xs font-bold text-slate-400 transition-colors hover:text-slate-200 md:inline"
          >
            Agency deck
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
              className="relative flex min-h-[560px] flex-col justify-between overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/55 shadow-2xl backdrop-blur-sm sm:min-h-[620px]"
            >
              <div className="flex h-1 w-full bg-slate-850">
                {Array.from({ length: SLIDE_COUNT }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-full flex-1 transition-all duration-300 ${
                      idx <= activeSlide ? "bg-amber-500" : "bg-slate-800"
                    }`}
                  />
                ))}
              </div>

              <div className="flex flex-1 flex-col justify-center p-6 sm:p-10 md:p-12">
                {activeSlide === 0 && <SlideTitle />}
                {activeSlide === 1 && <SlideAudience />}
                {activeSlide === 2 && <SlideFireside />}
                {activeSlide === 3 && <SlidePackages />}
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
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600 shadow-md shadow-amber-600/25 transition-colors hover:bg-amber-500"
                      aria-label="Next slide"
                    >
                      <ChevronRight className="h-5 w-5 text-white" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              {thumbLabels.map((t, idx) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setActiveSlide(idx)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-all sm:p-3 ${
                      activeSlide === idx
                        ? "border-amber-500/50 bg-amber-500/10 shadow-lg shadow-amber-500/10"
                        : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${activeSlide === idx ? "text-amber-400" : "text-slate-500"}`} />
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
              <SlideTitle />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideAudience />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlideFireside />
            </section>
            <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 shadow-lg md:p-12">
              <SlidePackages />
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/50 px-6 py-8 text-center text-[11px] text-slate-600">
        <p>
          © {new Date().getFullYear()} Verza Technologies, Inc. Sponsorship materials for discussion only. Package details
          subject to final agreement.
        </p>
      </footer>
    </div>
  );
}

function SlideTitle() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
      <div className="mb-10 flex flex-wrap items-center justify-center gap-8 sm:gap-12">
        <div
          className="flex items-center gap-4 sm:gap-5"
          role="img"
          aria-label="Verza"
        >
          <Image src="/verza-icon.svg" alt="" width={72} height={72} className="drop-shadow-lg" priority />
          <span
            className="bg-gradient-to-r from-white via-amber-100 to-rose-200 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl md:text-6xl"
            aria-hidden
          >
            VERZA
          </span>
        </div>
        <span className="text-3xl font-light text-slate-500" aria-hidden>
          ×
        </span>
        <Image
          src="/gemini-logo.png"
          alt="Google Gemini"
          width={384}
          height={142}
          className="h-9 w-auto object-contain object-center sm:h-12"
          priority
        />
      </div>

      <h1 className="text-balance text-3xl font-black leading-[1.12] tracking-tight text-white sm:text-4xl md:text-5xl">
        High-Velocity Growth:{" "}
        <span className="bg-gradient-to-r from-amber-200 via-white to-rose-200 bg-clip-text text-transparent">
          Automating the Creator Pipeline
        </span>
      </h1>

      <p className="mt-6 max-w-2xl text-base font-medium text-slate-300 sm:text-lg">
        Automating the Creator Pipeline &amp; Scaling High-Velocity Growth Workflows via Multimodal AI.
      </p>

      <div className="mt-10 flex flex-col items-center gap-2 text-sm text-slate-400 sm:flex-row sm:gap-8">
        <span className="inline-flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-400" />
          <span className="font-semibold text-slate-200">June 25, 2026 · 5:30–8:30 PM</span>
        </span>
        <span className="hidden text-slate-600 sm:inline">|</span>
        <span className="inline-flex items-center gap-2">
          <MapPin className="h-4 w-4 text-rose-400" />
          <span className="font-semibold text-slate-200">Verza HQ · 300 Grant Ave, Suite 500, SF</span>
        </span>
      </div>
    </div>
  );
}

function SlideAudience() {
  const demographics = [
    "Seed to Series B Technology Founders",
    "Heads of Growth",
    "Marketing & Growth Operators",
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <header className="space-y-4 text-center md:text-left">
        <h2 className="text-3xl font-black tracking-tight text-white md:text-4xl">The Room</h2>
        <p className="text-base font-medium leading-relaxed text-slate-300 md:text-lg">
          A strictly curated registry of 80–100 high-signal, venture-backed founders and operators in San Francisco.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-12">
        <div>
          <p className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500">The cohort demographics</p>
          <ul className="space-y-3">
            {demographics.map((line) => (
              <li
                key={line}
                className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-200"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 to-transparent p-6 md:p-8">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-400">The bottom line</p>
          <p className="mt-4 text-sm font-medium leading-relaxed text-slate-100 md:text-base">
            Scaling teams treating creators as a high-leverage acquisition channel—actively navigating vendor
            onboarding, legal friction, tax compliance, and cross-border payouts. The precise audience for infrastructure
            that automates the contract-to-payout pipeline.
          </p>
        </div>
      </div>
    </div>
  );
}

function SlideFireside() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 text-center md:text-left">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-rose-300">
        <Mic className="h-3.5 w-3.5" /> The marquee moment
      </div>
      <h2 className="text-3xl font-black tracking-tight text-white md:text-4xl">The Fireside Briefing</h2>
      <p className="text-sm leading-relaxed text-slate-400 md:text-base">
        <strong className="text-slate-100">
          The Automated Growth Engine: Scaling Creator Infrastructure via Multimodal AI
        </strong>{" "}
        — a 20-minute masterclass with Verza Founder &amp; CEO{" "}
        <strong className="text-slate-100">Serge Amouzou</strong>, moderated by{" "}
        <strong className="text-slate-100">Merlin Yamssi, Generative AI Lead at Google</strong>, on how multimodal AI
        (like Gemini 3 Flash Image) automates contract parsing, quality assurance, and escrow.
      </p>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-left">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">For sponsors</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-300 md:text-base">
          Your brand sits beside Verza and Google in the highest-signal moment of the night, ahead of curated VIP
          roundtables of Seed–Series B founders and growth operators—away from the noise of a standard networking
          event.
        </p>
      </div>
    </div>
  );
}

function SlidePackages() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="text-center md:text-left">
        <h2 className="text-3xl font-black tracking-tight text-white md:text-4xl">Sponsorship packages</h2>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col rounded-2xl border-2 border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-slate-900/40 p-6 shadow-lg shadow-amber-500/5 sm:p-8">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">Tier 1: Title sponsor</div>
          <p className="text-2xl font-black text-white sm:text-3xl">$3,000 – $5,000</p>
          <ul className="mt-6 flex-1 space-y-4 text-sm leading-relaxed text-slate-300">
            <li className="flex gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                <strong className="text-white">&quot;Presented by [Sponsor Name]&quot;</strong> branding on all event
                marketing, RSVP pages, and step-and-repeat banners.
              </span>
            </li>
            <li className="flex gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                <strong className="text-white">3 VIP Tickets</strong> for Sponsor Representatives—includes reserved
                seating at the fireside and a seat at the curated VIP roundtables.
              </span>
            </li>
            <li className="flex gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                A dedicated <strong className="text-white">2-minute speaking slot / intro</strong> during opening
                remarks, before the fireside begins.
              </span>
            </li>
          </ul>
        </div>

        <div className="flex flex-col rounded-2xl border border-slate-700 bg-slate-900/50 p-6 sm:p-8">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Tier 2: Community sponsor</div>
          <p className="text-2xl font-black text-white sm:text-3xl">$1,500 – $2,000</p>
          <ul className="mt-6 flex-1 space-y-4 text-sm leading-relaxed text-slate-300">
            <li className="flex gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                Brand logo <strong className="text-white">prominently featured</strong> on event signage and digital RSVP
                pages.
              </span>
            </li>
            <li className="flex gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                <strong className="text-white">3 Tickets</strong> for Sponsor Representatives to attend the main event
                and network directly with founders.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

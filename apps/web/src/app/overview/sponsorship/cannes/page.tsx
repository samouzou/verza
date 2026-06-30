"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  AlertTriangle,
  ArrowRight,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  Presentation,
  ScanLine,
  Shield,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAILTO_PARTNER =
  "mailto:serge@tryverza.com?subject=" +
  encodeURIComponent("World App × Cannes Lions — Humanity Hub partnership");

const SLIDE_COUNT = 6;

const THUMB_LABELS = [
  { label: "Cover", icon: Sparkles },
  { label: "Crisis", icon: AlertTriangle },
  { label: "Protocol", icon: Shield },
  { label: "Hub", icon: ScanLine },
  { label: "Pipeline", icon: ArrowRight },
  { label: "Scope", icon: Banknote },
] as const;

const PIPELINE_STEPS = [
  {
    step: "01",
    title: "Verify",
    body: "Attendee scans to verify their World ID at the Humanity Hub entry point.",
  },
  {
    step: "02",
    title: "Unlock",
    body: "Instantly unlocks premium amenities, fast-pass access, and networking tracking inside the verified zone.",
  },
  {
    step: "03",
    title: "Onboard",
    body: "World App seamlessly onboards global creative directors, CMOs, and tech innovators into the ecosystem during the festival.",
  },
] as const;

const PARTNERSHIP_DELIVERABLES = [
  "Complete structural design of the Humanity Hub activation",
  "Physical-to-digital World ID protocol integration",
  "End-to-end event execution and on-site operations",
  "Post-festival data and onboarding performance report",
] as const;

function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setVisible(true);
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, visible };
}

function RevealSection({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function WorldMark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const orb = size === "lg" ? "h-14 w-14 border-[2.5px]" : "h-9 w-9 border-2";
  const word = size === "lg" ? "text-4xl sm:text-5xl" : "text-2xl";
  return (
    <div className="flex items-center justify-center gap-4" role="img" aria-label="World App">
      <div
        className={`${orb} rounded-full border-white/90 bg-gradient-to-br from-white/15 to-white/5 shadow-[0_0_40px_rgba(255,255,255,0.08)]`}
        aria-hidden
      />
      <span className={`${word} font-normal lowercase tracking-[-0.04em] text-white`} aria-hidden>
        world
      </span>
    </div>
  );
}

export default function CannesWorldAppDeckPage() {
  const [viewMode, setViewMode] = useState<"deck" | "scroll">("deck");
  const [activeSlide, setActiveSlide] = useState(0);
  const [successOpen, setSuccessOpen] = useState(false);
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

  const acceptPartnership = () => {
    window.location.href = MAILTO_PARTNER;
    setSuccessOpen(true);
  };

  const goToScopeSlide = () => {
    if (viewMode === "deck") {
      setActiveSlide(5);
      return;
    }
    document.getElementById("partner-scope")?.scrollIntoView({ behavior: "smooth" });
  };

  const isDeck = viewMode === "deck";

  return (
    <div
      className={`min-h-screen antialiased selection:bg-white/20 selection:text-white ${
        isDeck ? "bg-[#0a0a0a] text-white" : "bg-[#f7f7f7] text-neutral-900"
      }`}
    >
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-md ${
          isDeck ? "border-white/10 bg-[#0a0a0a]/90" : "border-neutral-200 bg-[#f7f7f7]/90"
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/verza-icon.svg" alt="Verza" width={32} height={32} className="shrink-0 rounded-lg" />
            <div className="min-w-0 flex items-center gap-2">
              <span className={`text-sm font-semibold tracking-tight ${isDeck ? "text-white/90" : "text-neutral-900"}`}>
                Verza
              </span>
              <span className="text-white/30" aria-hidden>
                ×
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                  isDeck
                    ? "border-white/20 bg-white/5 text-white/70"
                    : "border-neutral-300 bg-white text-neutral-600"
                }`}
              >
                Humanity Hub
              </span>
            </div>
          </div>

          <div className="order-last flex w-full justify-center sm:order-none sm:w-auto sm:justify-end">
            <div
              className={`flex items-center gap-1 rounded-lg border p-1 ${
                isDeck ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
              }`}
            >
              <button
                type="button"
                onClick={() => setViewMode("deck")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3 ${
                  isDeck ? "bg-white text-black shadow-md" : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                <Presentation className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Slides</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("scroll")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3 ${
                  !isDeck ? "bg-neutral-900 text-white shadow-md" : "text-white/45 hover:text-white/75"
                }`}
              >
                <AlignLeft className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Scroll</span>
              </button>
            </div>
          </div>

          <nav className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] font-bold sm:text-xs">
            <Link
              href="/overview/sponsorship"
              className={`rounded-full px-2.5 py-1 transition-colors ${
                isDeck ? "text-white/50 hover:text-white" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              SF event
            </Link>
            <Link
              href="/overview/sponsorship/cannes-wellness"
              className={`rounded-full px-2.5 py-1 transition-colors ${
                isDeck ? "text-white/50 hover:text-white" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              Cannes wellness
            </Link>
            <Link
              href="/overview"
              className={`hidden rounded-full px-2.5 py-1 sm:inline ${
                isDeck ? "text-white/50 hover:text-white" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              Overview
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {isDeck ? (
          <div className="animate-in fade-in space-y-6 duration-300">
            <div
              ref={deckRef}
              className="relative flex min-h-[560px] flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-2xl sm:min-h-[620px]"
            >
              <div className="flex h-1 w-full bg-neutral-900">
                {Array.from({ length: SLIDE_COUNT }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-full flex-1 transition-all duration-300 ${
                      idx <= activeSlide ? "bg-white" : "bg-neutral-800"
                    }`}
                  />
                ))}
              </div>

              <div className="flex flex-1 flex-col justify-center overflow-hidden p-6 sm:p-10 md:p-12">
                {activeSlide === 0 && <SlideCover onCta={goToScopeSlide} variant="deck" />}
                {activeSlide === 1 && <SlideCrisis variant="deck" />}
                {activeSlide === 2 && <SlideProtocol variant="deck" />}
                {activeSlide === 3 && <SlideHub variant="deck" />}
                {activeSlide === 4 && <SlidePipeline variant="deck" />}
                {activeSlide === 5 && <SlideScope onAccept={acceptPartnership} variant="deck" />}
              </div>

              <div className="flex flex-col items-stretch justify-between gap-3 border-t border-white/10 bg-black/40 px-4 py-4 sm:flex-row sm:items-center sm:px-8">
                <div className="text-center text-[11px] font-medium text-white/40 sm:text-left">
                  <kbd className="rounded bg-white/10 px-1 text-[10px]">←</kbd> /{" "}
                  <kbd className="rounded bg-white/10 px-1 text-[10px]">→</kbd> or space
                </div>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-sm font-semibold text-white/45">
                    <span className="text-white">{activeSlide + 1}</span> / {SLIDE_COUNT}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={prev}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 transition-colors hover:bg-white/10"
                      aria-label="Previous slide"
                    >
                      <ChevronLeft className="h-5 w-5 text-white/90" />
                    </button>
                    <button
                      type="button"
                      onClick={next}
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-md transition-colors hover:bg-white/90"
                      aria-label="Next slide"
                    >
                      <ChevronRight className="h-5 w-5 text-black" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6 sm:gap-3">
              {THUMB_LABELS.map((t, idx) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setActiveSlide(idx)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-all sm:p-3 ${
                      activeSlide === idx
                        ? "border-white/30 bg-white/10 shadow-lg shadow-white/5"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${activeSlide === idx ? "text-white" : "text-white/35"}`} />
                    <span className="line-clamp-2 text-[9px] font-bold leading-tight text-white/45 sm:text-[10px]">
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in space-y-16 duration-300 sm:space-y-24">
            <RevealSection>
              <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-neutral-950 shadow-xl">
                <SlideCover onCta={goToScopeSlide} variant="scroll" />
              </section>
            </RevealSection>
            <RevealSection>
              <section className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-lg sm:p-12">
                <SlideCrisis variant="scroll" />
              </section>
            </RevealSection>
            <RevealSection>
              <section className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-lg sm:p-12">
                <SlideProtocol variant="scroll" />
              </section>
            </RevealSection>
            <RevealSection>
              <section className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-lg sm:p-12">
                <SlideHub variant="scroll" />
              </section>
            </RevealSection>
            <RevealSection>
              <section className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-lg sm:p-12">
                <SlidePipeline variant="scroll" />
              </section>
            </RevealSection>
            <RevealSection>
              <section id="partner-scope">
                <SlideScope onAccept={acceptPartnership} variant="scroll" />
              </section>
            </RevealSection>
          </div>
        )}
      </main>

      {isDeck && (
        <footer className="border-t border-white/10 px-6 py-8 text-center text-[11px] text-white/35">
          <p>
            © {new Date().getFullYear()} Verza Technologies, Inc. Partnership materials for World App × Cannes Lions
            activation — scope subject to final agreement.
          </p>
        </footer>
      )}

      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">Partnership inquiry opened</DialogTitle>
            <DialogDescription className="text-left text-[15px] leading-relaxed">
              We opened your email client with a pre-filled message to our partnerships team. Send the note to confirm
              interest — we&apos;ll reply with scope alignment and next steps.
            </DialogDescription>
          </DialogHeader>
          <Button type="button" variant="outline" className="w-full" onClick={() => setSuccessOpen(false)}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SlideVariant = "deck" | "scroll";

function SlideCover({ variant, onCta }: { variant: SlideVariant; onCta: () => void }) {
  const isDeck = variant === "deck";

  const inner = (
    <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
      <WorldMark size="lg" />
      <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.35em] text-white/50 sm:text-xs">
        World App × Cannes Lions 2026
      </p>
      <h1
        className={`mt-6 text-balance font-semibold tracking-tight text-white ${
          isDeck ? "text-3xl sm:text-4xl md:text-[2.75rem] md:leading-[1.08]" : "text-4xl sm:text-5xl md:text-6xl"
        }`}
      >
        The Identity Layer for the Creative Capital.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-white/60 sm:text-lg">
        World App × Cannes Lions 2026: Anchoring Elite Trust in the Age of AI.
      </p>
      <Button
        type="button"
        size="lg"
        onClick={onCta}
        className="mt-10 h-12 rounded-full bg-white px-8 text-sm font-bold text-black shadow-lg transition-transform hover:scale-[1.02] hover:bg-white/90"
      >
        View Partnership Scope
      </Button>
    </div>
  );

  if (isDeck) {
    return (
      <div className="relative -mx-6 -my-6 flex min-h-[400px] flex-col items-center justify-center overflow-hidden sm:-mx-10 sm:-my-10 md:-mx-12 md:-my-12">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.06)_0%,_transparent_70%)]"
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 opacity-[0.04]" aria-hidden>
          <div className="h-full w-full bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:48px_48px]" />
        </div>
        <div className="relative z-10 px-4 py-12 sm:px-8">{inner}</div>
      </div>
    );
  }

  return <div className="px-6 py-20 sm:px-12 sm:py-28">{inner}</div>;
}

function SlideCrisis({ variant }: { variant: SlideVariant }) {
  const isDeck = variant === "deck";
  const pains = [
    "Deepfakes and synthetic media erode confidence in who is speaking",
    "Bot networks inflate engagement and distort creator economics",
    "Brands and agencies can't distinguish real human ideas from artificial noise",
  ];

  return (
    <div className={`mx-auto space-y-8 ${isDeck ? "max-w-4xl" : "max-w-5xl"}`}>
      <div className={`inline-flex items-center gap-2 ${isDeck ? "text-white/50" : "text-neutral-500"}`}>
        <AlertTriangle className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-[0.2em]">The panic at Cannes</span>
      </div>
      <h2 className={`text-balance font-semibold tracking-tight ${isDeck ? "text-2xl text-white sm:text-3xl" : "text-3xl text-neutral-900 sm:text-4xl"}`}>
        The Authenticity Crisis.
      </h2>
      <p className={`max-w-3xl text-[15px] leading-[1.8] sm:text-base ${isDeck ? "text-white/70" : "text-neutral-600"}`}>
        AI has democratized creativity, but it has completely broken digital trust. Deepfakes, bots, and synthetic
        engagement are diluting the value of real human ideas. Brands and agencies at Cannes are asking:{" "}
        <strong className={isDeck ? "text-white" : "text-neutral-900"}>How do we know who is real?</strong>
      </p>
      <ul className="space-y-3">
        {pains.map((line) => (
          <li
            key={line}
            className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${
              isDeck ? "border-white/10 bg-white/[0.03] text-white/80" : "border-neutral-200 bg-neutral-50 text-neutral-700"
            }`}
          >
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${isDeck ? "text-white/40" : "text-neutral-400"}`} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SlideProtocol({ variant }: { variant: SlideVariant }) {
  const isDeck = variant === "deck";
  const pillars = [
    "Global identity protocol — not just a wallet",
    "Definitive filter between genuine human connection and artificial noise",
    "Proof of humanity at festival scale, not in a lab demo",
  ];

  return (
    <div className={`mx-auto space-y-8 ${isDeck ? "max-w-4xl" : "max-w-5xl"}`}>
      <div className={`inline-flex items-center gap-2 ${isDeck ? "text-white/50" : "text-neutral-500"}`}>
        <Shield className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-[0.2em]">The World App protocol</span>
      </div>
      <h2 className={`text-balance font-semibold tracking-tight ${isDeck ? "text-2xl text-white sm:text-3xl" : "text-3xl text-neutral-900 sm:text-4xl"}`}>
        Proof of Humanity at Scale.
      </h2>
      <p className={`max-w-3xl text-[15px] leading-[1.8] sm:text-base ${isDeck ? "text-white/70" : "text-neutral-600"}`}>
        Introduce World App not just as a wallet, but as the premier global identity protocol. It is the definitive
        filter that separates genuine human connection from artificial noise — deployed where the creative economy
        gathers in person.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {pillars.map((line) => (
          <div
            key={line}
            className={`rounded-2xl border p-5 ${
              isDeck ? "border-white/10 bg-white/[0.04]" : "border-neutral-200 bg-neutral-50"
            }`}
          >
            <Fingerprint className={`mb-3 h-5 w-5 ${isDeck ? "text-white/60" : "text-neutral-500"}`} />
            <p className={`text-sm leading-relaxed ${isDeck ? "text-white/80" : "text-neutral-700"}`}>{line}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideHub({ variant }: { variant: SlideVariant }) {
  const isDeck = variant === "deck";
  const concepts = [
    { label: "VIP Lounge", detail: "A premium physical footprint reserved for verified humans only." },
    { label: "Private Terrace", detail: "High-signal networking away from the Croisette noise." },
    { label: "Fast-Pass Entry", detail: "World ID unlocks exclusive access — no badge friction, no bots." },
  ];

  return (
    <div className={`mx-auto ${isDeck ? "max-w-5xl" : "max-w-6xl"}`}>
      <div className={`inline-flex items-center gap-2 ${isDeck ? "text-white/50" : "text-neutral-500"}`}>
        <ScanLine className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-[0.2em]">The activation</span>
      </div>
      <h2 className={`mt-4 text-balance font-semibold tracking-tight ${isDeck ? "text-2xl text-white sm:text-3xl" : "text-3xl text-neutral-900 sm:text-4xl"}`}>
        Exclusive Access, Verified Humans.
      </h2>
      <p className={`mt-4 max-w-3xl text-[15px] leading-[1.8] sm:text-base ${isDeck ? "text-white/70" : "text-neutral-600"}`}>
        The <strong className={isDeck ? "text-white" : "text-neutral-900"}>Humanity Hub</strong> — a premium physical
        footprint at Cannes where entry is unlocked exclusively via World ID on World App. A physical manifestation of
        a verified, high-value ecosystem.
      </p>

      <div className={`mt-8 grid gap-6 lg:grid-cols-2 lg:items-center ${isDeck ? "lg:gap-8" : "lg:gap-10"}`}>
        <div className="space-y-3">
          {concepts.map((c) => (
            <div
              key={c.label}
              className={`rounded-xl border px-4 py-4 ${
                isDeck ? "border-white/10 bg-white/[0.03]" : "border-neutral-200 bg-neutral-50"
              }`}
            >
              <p className={`text-sm font-semibold ${isDeck ? "text-white" : "text-neutral-900"}`}>{c.label}</p>
              <p className={`mt-1 text-sm leading-relaxed ${isDeck ? "text-white/60" : "text-neutral-600"}`}>
                {c.detail}
              </p>
            </div>
          ))}
        </div>
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl ring-1 ring-white/10">
          <Image
            src="/cannes-networking-section.png"
            alt="Premium networking environment at Cannes Lions — conceptual Humanity Hub setting"
            fill
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <p className="absolute bottom-4 left-4 right-4 text-xs font-semibold uppercase tracking-wider text-white/80">
            Humanity Hub · verified access only
          </p>
        </div>
      </div>
    </div>
  );
}

function SlidePipeline({ variant }: { variant: SlideVariant }) {
  const isDeck = variant === "deck";

  return (
    <div className={`mx-auto space-y-8 ${isDeck ? "max-w-4xl" : "max-w-5xl"}`}>
      <div className={`inline-flex items-center gap-2 ${isDeck ? "text-white/50" : "text-neutral-500"}`}>
        <ArrowRight className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-[0.2em]">Frictionless VIP pipeline</span>
      </div>
      <h2 className={`text-balance font-semibold tracking-tight ${isDeck ? "text-2xl text-white sm:text-3xl" : "text-3xl text-neutral-900 sm:text-4xl"}`}>
        Onboarding the Global Elite.
      </h2>
      <p className={`max-w-3xl text-[15px] leading-[1.8] ${isDeck ? "text-white/70" : "text-neutral-600"}`}>
        A frictionless user loop that converts Cannes foot traffic into verified World App ecosystem participants.
      </p>

      <div className="space-y-4">
        {PIPELINE_STEPS.map((s, i) => (
          <div
            key={s.step}
            className={`flex gap-4 rounded-2xl border p-5 sm:gap-6 sm:p-6 ${
              isDeck ? "border-white/10 bg-white/[0.03]" : "border-neutral-200 bg-neutral-50"
            }`}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                isDeck ? "bg-white text-black" : "bg-neutral-900 text-white"
              }`}
            >
              {s.step}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-base font-semibold ${isDeck ? "text-white" : "text-neutral-900"}`}>{s.title}</p>
              <p className={`mt-2 text-sm leading-relaxed ${isDeck ? "text-white/65" : "text-neutral-600"}`}>
                {s.body}
              </p>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <ArrowRight className={`hidden h-5 w-5 shrink-0 self-center sm:block ${isDeck ? "text-white/25" : "text-neutral-300"}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideScope({ variant, onAccept }: { variant: SlideVariant; onAccept: () => void }) {
  const isDeck = variant === "deck";

  const inner = (
    <>
      <div className={`inline-flex items-center gap-2 ${isDeck ? "text-white/50" : "text-neutral-500"}`}>
        <Banknote className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-[0.2em]">Corporate tier</span>
      </div>
      <h2 className={`mt-4 text-balance font-semibold tracking-tight ${isDeck ? "text-2xl text-white sm:text-3xl" : "text-3xl sm:text-4xl"}`}>
        Partnership Scope.
      </h2>
      <p className={`mt-6 text-5xl font-semibold tracking-tight sm:text-6xl ${isDeck ? "text-white" : "text-neutral-900"}`}>
        $60,000
      </p>
      <p className={`mt-2 text-sm font-medium ${isDeck ? "text-white/45" : "text-neutral-500"}`}>
        Flat corporate tier — no tiers, no discounts.
      </p>

      <ul className={`mx-auto mt-10 max-w-xl space-y-4 text-left ${isDeck ? "" : ""}`}>
        {PARTNERSHIP_DELIVERABLES.map((d) => (
          <li key={d} className={`flex gap-3 text-sm leading-relaxed ${isDeck ? "text-white/80" : "text-neutral-700"}`}>
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isDeck ? "text-white/60" : "text-neutral-900"}`} />
            <span>{d}</span>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        size="lg"
        onClick={onAccept}
        className={`mt-10 rounded-full px-10 text-sm font-bold shadow-lg transition-transform hover:scale-[1.02] ${
          isDeck
            ? "bg-white text-black hover:bg-white/90"
            : "bg-neutral-900 text-white hover:bg-neutral-800"
        }`}
      >
        Accept Partnership Scope
      </Button>
    </>
  );

  if (isDeck) {
    return <div className="mx-auto max-w-2xl text-center">{inner}</div>;
  }

  return (
    <div className="rounded-3xl border border-neutral-200 bg-neutral-950 px-6 py-12 text-center text-white shadow-2xl sm:px-12 sm:py-16">
      {inner}
    </div>
  );
}

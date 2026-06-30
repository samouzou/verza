"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  Anchor,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Presentation,
  Sparkles,
  Users,
  Waves,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAILTO_SPONSOR =
  "mailto:serge@tryverza.com?subject=" +
  encodeURIComponent("Cannes Lions Wellness Takeover — Sponsorship inquiry");

const SLIDE_COUNT = 5;

const CANNES_SCENE_IMAGES = [
  {
    src: "/cannes-branding-pannout-view.png",
    alt: "Wide-angle view of branded event experience and guest flow",
    caption: "Experience · panorama",
  },
  {
    src: "/cannes-layout.png",
    alt: "Event floor plan and beach house layout for the wellness takeover",
    caption: "Venue · layout",
  },
  {
    src: "/cannes-branding.png",
    alt: "Premium sponsor branding and step-and-repeat moments",
    caption: "Brand · visibility",
  },
  {
    src: "/cannes-networking-section.png",
    alt: "VIP networking on the beach at Cannes Lions Creator Beach",
    caption: "Creator Beach · networking",
  },
] as const;

const DELIVERABLES = [
  {
    title: "Physical Activation",
    body: "Your clinic's custom physical footprint directly inside the Creator Beach venue. A dedicated recovery lounge or wellness touchpoint for VIPs.",
    icon: Waves,
    image: "/cannes-layout.png",
    imageAlt: "Beach house floor plan and activation layout for the wellness partner footprint",
  },
  {
    title: "Premium Brand Visibility",
    body: '"Presented by" branding on event marketing and step-and-repeat banners alongside Verza as Lead Sponsor.',
    icon: Sparkles,
    image: "/cannes-branding.png",
    imageAlt: "Premium sponsor branding and step-and-repeat at the event",
  },
  {
    title: "VIP Access & Networking",
    body: '3 VIP Tickets for your representatives, granting access to the curated "Un-Networking Lounge" for direct client acquisition.',
    icon: Users,
    image: "/cannes-networking-section.png",
    imageAlt: "VIP guests networking in the Creator Beach environment",
  },
  {
    title: "Turn-Key Logistics",
    body: "Zero operational headache. The $25K package absorbs all backend event logistics, execution overhead, and credentialing.",
    icon: CheckCircle2,
    image: "/cannes-branding-pannout-view.png",
    imageAlt: "Panoramic view of branded event flow and guest experience",
  },
] as const;

const THUMB_LABELS = [
  { label: "Title", icon: Sparkles },
  { label: "Experience", icon: Waves },
  { label: "Opportunity", icon: Anchor },
  { label: "Package", icon: LayoutGrid },
  { label: "Partner", icon: Calendar },
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

export default function CannesWellnessSponsorshipPage() {
  const [viewMode, setViewMode] = useState<"deck" | "scroll">("deck");
  const [activeSlide, setActiveSlide] = useState(0);
  const [stickyCta, setStickyCta] = useState(false);
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

  useEffect(() => {
    if (viewMode !== "scroll") return;
    const onScroll = () => setStickyCta(window.scrollY > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [viewMode]);

  const next = () => setActiveSlide((p) => (p + 1) % SLIDE_COUNT);
  const prev = () => setActiveSlide((p) => (p - 1 + SLIDE_COUNT) % SLIDE_COUNT);

  const acceptSponsorship = () => {
    window.location.href = MAILTO_SPONSOR;
    setSuccessOpen(true);
  };

  const goToCtaSlide = () => {
    if (viewMode === "deck") {
      setActiveSlide(4);
      return;
    }
    document.getElementById("sponsor-cta")?.scrollIntoView({ behavior: "smooth" });
  };

  const isDeck = viewMode === "deck";

  return (
    <div
      className={`min-h-screen antialiased selection:bg-[#f5c518]/35 selection:text-[#042034] ${
        isDeck ? "bg-[#042034] text-white" : "bg-[#faf9f6] text-[#0a2342]"
      }`}
    >
      {!isDeck && (
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -right-24 top-0 h-[min(70vw,520px)] w-[min(70vw,520px)] rounded-full bg-[#0a3d62]/[0.07] blur-3xl" />
          <div className="absolute -left-32 bottom-0 h-[min(80vw,560px)] w-[min(80vw,560px)] rounded-full bg-[#e8dcc4]/80 blur-3xl" />
        </div>
      )}

      {isDeck && (
        <div className="pointer-events-none absolute right-1/4 top-0 h-[420px] w-[420px] rounded-full bg-[#1a5f8a]/20 blur-[110px]" />
      )}

      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-md ${
          isDeck
            ? "border-[#0a3d62]/80 bg-[#042034]/90"
            : "border-[#0a2342]/[0.06] bg-[#faf9f6]/90"
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/verza-icon.svg"
              alt="Verza"
              width={32}
              height={32}
              className="shrink-0 rounded-lg"
            />
            <div className="min-w-0">
              <span
                className={`text-sm font-extrabold tracking-tight sm:text-base ${
                  isDeck ? "text-white" : "text-[#0a2342]"
                }`}
              >
                Verza
              </span>
              <span
                className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                  isDeck
                    ? "border-[#f5c518]/30 bg-[#f5c518]/10 text-[#f5e6a8]"
                    : "border-[#0a3d62]/20 bg-[#0a3d62]/5 text-[#0a3d62]"
                }`}
              >
                Cannes Wellness
              </span>
            </div>
          </div>

          <div className="order-last flex w-full justify-center sm:order-none sm:w-auto sm:justify-end">
            <div
              className={`flex items-center gap-1 rounded-lg border p-1 ${
                isDeck ? "border-[#0a3d62] bg-[#0a2342]/60" : "border-[#0a2342]/10 bg-white"
              }`}
            >
              <button
                type="button"
                onClick={() => setViewMode("deck")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3 ${
                  isDeck
                    ? "bg-[#f5c518] text-[#042034] shadow-md shadow-black/20"
                    : "text-[#0a2342]/55 hover:text-[#0a2342]"
                }`}
              >
                <Presentation className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Slides</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("scroll")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all sm:px-3 ${
                  !isDeck
                    ? "bg-[#0a3d62] text-white shadow-md shadow-[#0a3d62]/25"
                    : isDeck
                      ? "text-white/50 hover:text-white/80"
                      : "text-[#0a2342]/55 hover:text-[#0a2342]"
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
                isDeck ? "text-white/55 hover:text-white" : "text-[#0a2342]/60 hover:text-[#0a2342]"
              }`}
            >
              SF event
            </Link>
            <Link
              href="/overview/sponsorship/cannes"
              className={`rounded-full px-2.5 py-1 transition-colors ${
                isDeck ? "text-white/55 hover:text-white" : "text-[#0a2342]/60 hover:text-[#0a2342]"
              }`}
            >
              World App
            </Link>
            <Link
              href="/overview"
              className={`hidden rounded-full px-2.5 py-1 sm:inline ${
                isDeck ? "text-white/55 hover:text-white" : "text-[#0a2342]/60 hover:text-[#0a2342]"
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
              className="relative flex min-h-[560px] flex-col justify-between overflow-hidden rounded-2xl border border-[#0a3d62] bg-[#0a2342]/55 shadow-2xl backdrop-blur-sm sm:min-h-[620px]"
            >
              <div className="flex h-1 w-full bg-[#042034]">
                {Array.from({ length: SLIDE_COUNT }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-full flex-1 transition-all duration-300 ${
                      idx <= activeSlide ? "bg-[#f5c518]" : "bg-[#0a3d62]"
                    }`}
                  />
                ))}
              </div>

              <div className="flex flex-1 flex-col justify-center overflow-hidden p-6 sm:p-10 md:p-12">
                {activeSlide === 0 && <SlideTitle onCta={goToCtaSlide} variant="deck" />}
                {activeSlide === 1 && <SlideExperience variant="deck" />}
                {activeSlide === 2 && <SlideOpportunity variant="deck" />}
                {activeSlide === 3 && <SlideDeliverables variant="deck" />}
                {activeSlide === 4 && <SlideCTA onAccept={acceptSponsorship} variant="deck" />}
              </div>

              <div className="flex flex-col items-stretch justify-between gap-3 border-t border-[#0a3d62] bg-[#042034]/80 px-4 py-4 sm:flex-row sm:items-center sm:px-8">
                <div className="text-center text-[11px] font-medium text-white/45 sm:text-left">
                  <kbd className="rounded bg-[#0a3d62] px-1 text-[10px]">←</kbd> /{" "}
                  <kbd className="rounded bg-[#0a3d62] px-1 text-[10px]">→</kbd> or space
                </div>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-sm font-semibold text-white/50">
                    <span className="text-white">{activeSlide + 1}</span> / {SLIDE_COUNT}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={prev}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#0a3d62] transition-colors hover:bg-[#0a3d62]"
                      aria-label="Previous slide"
                    >
                      <ChevronLeft className="h-5 w-5 text-white/90" />
                    </button>
                    <button
                      type="button"
                      onClick={next}
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f5c518] shadow-md shadow-black/20 transition-colors hover:bg-[#ffd54a]"
                      aria-label="Next slide"
                    >
                      <ChevronRight className="h-5 w-5 text-[#042034]" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
              {THUMB_LABELS.map((t, idx) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setActiveSlide(idx)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-all sm:p-3 ${
                      activeSlide === idx
                        ? "border-[#f5c518]/50 bg-[#f5c518]/10 shadow-lg shadow-[#f5c518]/10"
                        : "border-[#0a3d62] bg-[#0a2342]/40 hover:border-[#1a5f8a]"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${activeSlide === idx ? "text-[#f5e6a8]" : "text-white/40"}`}
                    />
                    <span className="line-clamp-2 text-[9px] font-bold leading-tight text-white/50 sm:text-[10px]">
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in space-y-20 duration-300 sm:space-y-28">
            <SlideTitle onCta={goToCtaSlide} variant="scroll" />
            <RevealSection>
              <section className="rounded-3xl border border-[#0a2342]/[0.06] bg-white p-6 shadow-xl sm:p-10">
                <SlideExperience variant="scroll" />
              </section>
            </RevealSection>
            <RevealSection>
              <section className="rounded-3xl border border-[#0a2342]/[0.06] bg-white p-8 shadow-xl sm:p-12">
                <SlideOpportunity variant="scroll" />
              </section>
            </RevealSection>
            <RevealSection>
              <section className="rounded-3xl border border-[#0a2342]/[0.06] bg-gradient-to-b from-white to-[#f4f0e8]/60 p-8 shadow-xl sm:p-12">
                <SlideDeliverables variant="scroll" />
              </section>
            </RevealSection>
            <RevealSection>
              <section id="sponsor-cta">
                <SlideCTA onAccept={acceptSponsorship} variant="scroll" />
              </section>
            </RevealSection>
          </div>
        )}
      </main>

      {isDeck && (
        <footer className="border-t border-[#0a3d62]/80 px-6 py-8 text-center text-[11px] text-white/40">
          <p>
            © {new Date().getFullYear()} Verza Technologies, Inc. Partnership materials — package details subject to
            final agreement with Cannes Lions organizers.
          </p>
        </footer>
      )}

      {!isDeck && (
        <div
          className={`fixed bottom-0 left-0 right-0 z-50 border-t border-[#0a2342]/10 bg-[#faf9f6]/95 px-4 py-3 backdrop-blur-md transition-transform duration-300 sm:py-4 md:hidden ${
            stickyCta ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <Button
            type="button"
            onClick={acceptSponsorship}
            className="h-11 w-full rounded-full bg-[#f5c518] text-sm font-bold text-[#042034] shadow-md"
          >
            Accept Sponsorship
          </Button>
        </div>
      )}

      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#0a2342]">
              <CheckCircle2 className="h-5 w-5 text-[#0a3d62]" />
              You&apos;re almost there
            </DialogTitle>
            <DialogDescription className="text-left text-[15px] leading-relaxed text-[#0a2342]/75">
              We opened your email client with a pre-filled message to our partnerships team. Send the note to
              confirm interest — we&apos;ll reply with next steps and run-of-show alignment details.
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="outline"
            className="w-full border-[#0a2342]/20"
            onClick={() => setSuccessOpen(false)}
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SlideVariant = "deck" | "scroll";

function SlideTitle({ variant, onCta }: { variant: SlideVariant; onCta: () => void }) {
  const isDeck = variant === "deck";

  const content = (
    <>
      <p
        className={`mx-auto inline-flex max-w-[95vw] items-center justify-center rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.28em] shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md sm:px-5 sm:text-sm sm:tracking-[0.32em] ${
          isDeck
            ? "border-white/20 bg-[#042034]/72 text-[#f5e6a8]"
            : "border-white/20 bg-[#042034]/72 text-[#f5e6a8]"
        }`}
      >
        Verza x Yellow Party Present
      </p>
      <h1
        className={`mt-5 text-balance font-semibold tracking-tight [text-shadow:0_2px_40px_rgba(0,0,0,0.35)] ${
          isDeck
            ? "text-3xl text-white sm:text-4xl md:text-5xl"
            : "text-4xl text-white sm:text-5xl md:text-6xl lg:text-[3.5rem] lg:leading-[1.05]"
        }`}
      >
        The Cannes Lions Wellness Takeover.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-white/85 sm:text-lg">
        Wednesday, June 24, 2026 | LIONS Creator Beach, Cannes, France.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:mt-10 sm:flex-row sm:gap-4">
        <Button
          type="button"
          size="lg"
          onClick={onCta}
          className="h-12 rounded-full bg-[#f5c518] px-8 text-sm font-bold text-[#042034] shadow-lg shadow-black/20 transition-transform hover:scale-[1.02] hover:bg-[#ffd54a]"
        >
          Secure the Wellness Partnership
        </Button>
      </div>
    </>
  );

  if (isDeck) {
    return (
      <div className="relative -mx-6 -my-6 flex min-h-[380px] flex-col items-center justify-center overflow-hidden text-center sm:-mx-10 sm:-my-10 sm:min-h-[420px] md:-mx-12 md:-my-12">
        <div className="absolute inset-0">
          <Image
            src="/cannes-branding-pannout-view.png"
            alt=""
            fill
            priority
            className="object-cover object-center"
            sizes="(max-width: 1280px) 100vw, 1280px"
            aria-hidden
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-[#042034]/90 via-[#0a3d62]/85 to-[#1a5f8a]/80" aria-hidden />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[min(55%,380px)] bg-gradient-to-b from-[#042034]/95 via-[#042034]/50 to-transparent"
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#042034]/95 via-transparent to-transparent" aria-hidden />
        <div className="relative z-10 px-4 py-10 sm:px-8">{content}</div>
      </div>
    );
  }

  return (
    <section className="relative isolate -mx-4 min-h-[min(92vh,900px)] overflow-hidden rounded-3xl sm:-mx-6">
      <div className="absolute inset-0">
        <Image
          src="/cannes-branding-pannout-view.png"
          alt="Experience panorama — branded beach activation and guest flow at LIONS Creator Beach, Cannes Lions"
          fill
          priority
          className="object-cover object-center"
          sizes="100vw"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-br from-[#042034]/88 via-[#0a3d62]/82 to-[#1a5f8a]/75" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[min(52%,420px)] bg-gradient-to-b from-[#042034]/90 via-[#042034]/45 to-transparent"
        aria-hidden
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#042034]/95 via-[#042034]/40 to-transparent" aria-hidden />
      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center justify-center px-4 pb-24 pt-20 text-center sm:px-6 sm:pb-28 sm:pt-28">
        {content}
      </div>
    </section>
  );
}

function SlideExperience({ variant }: { variant: SlideVariant }) {
  const isDeck = variant === "deck";

  return (
    <div className={`mx-auto ${isDeck ? "max-w-5xl" : "max-w-6xl"}`}>
      <div className={`flex items-center gap-2 ${isDeck ? "text-[#f5e6a8]" : "text-[#f5b800]"}`}>
        <Waves className="h-5 w-5" />
        <span className="text-xs font-bold uppercase tracking-[0.2em]">The experience</span>
      </div>
      <h2
        className={`mt-4 text-balance font-semibold tracking-tight ${
          isDeck ? "text-2xl text-white sm:text-3xl" : "text-3xl text-[#0a2342] sm:text-4xl"
        }`}
      >
        LIONS Creator Beach — your brand on the sand.
      </h2>
      <p
        className={`mt-4 max-w-2xl text-[15px] leading-relaxed ${
          isDeck ? "text-white/75" : "text-[#0a2342]/75"
        }`}
      >
        A curated takeover inside one of Cannes Lions&apos; most exclusive environments — immediately following the
        Social &amp; Creator Lions Awards.
      </p>

      <div className={`mt-8 overflow-hidden rounded-2xl ring-1 ${isDeck ? "ring-white/10" : "ring-[#0a2342]/10"}`}>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {CANNES_SCENE_IMAGES.map((img) => (
            <figure key={img.src} className="relative aspect-[4/3] overflow-hidden bg-[#042034]">
              <Image
                src={img.src}
                alt={img.alt}
                fill
                className="object-cover transition duration-700 ease-out hover:scale-[1.04]"
                sizes="(max-width: 1024px) 50vw, 25vw"
              />
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#042034]/90 to-transparent px-3 pb-3 pt-10 text-left text-[10px] font-semibold uppercase tracking-wider text-white/90 sm:text-[11px]">
                {img.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}

function SlideOpportunity({ variant }: { variant: SlideVariant }) {
  const isDeck = variant === "deck";
  const stats = [
    { label: "1,000+", sub: "Attendees" },
    { label: "88%", sub: "Work in Media, Tech, and Finance" },
    { label: "100%", sub: "VIP Passholders & Senior Decision Makers" },
  ];

  return (
    <div className={`mx-auto space-y-8 ${isDeck ? "max-w-5xl" : "max-w-6xl"}`}>
      <div>
        <div className={`flex items-center gap-2 ${isDeck ? "text-[#f5e6a8]" : "text-[#f5b800]"}`}>
          <Anchor className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.2em]">The opportunity</span>
        </div>
        <h2
          className={`mt-4 text-balance font-semibold tracking-tight ${
            isDeck ? "text-2xl text-white sm:text-3xl" : "text-3xl text-[#0a2342] sm:text-4xl"
          }`}
        >
          The Ultimate High-Signal Environment.
        </h2>
      </div>

      <div className={`grid gap-6 text-[15px] leading-[1.75] md:grid-cols-2 md:gap-10 ${isDeck ? "text-white/80" : "text-[#0a2342]/80"}`}>
        <p>
          We are locking in a premier takeover at the LIONS Creator Beach House immediately following the Social
          &amp; Creator Lions Awards. This is not a standard venue rental; it is a strategically aligned takeover
          inside one of the festival&apos;s most exclusive environments.
        </p>
        <p>
          Verza is stepping in as the main technology infrastructure lead, but the organizers have opened one
          exclusive, approved slot for a premium &quot;Wellness and Beauty&quot; partner to physically activate
          their services for VIP badge holders.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.sub}
            className={`rounded-2xl border px-5 py-6 text-center ${
              isDeck
                ? "border-[#0a3d62] bg-[#042034]/60"
                : "border-[#0a2342]/[0.06] bg-white shadow-md shadow-[#0a2342]/[0.03]"
            }`}
          >
            <p className={`text-2xl font-semibold tracking-tight sm:text-3xl ${isDeck ? "text-white" : "text-[#0a2342]"}`}>
              {s.label}
            </p>
            <p className={`mt-2 text-sm font-medium leading-snug ${isDeck ? "text-white/65" : "text-[#0a2342]/65"}`}>
              {s.sub}
            </p>
          </div>
        ))}
      </div>

      <p className={`text-center text-[15px] leading-relaxed ${isDeck ? "text-white/70" : "text-[#0a2342]/75"}`}>
        Connect directly with the world&apos;s top CMOs, brand agencies, and high-net-worth creators in a
        relaxed, human-first environment.
      </p>
    </div>
  );
}

function SlideDeliverables({ variant }: { variant: SlideVariant }) {
  const isDeck = variant === "deck";

  return (
    <div className={`mx-auto ${isDeck ? "max-w-5xl" : "max-w-6xl"}`}>
      <div className={`flex items-center gap-2 ${isDeck ? "text-[#f5e6a8]" : "text-[#f5b800]"}`}>
        <LayoutGrid className="h-5 w-5" />
        <span className="text-xs font-bold uppercase tracking-[0.2em]">Deliverables</span>
      </div>
      <h2
        className={`mt-4 text-balance font-semibold tracking-tight ${
          isDeck ? "text-2xl text-white sm:text-3xl" : "text-3xl text-[#0a2342] sm:text-4xl"
        }`}
      >
        The $25K Turn-Key Package
      </h2>
      <p className={`mt-2 text-base font-medium ${isDeck ? "text-white/70" : "text-[#0a2342]/75"}`}>
        The Wellness Takeover Deliverables.
      </p>

      <div className={`mt-8 grid gap-4 sm:grid-cols-2 ${isDeck ? "sm:gap-5" : "mt-12 gap-6"}`}>
        {DELIVERABLES.map((c) => (
          <div
            key={c.title}
            className={`group flex flex-col overflow-hidden rounded-2xl border ${
              isDeck
                ? "border-[#0a3d62] bg-[#042034]/50"
                : "border-[#0a2342]/[0.08] bg-white/90 shadow-sm hover:shadow-lg hover:shadow-[#0a2342]/[0.06]"
            }`}
          >
            <div className={`relative w-full shrink-0 overflow-hidden bg-[#e8dcc4]/40 ${isDeck ? "aspect-[16/9]" : "aspect-[16/10]"}`}>
              <Image
                src={c.image}
                alt={c.imageAlt}
                fill
                className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]"
                sizes="(max-width: 640px) 100vw, 50vw"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#042034]/25 to-transparent" />
            </div>
            <div className={`flex flex-1 flex-col ${isDeck ? "p-4 sm:p-5" : "p-7"}`}>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0a3d62] text-[#f5c518] sm:h-11 sm:w-11">
                <c.icon className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2} />
              </div>
              <h3 className={`mt-3 font-semibold sm:mt-5 ${isDeck ? "text-base text-white" : "text-lg text-[#0a2342]"}`}>
                {c.title}
              </h3>
              <p className={`mt-2 text-sm leading-relaxed ${isDeck ? "text-white/70" : "text-[#0a2342]/75"}`}>
                {c.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideCTA({ variant, onAccept }: { variant: SlideVariant; onAccept: () => void }) {
  const isDeck = variant === "deck";

  return (
    <div
      className={`mx-auto max-w-3xl text-center ${
        isDeck
          ? ""
          : "rounded-3xl border-2 border-[#f5c518]/50 bg-[#0a2342] px-6 py-12 text-white shadow-2xl sm:px-12 sm:py-16"
      }`}
    >
      <Calendar className={`mx-auto h-8 w-8 ${isDeck ? "text-[#f5e6a8]" : "text-[#f5c518]"}`} />
      <h2
        className={`mt-6 text-balance font-semibold tracking-tight ${
          isDeck ? "text-2xl text-white sm:text-3xl" : "text-2xl sm:text-3xl md:text-4xl"
        }`}
      >
        Lock In Your Execution Timeline.
      </h2>
      <p
        className={`mx-auto mt-5 max-w-2xl text-balance text-[15px] leading-relaxed sm:text-lg ${
          isDeck ? "text-white/75" : "text-white/80"
        }`}
      >
        Final alignment with the Cannes Lions organizing committee takes place this Tuesday at 10:00 AM PT. We
        need to hardcode the wellness partner into the run-of-show.
      </p>
      <Button
        type="button"
        size="lg"
        onClick={onAccept}
        className="mt-8 rounded-full bg-[#f5c518] px-10 text-sm font-bold text-[#042034] shadow-lg transition-transform hover:scale-[1.02] hover:bg-[#ffd54a] sm:mt-10"
      >
        Accept Sponsorship
      </Button>
    </div>
  );
}

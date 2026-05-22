"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  Sparkles,
  Search,
  Mail,
  FileText,
  CheckCircle2,
  Wallet,
  Lock,
  Scale,
  Plus,
  Heart,
  Info,
  ShieldCheck,
  Infinity as InfinityIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  BookOpen,
  RefreshCw,
  Play,
  Check,
  ExternalLink,
  DollarSign,
  Target,
  FileWarning,
  MousePointer2,
  Send,
  Zap,
  Building,
  UserCheck,
  AlertTriangle,
  Lightbulb,
  ArrowRight,
  Presentation,
  AlignLeft,
  Tv,
  Maximize2
} from "lucide-react";

// Types for Interactive Scouts
interface MockProfile {
  handle: string;
  platform: "instagram" | "tiktok" | "youtube";
  matchScore: number;
  reason: string;
  avatarColor: string;
  status: "pending" | "scanning" | "matched" | "skipped";
}

export default function BrandOverviewDeck() {
  // Dual-mode state: 'deck' (slide presentation) vs 'scroll' (continuous landing page)
  const [viewMode, setViewMode] = useState<"deck" | "scroll">("deck");
  const [activeSlide, setActiveSlide] = useState(0);

  // Dynamic interactive states
  // Slide 2: Optic AI Scout Simulator
  const [scoutBrief, setScoutBrief] = useState<"beauty" | "tech" | "fitness">("beauty");
  const [isScouting, setIsScouting] = useState(false);
  const [scoutProgress, setScoutProgress] = useState(0);
  const [scoutLogs, setScoutLogs] = useState<string[]>([]);
  const [scoutedProfiles, setScoutedProfiles] = useState<MockProfile[]>([]);
  const [selectedCreatorEmail, setSelectedCreatorEmail] = useState<string | null>(null);

  const [campaignType, setCampaignType] = useState<"sponsorship" | "grant" | "cause" | "barter">("sponsorship");
  const [ratePerCreator, setRatePerCreator] = useState<number>(1500);
  const [creatorsNeeded, setCreatorsNeeded] = useState<number>(15);
  const [isAffiliateEnabled, setIsAffiliateEnabled] = useState(false);
  const [affiliateType, setAffiliateType] = useState<"cpc" | "cpa">("cpa");
  const [affiliateRate, setAffiliateRate] = useState<number>(20);

  // Slide 4: Verza Quality Score Gating Simulator
  const [qualityThreshold, setQualityThreshold] = useState<number>(65);
  const [submissionScore, setSubmissionScore] = useState<number>(78);

  // Slide 5: AI Contract Audit Simulator
  const [isAuditingContract, setIsAuditingContract] = useState(false);
  const [contractAuditComplete, setContractAuditComplete] = useState(false);
  const [contractAuditStep, setContractAuditStep] = useState(0);

  // Slide 6: Consolidated Wallet Simulator
  const [walletTotal, setWalletTotal] = useState<number>(65000);
  const [walletEscrow, setWalletEscrow] = useState<number>(48200);
  const availableBalance = walletTotal - walletEscrow;

  const [topUpAmount, setTopUpAmount] = useState<string>("5000");
  const [showTopUpSuccess, setShowTopUpSuccess] = useState(false);
  const [payCreatorAmount, setPayCreatorAmount] = useState<string>("1200");
  const [selectedPayee, setSelectedPayee] = useState<string>("@sandra.green");
  const [showPaySuccess, setShowPaySuccess] = useState(false);

  // Slide references for scrolling in deck mode or continuous page
  const deckRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation for slide deck
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== "deck") return;
      if (e.key === "ArrowRight" || e.key === "Space") {
        e.preventDefault();
        nextSlide();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevSlide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode, activeSlide]);

  const slideCount = 7;

  const nextSlide = () => {
    setActiveSlide((prev) => (prev + 1) % slideCount);
  };

  const prevSlide = () => {
    setActiveSlide((prev) => (prev - 1 + slideCount) % slideCount);
  };

  // Run Scout simulation
  const runScoutSimulation = () => {
    setIsScouting(true);
    setScoutProgress(0);
    setScoutLogs([]);
    setSelectedCreatorEmail(null);

    const initialProfiles: MockProfile[] = [
      {
        handle: "@sandra.green",
        platform: "instagram",
        matchScore: 94,
        reason: "Organic skincare focus, 8.4% engagement rate, high audio authenticity.",
        avatarColor: "bg-emerald-500",
        status: "pending",
      },
      {
        handle: "@glam_reviews",
        platform: "youtube",
        matchScore: 42,
        reason: "Heavy commercial product placement, low viewer trust index.",
        avatarColor: "bg-red-500",
        status: "pending",
      },
      {
        handle: "@fit_beast",
        platform: "tiktok",
        matchScore: 89,
        reason: "Active workouts, high fitness enthusiast conversion rate.",
        avatarColor: "bg-indigo-500",
        status: "pending",
      },
      {
        handle: "@tech_unboxing",
        platform: "youtube",
        matchScore: 35,
        reason: "Hardware unboxing focus. Zero match with target audience.",
        avatarColor: "bg-blue-500",
        status: "pending",
      },
      {
        handle: "@organic_yogi",
        platform: "instagram",
        matchScore: 91,
        reason: "Clean living, holistic lifestyle focus. Fits wellness guidelines.",
        avatarColor: "bg-teal-500",
        status: "pending",
      },
    ];

    setScoutedProfiles(initialProfiles);

    const logs = [
      "Initializing AI Scout: Brief parsed successfully.",
      "Scanning target keywords & transcripts across Instagram/TikTok/YouTube...",
      "Opening profile: @sandra.green...",
      "Matching: 94% match. Bio fits. Engagement fits. Drafting email outreach.",
      "Opening profile: @glam_reviews...",
      "Skipping: 42% match. Fails brand safety filters.",
      "Opening profile: @fit_beast...",
      "Matching: 89% match. Fitness focus aligns. Drafting SMS outreach.",
      "Opening profile: @tech_unboxing...",
      "Skipping: Too tech-heavy, low interest overlap.",
      "Opening profile: @organic_yogi...",
      "Matching: 91% match. High lifestyle overlap. Drafting email outreach.",
      "Scout Mission Complete. 3 Leads pushed to Brand Vault.",
    ];

    let currentLogIndex = 0;
    const interval = setInterval(() => {
      setScoutProgress((prev) => {
        const next = prev + 8;
        if (next >= 100) {
          clearInterval(interval);
          setIsScouting(false);
          setScoutedProfiles((current) =>
            current.map((p) => {
              if (p.matchScore >= 80) return { ...p, status: "matched" };
              return { ...p, status: "skipped" };
            })
          );
          return 100;
        }
        return next;
      });

      // Update logs periodically
      if (currentLogIndex < logs.length) {
        setScoutLogs((prev) => [...prev, logs[currentLogIndex]]);
        // Update profile status during simulation
        if (currentLogIndex === 2) {
          setScoutedProfiles((curr) =>
            curr.map((p, idx) => (idx === 0 ? { ...p, status: "scanning" } : p))
          );
        } else if (currentLogIndex === 4) {
          setScoutedProfiles((curr) =>
            curr.map((p, idx) =>
              idx === 0 ? { ...p, status: "matched" } : idx === 1 ? { ...p, status: "scanning" } : p
            )
          );
        } else if (currentLogIndex === 6) {
          setScoutedProfiles((curr) =>
            curr.map((p, idx) =>
              idx === 1 ? { ...p, status: "skipped" } : idx === 2 ? { ...p, status: "scanning" } : p
            )
          );
        } else if (currentLogIndex === 8) {
          setScoutedProfiles((curr) =>
            curr.map((p, idx) =>
              idx === 2 ? { ...p, status: "matched" } : idx === 3 ? { ...p, status: "scanning" } : p
            )
          );
        } else if (currentLogIndex === 10) {
          setScoutedProfiles((curr) =>
            curr.map((p, idx) =>
              idx === 3 ? { ...p, status: "skipped" } : idx === 4 ? { ...p, status: "scanning" } : p
            )
          );
        }
        currentLogIndex++;
      }
    }, 600);
  };

  // Run AI Contract Audit simulation
  const runContractAudit = () => {
    setIsAuditingContract(true);
    setContractAuditComplete(false);
    setContractAuditStep(0);

    const interval = setInterval(() => {
      setContractAuditStep((prev) => {
        if (prev >= 4) {
          clearInterval(interval);
          setIsAuditingContract(false);
          setContractAuditComplete(true);
          return 4;
        }
        return prev + 1;
      });
    }, 1000);
  };

  // Budget calculations
  const calculateEscrowTotal = useMemo(() => {
    if (campaignType === "cause" || campaignType === "barter") return 0;
    const base = ratePerCreator * creatorsNeeded;
    return base;
  }, [campaignType, ratePerCreator, creatorsNeeded]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500/30 selection:text-indigo-200 overflow-x-hidden font-sans">
      {/* Dynamic Background Glows */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-violet-600/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Floating Sales Header */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 bg-gradient-to-tr from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="h-5 w-5 text-white animate-pulse" />
          </div>
          <div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-400 bg-clip-text text-transparent">
              VERZA
            </span>
            <span className="text-[10px] text-indigo-400 font-bold tracking-widest uppercase ml-2 px-1.5 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">
              Overview Deck
            </span>
          </div>
        </div>

        {/* View Switcher Toggle */}
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1.5 rounded-lg shadow-inner">
          <button
            onClick={() => setViewMode("deck")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              viewMode === "deck"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Presentation className="h-3.5 w-3.5" />
            Slide Presentation
          </button>
          <button
            onClick={() => setViewMode("scroll")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              viewMode === "scroll"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <AlignLeft className="h-3.5 w-3.5" />
            Continuous Scroll
          </button>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-xs font-bold text-slate-400 hover:text-slate-200 transition-colors hidden sm:inline"
          >
            Back to App
          </Link>
          <a
            href="https://tryverza.com/demo"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-slate-100 hover:bg-slate-200 text-slate-950 text-xs font-extrabold px-4 py-2 rounded-lg flex items-center gap-1.5 shadow transition-all hover:scale-102"
          >
            Book Demo <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {viewMode === "deck" ? (
          /* ========================================================
             SLIDE PRESENTATION MODE
             ======================================================== */
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Presentation Stage */}
            <div
              ref={deckRef}
              className="relative min-h-[640px] bg-slate-900/60 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-sm overflow-hidden flex flex-col justify-between"
            >
              {/* Top Progress bar */}
              <div className="w-full bg-slate-850 h-1 flex">
                {Array.from({ length: slideCount }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-full flex-1 transition-all duration-300 ${
                      idx <= activeSlide ? "bg-indigo-500" : "bg-slate-800"
                    }`}
                  />
                ))}
              </div>

              {/* Slide Content */}
              <div className="flex-1 flex flex-col justify-center p-8 md:p-12">
                {activeSlide === 0 && <SlideOSOverview />}
                {activeSlide === 1 && (
                  <SlideOpticAI
                    brief={scoutBrief}
                    setBrief={setScoutBrief}
                    isScouting={isScouting}
                    progress={scoutProgress}
                    logs={scoutLogs}
                    profiles={scoutedProfiles}
                    runScout={runScoutSimulation}
                    selectedEmail={selectedCreatorEmail}
                    setSelectedEmail={setSelectedCreatorEmail}
                  />
                )}
                {activeSlide === 2 && (
                  <SlideSmartCampaigns
                    type={campaignType}
                    setType={setCampaignType}
                    rate={ratePerCreator}
                    setRate={setRatePerCreator}
                    creators={creatorsNeeded}
                    setCreators={setCreatorsNeeded}
                    isAffiliate={isAffiliateEnabled}
                    setIsAffiliate={setIsAffiliateEnabled}
                    affiliateType={affiliateType}
                    setAffiliateType={setAffiliateType}
                    affiliateRate={affiliateRate}
                    setAffiliateRate={setAffiliateRate}
                    escrowTotal={calculateEscrowTotal}
                  />
                )}
                {activeSlide === 3 && (
                  <SlideVerzaScore
                    threshold={qualityThreshold}
                    setThreshold={setThresholdAndSync}
                    score={submissionScore}
                    setScore={setScoreAndSync}
                  />
                )}
                {activeSlide === 4 && (
                  <SlideAIContracts
                    isAuditing={isAuditingContract}
                    auditComplete={contractAuditComplete}
                    auditStep={contractAuditStep}
                    runAudit={runContractAudit}
                  />
                )}
                {activeSlide === 5 && (
                  <SlideWalletBudget
                    total={walletTotal}
                    setTotal={setWalletTotal}
                    escrow={walletEscrow}
                    setEscrow={setWalletEscrow}
                    available={availableBalance}
                    topUpVal={topUpAmount}
                    setTopUpVal={setTopUpAmount}
                    showTopUpSuccess={showTopUpSuccess}
                    setShowTopUpSuccess={setShowTopUpSuccess}
                    payAmount={payCreatorAmount}
                    setPayAmount={setPayCreatorAmount}
                    selectedPayee={selectedPayee}
                    setSelectedPayee={setSelectedPayee}
                    showPaySuccess={showPaySuccess}
                    setShowPaySuccess={setShowPaySuccess}
                  />
                )}
                {activeSlide === 6 && <SlideCTA />}
              </div>

              {/* Deck Navigation Footer */}
              <div className="bg-slate-900 border-t border-slate-800 px-8 py-4 flex items-center justify-between">
                <div className="text-xs text-slate-500 font-medium">
                  Use your keyboard <kbd className="bg-slate-800 px-1 rounded text-[10px]">←</kbd> / <kbd className="bg-slate-800 px-1 rounded text-[10px]">→</kbd> or spacebar to navigate
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-sm font-semibold text-slate-400">
                    <span className="text-slate-100">{activeSlide + 1}</span> / {slideCount}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={prevSlide}
                      className="h-10 w-10 rounded-lg border border-slate-700 flex items-center justify-center hover:bg-slate-800 transition-colors"
                      disabled={activeSlide === 0}
                    >
                      <ChevronLeft className={`h-5 w-5 ${activeSlide === 0 ? "text-slate-600" : "text-slate-200"}`} />
                    </button>
                    <button
                      onClick={nextSlide}
                      className="h-10 w-10 rounded-lg bg-indigo-600 flex items-center justify-center hover:bg-indigo-500 shadow-md shadow-indigo-600/20 transition-all"
                    >
                      <ChevronRight className="h-5 w-5 text-white" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Slide Index Thumbnails */}
            <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
              {[
                { label: "Verza OS Hero", icon: Sparkles },
                { label: "AI Outreach Scout", icon: Search },
                { label: "Smart Campaigns", icon: Target },
                { label: "Verza AI Gating", icon: ShieldCheck },
                { label: "AI Contract Audits", icon: Scale },
                { label: "Budget & Escrow Wallet", icon: Wallet },
                { label: "ROI Comparison", icon: Zap },
              ].map((slide, idx) => {
                const IconComp = slide.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => setActiveSlide(idx)}
                    className={`p-3 border rounded-xl flex flex-col items-center justify-center text-center gap-2 transition-all ${
                      activeSlide === idx
                        ? "bg-indigo-600/10 border-indigo-500 text-indigo-400"
                        : "bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300"
                    }`}
                  >
                    <IconComp className="h-5 w-5" />
                    <span className="text-[10px] font-bold uppercase tracking-wider block leading-tight">
                      {slide.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* ========================================================
             CONTINUOUS SCROLL MODE
             ======================================================== */
          <div className="space-y-16 py-8 animate-in fade-in duration-300">
            {/* OS Overview */}
            <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 md:p-12 relative shadow-lg">
              <div className="absolute top-3 right-4 text-[10px] uppercase tracking-widest text-indigo-400 font-extrabold bg-indigo-500/10 px-2 py-0.5 rounded">
                Section 1
              </div>
              <SlideOSOverview />
            </section>

            {/* Optic Scout */}
            <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 md:p-12 relative shadow-lg">
              <div className="absolute top-3 right-4 text-[10px] uppercase tracking-widest text-indigo-400 font-extrabold bg-indigo-500/10 px-2 py-0.5 rounded">
                Section 2
              </div>
              <SlideOpticAI
                brief={scoutBrief}
                setBrief={setScoutBrief}
                isScouting={isScouting}
                progress={scoutProgress}
                logs={scoutLogs}
                profiles={scoutedProfiles}
                runScout={runScoutSimulation}
                selectedEmail={selectedCreatorEmail}
                setSelectedEmail={setSelectedCreatorEmail}
              />
            </section>

            {/* Smart Campaigns */}
            <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 md:p-12 relative shadow-lg">
              <div className="absolute top-3 right-4 text-[10px] uppercase tracking-widest text-indigo-400 font-extrabold bg-indigo-500/10 px-2 py-0.5 rounded">
                Section 3
              </div>
              <SlideSmartCampaigns
                type={campaignType}
                setType={setCampaignType}
                rate={ratePerCreator}
                setRate={setRatePerCreator}
                creators={creatorsNeeded}
                setCreators={setCreatorsNeeded}
                isAffiliate={isAffiliateEnabled}
                setIsAffiliate={setIsAffiliateEnabled}
                affiliateType={affiliateType}
                setAffiliateType={setAffiliateType}
                affiliateRate={affiliateRate}
                setAffiliateRate={setAffiliateRate}
                escrowTotal={calculateEscrowTotal}
              />
            </section>

            {/* Verza Score */}
            <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 md:p-12 relative shadow-lg">
              <div className="absolute top-3 right-4 text-[10px] uppercase tracking-widest text-indigo-400 font-extrabold bg-indigo-500/10 px-2 py-0.5 rounded">
                Section 4
              </div>
              <SlideVerzaScore
                threshold={qualityThreshold}
                setThreshold={setThresholdAndSync}
                score={submissionScore}
                setScore={setScoreAndSync}
              />
            </section>

            {/* Contract Audits */}
            <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 md:p-12 relative shadow-lg">
              <div className="absolute top-3 right-4 text-[10px] uppercase tracking-widest text-indigo-400 font-extrabold bg-indigo-500/10 px-2 py-0.5 rounded">
                Section 5
              </div>
              <SlideAIContracts
                isAuditing={isAuditingContract}
                auditComplete={contractAuditComplete}
                auditStep={contractAuditStep}
                runAudit={runContractAudit}
              />
            </section>

            {/* Budget & Payout Wallet */}
            <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 md:p-12 relative shadow-lg">
              <div className="absolute top-3 right-4 text-[10px] uppercase tracking-widest text-indigo-400 font-extrabold bg-indigo-500/10 px-2 py-0.5 rounded">
                Section 6
              </div>
              <SlideWalletBudget
                total={walletTotal}
                setTotal={setWalletTotal}
                escrow={walletEscrow}
                setEscrow={setWalletEscrow}
                available={availableBalance}
                topUpVal={topUpAmount}
                setTopUpVal={setTopUpAmount}
                showTopUpSuccess={showTopUpSuccess}
                setShowTopUpSuccess={setShowTopUpSuccess}
                payAmount={payCreatorAmount}
                setPayAmount={setPayCreatorAmount}
                selectedPayee={selectedPayee}
                setSelectedPayee={setSelectedPayee}
                showPaySuccess={showPaySuccess}
                setShowPaySuccess={setShowPaySuccess}
              />
            </section>

            {/* Comparison CTA */}
            <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 md:p-12 relative shadow-lg">
              <div className="absolute top-3 right-4 text-[10px] uppercase tracking-widest text-indigo-400 font-extrabold bg-indigo-500/10 px-2 py-0.5 rounded">
                Section 7
              </div>
              <SlideCTA />
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/40 py-8 px-6 text-center text-xs text-slate-500">
        <p>© 2026 Verza Technologies, Inc. All rights reserved. Built as a secure system for modern marketing teams.</p>
        <p className="mt-1">All simulations represent running logic inside the Verza Operating System.</p>
      </footer>
    </div>
  );

  // Sync state helpers to ensure slides interact cleanly
  function setThresholdAndSync(val: number) {
    setQualityThreshold(val);
  }

  function setScoreAndSync(val: number) {
    setSubmissionScore(val);
  }
}

/* ============================================================================
   SLIDE 1: PLATFORM OVERVIEW (HERO)
   ============================================================================ */
function SlideOSOverview() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
      <div className="lg:col-span-7 space-y-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold uppercase tracking-wider">
          <Sparkles className="h-3 w-3 animate-spin" /> Unifying The Creator Economy
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-none text-white">
          The Operating System for{" "}
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-pink-400 bg-clip-text text-transparent">
            Creator Marketing
          </span>
        </h1>
        <p className="text-slate-400 text-base md:text-lg leading-relaxed">
          Legacy influencer campaigns are bottlenecked by fragmented tools: emails, contract signing PDFs,
          manual bank transfers, spreadsheet tracking, and subjective quality reviews. 
        </p>
        <p className="text-slate-400 text-base md:text-lg leading-relaxed">
          <strong>Verza</strong> consolidates the entire campaign lifecyle into a single, high-security command center
          built strictly for brand logistics.
        </p>

        {/* Highlight Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
          {[
            {
              title: "AI Scouting & Automated Outreach",
              desc: "Deploy AI Scouts to crawl socials, vet profiles, and send personalized sequences in seconds.",
            },
            {
              title: "Neural Submission Gating",
              desc: "Gated creator payouts. Only release funds when submitted media passes AI compliance checks.",
            },
            {
              title: "Escrow Budget Gating",
              desc: "Budget stays 100% protected in secure Campaign Escrow Vaults until you approve deliverables.",
            },
            {
              title: "Unified Financial Operations",
              desc: "Pay 50 creators with a single monthly Stripe invoice. Verza automates disbursements and 1099 compliance.",
            },
          ].map((item, idx) => (
            <div key={idx} className="flex gap-3 items-start p-3 rounded-lg bg-slate-900/40 border border-slate-800">
              <Check className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-slate-100">{item.title}</h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Visual Mock Dashboard */}
      <div className="lg:col-span-5 relative">
        <div className="absolute inset-0 bg-indigo-500/20 rounded-2xl filter blur-xl opacity-30 pointer-events-none" />
        <div className="relative bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Verza Brand Center</span>
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Active Budget", val: "$48,200", trend: "+12.4% this month" },
              { label: "Vetted Roster", val: "32 Creators", trend: "3 matched today" },
              { label: "Deliverables Approved", val: "148 Clips", trend: "0 disputes" },
              { label: "Avg. Engagement Score", val: "74.8%", trend: "Passed threshold" },
            ].map((stat, i) => (
              <div key={i} className="p-3 bg-slate-950 rounded-lg border border-slate-900/60">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                  {stat.label}
                </span>
                <span className="text-lg font-black text-slate-100 block mt-1">{stat.val}</span>
                <span className="text-[10px] text-emerald-400 font-semibold block mt-0.5">{stat.trend}</span>
              </div>
            ))}
          </div>

          {/* Active Brief preview */}
          <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-900/80 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">Active AI Scout Mission</span>
              <span className="text-[10px] text-slate-400 px-1.5 py-0.5 bg-slate-800 rounded font-mono">
                Job #4928
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full w-2/3 bg-indigo-500 rounded-full animate-pulse" />
            </div>
            <p className="text-[10px] text-slate-500 italic">
              "Finding creators matching beauty, organic, wellness niche..."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SLIDE 2: OPTIC AI SCOUT & OUTREACH
   ============================================================================ */
interface OpticProps {
  brief: "beauty" | "tech" | "fitness";
  setBrief: (val: "beauty" | "tech" | "fitness") => void;
  isScouting: boolean;
  progress: number;
  logs: string[];
  profiles: MockProfile[];
  runScout: () => void;
  selectedEmail: string | null;
  setSelectedEmail: (val: string | null) => void;
}

function SlideOpticAI({
  brief,
  setBrief,
  isScouting,
  progress,
  logs,
  profiles,
  runScout,
  selectedEmail,
  setSelectedEmail,
}: OpticProps) {
  // Pre-configured pitch suggestions based on brief
  const mailTemplates = {
    beauty: {
      to: "@sandra.green",
      subject: "Collaboration: Organic Skincare Launch 🌿",
      body: "Hi Sandra,\n\nI loved your recent video about organic skincare alternatives. Your emphasis on raw ingredients is exactly what we align with.\n\nWe're launching a new bio-serum campaign on Verza and would love to back your next video. We offer escrowed base compensation and a CPC performance reward.\n\nLet me know if you are interested!\n\nBest,\nBrand Marketing Lead",
    },
    tech: {
      to: "@glam_reviews",
      subject: "Collaboration Request: Hardware Analysis 🎧",
      body: "Hi Glam,\n\nWe reviewed your technology breakdowns and audience demographics. We have a high-end headphone campaign starting on Verza with full licensing parameters.\n\nYour review style matches our editorial standards. Let's collaborate.\n\nBest,\nCampaign Team",
    },
    fitness: {
      to: "@fit_beast",
      subject: "Collaboration: High-Performance Athleticwear ⚡",
      body: "Hi Fit Beast,\n\nYour fitness journey clips are incredible. We're seeding a new sweat-resistant athleticwear line via Verza.\n\nWe support creators with fixed budgets and conversion performance commissions. Let's discuss details.\n\nBest,\nCampaign Team",
    },
  };

  const currentTemplate = brief === "fitness" ? mailTemplates.fitness : brief === "tech" ? mailTemplates.tech : mailTemplates.beauty;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
      {/* Pitch & Inputs */}
      <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold uppercase tracking-wider mb-4">
            <Search className="h-3.5 w-3.5" /> Optic AI Scouting Engine
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white">
            Automated Creator Discovery & Outreach
          </h2>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed">
            Stop scrolling social media hashtags manually. Verza's <strong>Optic AI Scout</strong> acts as your
            automated recruiting agency. 
          </p>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            By inputting your campaign brief, the AI crawls creator channels, evaluates demographics, 
            verifies alignment, and automatically generates custom pitch emails or text outreach sequences.
          </p>
        </div>

        {/* Inputs Builder */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Choose Campaign Brief
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "beauty", label: "🌿 Skincare", desc: "Organic / Wellness" },
                { id: "tech", label: "🎧 Headset", desc: "Tech Reviews" },
                { id: "fitness", label: "💪 Apparel", desc: "Active Lifestyle" },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => !isScouting && setBrief(item.id as any)}
                  className={`p-2 border rounded-lg text-left transition-all ${
                    brief === item.id
                      ? "border-indigo-500 bg-indigo-500/5 text-white"
                      : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
                  }`}
                  disabled={isScouting}
                >
                  <p className="text-xs font-bold">{item.label}</p>
                  <p className="text-[9px] text-slate-500 mt-0.5">{item.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={runScout}
            disabled={isScouting}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-extrabold text-sm py-3 rounded-lg flex items-center justify-center gap-2 shadow-md shadow-indigo-600/10 transition-all hover:scale-102"
          >
            {isScouting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Scout Searching Platform...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-white" />
                Run AI Scout Mission
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live Scout Simulation Terminal */}
      <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Scouting Progress Column */}
        <div className="md:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="flex justify-between items-center border-b border-slate-850 pb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isScouting ? 'bg-indigo-400' : 'bg-slate-500'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isScouting ? 'bg-indigo-500' : 'bg-slate-500'}`}></span>
              </span>
              Scout Timeline
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {progress}%
            </span>
          </div>

          {/* Log Window */}
          <div className="flex-1 min-h-[220px] bg-slate-950 border border-slate-900 rounded-lg p-3 font-mono text-[10px] text-indigo-400 leading-normal overflow-y-auto space-y-1.5 scrollbar-thin">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">Select a brief and click 'Run AI Scout Mission' to watch the AI search, vet, and draft pitches live...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex gap-1.5 border-l-2 border-indigo-500/40 pl-2">
                  <span className="text-slate-600 shrink-0 select-none">&gt;</span>
                  <span className="text-slate-300">{log}</span>
                </div>
              ))
            )}
          </div>

          {/* Mini shortlists */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Shortlisted Creators</span>
            <div className="space-y-1.5">
              {profiles.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No search roster created.</p>
              ) : (
                profiles.map((p, idx) => (
                  <div
                    key={idx}
                    onClick={() => p.status === "matched" && setSelectedEmail(p.handle)}
                    className={`flex items-center justify-between p-2 rounded border text-xs transition-all cursor-pointer ${
                      p.status === "matched"
                        ? selectedEmail === p.handle
                          ? "bg-indigo-500/10 border-indigo-500 text-white"
                          : "bg-slate-950 border-slate-850 text-slate-300 hover:border-slate-700"
                        : p.status === "skipped"
                        ? "bg-slate-950/40 border-slate-900 text-slate-600"
                        : "bg-slate-950 border-slate-900 text-slate-400"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${p.avatarColor}`} />
                      <span className="font-bold">{p.handle}</span>
                      <span className="text-[9px] text-slate-500 capitalize">({p.platform})</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {p.status === "matched" && (
                        <>
                          <span className="text-[9px] px-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold rounded">
                            {p.matchScore}% Match
                          </span>
                          <Eye className="h-3 w-3 text-indigo-400" />
                        </>
                      )}
                      {p.status === "skipped" && (
                        <span className="text-[9px] px-1 bg-slate-800 text-slate-500 font-bold rounded">
                          Skipped
                        </span>
                      )}
                      {p.status === "scanning" && (
                        <RefreshCw className="h-3 w-3 text-indigo-400 animate-spin" />
                      )}
                      {p.status === "pending" && (
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Lead Vault Outreach Preview */}
        <div className="md:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex justify-between items-center border-b border-slate-850 pb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-indigo-400" /> AI Outreach Sequence
            </span>
            <span className="text-[10px] text-indigo-400 font-bold uppercase">
              Draft
            </span>
          </div>

          <div className="flex-1 mt-4 bg-slate-950 border border-slate-900 rounded-lg p-4 text-xs space-y-4">
            {selectedEmail || profiles.find((p) => p.status === "matched") ? (
              <div className="space-y-3">
                <div className="flex border-b border-slate-900 pb-2">
                  <span className="text-slate-500 font-bold w-12 shrink-0">To:</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedEmail || profiles.find((p) => p.status === "matched")?.handle}
                  </span>
                </div>
                <div className="flex border-b border-slate-900 pb-2">
                  <span className="text-slate-500 font-bold w-12 shrink-0">Subj:</span>
                  <span className="text-slate-300 font-bold">{currentTemplate.subject}</span>
                </div>
                <div className="text-slate-400 font-sans leading-relaxed whitespace-pre-wrap pt-2 overflow-y-auto max-h-56">
                  {currentTemplate.body}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-slate-600 space-y-2">
                <Mail className="h-8 w-8 text-slate-800" />
                <p className="italic">Click on a matched creator from the shortlist to preview the generated AI outreach sequence.</p>
              </div>
            )}
          </div>

          <button
            disabled={!selectedEmail && !profiles.find((p) => p.status === "matched")}
            className="w-full mt-4 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-800 text-slate-950 font-extrabold text-xs py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow"
          >
            <Send className="h-3 w-3" /> Approve & Send Sequence
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SLIDE 3: SMART CAMPAIGNS & CALCULATOR
   ============================================================================ */
interface CampaignProps {
  type: "sponsorship" | "grant" | "cause" | "barter";
  setType: (val: "sponsorship" | "grant" | "cause" | "barter") => void;
  rate: number;
  setRate: (val: number) => void;
  creators: number;
  setCreators: (val: number) => void;
  isAffiliate: boolean;
  setIsAffiliate: (val: boolean) => void;
  affiliateType: "cpc" | "cpa";
  setAffiliateType: (val: "cpc" | "cpa") => void;
  affiliateRate: number;
  setAffiliateRate: (val: number) => void;
  escrowTotal: number;
}

function SlideSmartCampaigns({
  type,
  setType,
  rate,
  setRate,
  creators,
  setCreators,
  isAffiliate,
  setIsAffiliate,
  affiliateType,
  setAffiliateType,
  affiliateRate,
  setAffiliateRate,
  escrowTotal,
}: CampaignProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
      {/* Campaign Details & Swaps */}
      <div className="lg:col-span-6 space-y-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold uppercase tracking-wider">
          <Target className="h-3.5 w-3.5" /> Escrow & Smart Campaigns
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Flexible Compensation. Gated Escrow Protection.
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Verza enables brands to contract creators on their own terms. Launch standard sponsorships, grant backings,
          cause campaigns, or non-cash barter deals.
        </p>
        <p className="text-slate-400 text-sm leading-relaxed">
          When you fund a cash campaign, Verza automatically locks the total compensation budget in a secure 
          <strong> Campaign Vault (Escrow)</strong>. Payouts are only disbursed once deliverables are approved by you,
          ensuring zero financial risk.
        </p>

        {/* Dynamic Selector Cards */}
        <div className="space-y-3">
          {[
            {
              id: "sponsorship",
              title: "Standard Sponsorship",
              desc: "Ad-reads, review criteria, custom usage rights (1 year/perpetuity), and whitelisting permissions.",
              badge: "Premium Escrow",
            },
            {
              id: "grant",
              title: "Production Grant / Editorial backing",
              desc: "Funding independent content in exchange for editorial logo credits. No ad-reads. Creator retains full rights.",
              badge: "Fixed Budget",
            },
            {
              id: "cause",
              title: "Cause / Awareness Campaign",
              desc: "Social impact amplification. Unlimited slots, voluntary creator participation, optional performance rewards.",
              badge: "Performance Only",
            },
            {
              id: "barter",
              title: "Barter / In-Kind Collaboration",
              desc: "Non-cash exchange (product samples, hotel stays). Enforces brief quality requirements, tracks content analytics, and manages roster logistics with zero cash payment.",
              badge: "No Cash Payout",
            },
          ].map((item) => (
            <div
              key={item.id}
              onClick={() => setType(item.id as any)}
              className={`p-4 border rounded-xl cursor-pointer transition-all flex justify-between items-start gap-4 ${
                type === item.id
                  ? "border-indigo-500 bg-indigo-500/5 shadow-md shadow-indigo-500/5"
                  : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
              }`}
            >
              <div className="flex gap-3 items-start">
                <input
                  type="radio"
                  checked={type === item.id}
                  onChange={() => {}}
                  className="mt-1 accent-indigo-500 shrink-0"
                />
                <div>
                  <h4 className="text-sm font-bold text-slate-100">{item.title}</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
                </div>
              </div>
              <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-850 text-slate-400 rounded shrink-0 uppercase border border-slate-800">
                {item.badge}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Escrow Calculator Panel */}
      <div className="lg:col-span-6 relative">
        <div className="absolute inset-0 bg-indigo-500/10 rounded-2xl filter blur-xl opacity-20 pointer-events-none" />
        <div className="relative bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Campaign Escrow Calculator</span>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Lock className="h-3.5 w-3.5 text-indigo-400" /> Escrow Secure
            </div>
          </div>

          {/* Custom values inputs */}
          <div className="grid grid-cols-2 gap-4">
            {type !== "cause" && type !== "barter" ? (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Base Rate Per Creator
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">
                    $
                  </span>
                  <input
                    type="number"
                    value={rate}
                    onChange={(e) => setRate(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-7 pr-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex flex-col justify-center">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                  Base Rate
                </label>
                <span className="text-xs text-slate-400 font-bold block mt-1">
                  {type === "cause" ? "Voluntary ($0.00)" : "Barter / In-Kind ($0.00)"}
                </span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Creators Needed
              </label>
              {type !== "cause" ? (
                <input
                  type="number"
                  value={creators}
                  onChange={(e) => setCreators(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              ) : (
                <div className="bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-sm text-slate-500 font-bold flex items-center gap-1.5 h-[38px]">
                  <InfinityIcon className="h-3.5 w-3.5 text-rose-500" /> Unlimited
                </div>
              )}
            </div>
          </div>

          {/* Performance reward toggling */}
          {type !== "barter" ? (
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-900 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex gap-2 items-center">
                  <label className="text-xs font-bold text-slate-300">Enable Performance Rewards</label>
                  <span className="text-[9px] px-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold rounded uppercase">
                    Affiliate
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={isAffiliate}
                  onChange={(e) => setIsAffiliate(e.target.checked)}
                  className="accent-indigo-500 h-4 w-4"
                />
              </div>

              {isAffiliate && (
                <div className="space-y-4 pt-2 border-t border-slate-900 grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2 sm:col-span-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Payout Logic
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setAffiliateType("cpc")}
                        className={`text-xs py-1.5 rounded font-bold border transition-all ${
                          affiliateType === "cpc"
                            ? "border-blue-500 bg-blue-500/5 text-white"
                            : "border-slate-800 bg-slate-950 text-slate-500"
                        }`}
                      >
                        Per Click
                      </button>
                      <button
                        onClick={() => setAffiliateType("cpa")}
                        className={`text-xs py-1.5 rounded font-bold border transition-all ${
                          affiliateType === "cpa"
                            ? "border-blue-500 bg-blue-500/5 text-white"
                            : "border-slate-800 bg-slate-950 text-slate-500"
                        }`}
                      >
                        Per Conversion
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 col-span-2 sm:col-span-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Amount per action
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">
                        $
                      </span>
                      <input
                        type="number"
                        value={affiliateRate}
                        onChange={(e) => setAffiliateRate(Math.max(0.01, parseFloat(e.target.value) || 0))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-7 pr-3 text-sm text-slate-200 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-900 text-center text-xs text-slate-500">
              <Sparkles className="h-4 w-4 text-indigo-400 mx-auto mb-1 animate-pulse" />
              Barter campaigns operate entirely on non-cash terms. Quality gates, analytical tracking, and contract terms still apply.
            </div>
          )}

          {/* Consolidated Escrow Total */}
          <div className="bg-gradient-to-r from-indigo-950/60 to-slate-900 border border-indigo-500/20 p-5 rounded-xl text-center space-y-2">
            <span className="text-xs text-indigo-400 font-bold uppercase tracking-wider block">
              Required Escrow Funding (Stripe held)
            </span>
            <span className="text-4xl font-black text-white block">
              ${escrowTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
            <p className="text-[10px] text-slate-400 leading-normal max-w-xs mx-auto pt-1">
              {type === "cause" ? (
                "Pure performance campaign. Budget is accrued dynamically per verified action. $0.00 locked upfront."
              ) : type === "barter" ? (
                "Barter collaboration. No upfront escrow funding or transaction fees. Creators are compensated via product/service exchange."
              ) : (
                `Guarantees compensation for up to ${creators} creators. Held in the Campaign Vault and disbursed on your approval.`
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SLIDE 4: VERZA AI QUALITY SCORE GATE
   ============================================================================ */
interface QualityProps {
  threshold: number;
  setThreshold: (val: number) => void;
  score: number;
  setScore: (val: number) => void;
}

function SlideVerzaScore({ threshold, setThreshold, score, setScore }: QualityProps) {
  // Logic to determine compliance states
  const passed = score >= threshold;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
      {/* Narrative block */}
      <div className="lg:col-span-5 space-y-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-500/10 border border-orange-500/20 text-orange-400 rounded-full text-xs font-bold uppercase tracking-wider">
          <ShieldCheck className="h-3.5 w-3.5" /> Neural Quality Gate
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Automate Quality Assurance with the Verza Score
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Worrying about creators submitting lazy content or violating brief guidelines is a massive overhead. 
        </p>
        <p className="text-slate-400 text-sm leading-relaxed">
          Verza acts as your AI quality auditor. The <strong>Verza Score</strong> parses video uploads, 
          calculates predicted viewer engagement, matches spoken transcripts against brief talking points, 
          and flags safety hazards. 
        </p>
        <p className="text-slate-400 text-sm leading-relaxed">
          By setting a <strong>Quality Gate Threshold</strong>, payouts are programmatically blocked if the submission
          fails to hit the benchmark.
        </p>
      </div>

      {/* Interactive Gating Simulator */}
      <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Threshold Adjustment Card */}
        <div className="md:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-6 flex flex-col justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block border-b border-slate-850 pb-2">
            Quality Gate Settings
          </span>

          {/* Gating threshold slider */}
          <div className="space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 font-semibold">Min. Payout Threshold</span>
              <span className="font-bold text-orange-400 font-mono text-sm">{threshold}%</span>
            </div>
            <input
              type="range"
              min="20"
              max="95"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value))}
              className="w-full accent-orange-500 cursor-ew-resize bg-slate-950 rounded-lg appearance-none h-1.5"
            />
            <p className="text-[10px] text-slate-500 leading-normal">
              Submissions scoring below this threshold are flagged and blocked from escrow payout releases automatically.
            </p>
          </div>

          {/* Submission simulated score */}
          <div className="space-y-3 pt-4 border-t border-slate-850">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 font-semibold">Simulated Video Score</span>
              <span className="font-bold text-indigo-400 font-mono text-sm">{score}%</span>
            </div>
            <input
              type="range"
              min="20"
              max="98"
              value={score}
              onChange={(e) => setScore(parseInt(e.target.value))}
              className="w-full accent-indigo-500 cursor-ew-resize bg-slate-950 rounded-lg appearance-none h-1.5"
            />
            <p className="text-[10px] text-slate-500 leading-normal">
              Slide to simulate a creator submitting content with different scores to test the gate.
            </p>
          </div>
        </div>

        {/* Visual Submission Feedback block */}
        <div className="md:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between border-b border-slate-850 pb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Submission Verification Room
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Submission ID: #SUB-8941
            </span>
          </div>

          {/* Submission Preview Card */}
          <div className="bg-slate-950 border border-slate-900 rounded-lg p-4 space-y-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h4 className="text-xs font-bold text-slate-200">@clara_creates · Skincare Brief</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">Submitted File: morning_routine_final.mp4</p>
              </div>

              {/* Status Badge */}
              <div className="shrink-0">
                {passed ? (
                  <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 font-bold uppercase rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Check className="h-3 w-3" /> Gate Passed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 font-bold uppercase rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    <AlertTriangle className="h-3 w-3 animate-bounce" /> Blocked
                  </span>
                )}
              </div>
            </div>

            {/* Visual indicators */}
            <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
              <div className="p-2 bg-slate-900/60 rounded border border-slate-900">
                <span className="text-slate-500 block uppercase tracking-wider">AI Score</span>
                <span className={`text-sm font-black block mt-0.5 ${passed ? 'text-emerald-400' : 'text-orange-400'}`}>
                  {score}%
                </span>
              </div>
              <div className="p-2 bg-slate-900/60 rounded border border-slate-900">
                <span className="text-slate-500 block uppercase tracking-wider">Gate Req</span>
                <span className="text-sm font-black text-slate-300 block mt-0.5">
                  &gt;{threshold}%
                </span>
              </div>
              <div className="p-2 bg-slate-900/60 rounded border border-slate-900">
                <span className="text-slate-500 block uppercase tracking-wider">Payout Escrow</span>
                <span className={`text-sm font-black block mt-0.5 ${passed ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {passed ? "$1,200" : "Held"}
                </span>
              </div>
            </div>

            {/* AI feedback text */}
            <div className="p-3 bg-slate-900/30 rounded border border-slate-900/80 text-[10px] leading-relaxed">
              <span className="font-bold text-slate-300 block mb-1">AI Auditor Analysis:</span>
              {passed ? (
                <span className="text-slate-400">
                  ✔ Product label is visible for 7.2s (Exceeds 5.0s rule). <br />
                  ✔ Keywords 'hydrating serum', 'organic skincare' matched. <br />
                  ✔ Vibe audit complete: Engagement predicted at high index. Approved for disbursement.
                </span>
              ) : (
                <span className="text-orange-400/90 font-medium">
                  ✘ Payout locked. Video score ({score}%) fails to meet the quality gate threshold ({threshold}%). <br />
                  ✘ Warning: Product label obscured during intro shot (0:04 - 0:08). <br />
                  ✘ Transcript missing primary keyword 'bio-serum'. Revision request sent to creator.
                </span>
              )}
            </div>
          </div>

          {/* Action indicator */}
          <div className="text-center text-[10px] text-slate-500 italic">
            {passed ? (
              <span className="text-emerald-400/85">✔ Ready for payout. Approved submission releases funds from escrow.</span>
            ) : (
              <span>Escrow safety holds funds in vault. Creator has 72 hours to re-submit revision.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SLIDE 5: AI CONTRACT AUDITS
   ============================================================================ */
interface ContractProps {
  isAuditing: boolean;
  auditComplete: boolean;
  auditStep: number;
  runAudit: () => void;
}

function SlideAIContracts({ isAuditing, auditComplete, auditStep, runAudit }: ContractProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
      {/* Left Pitch */}
      <div className="lg:col-span-5 space-y-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold uppercase tracking-wider">
          <Scale className="h-3.5 w-3.5" /> AI Contract Audits
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Eliminate Legal Bottlenecks instantly
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Negotiating creator contracts back-and-forth takes days of legal oversight. 
        </p>
        <p className="text-slate-400 text-sm leading-relaxed">
          Verza simplifies legal logistics. Upload any sponsor contract PDF/Doc, or generate one in our editor.
          The AI immediately <strong>parses key terms</strong>, extracts payment milestones, highlights indemnification clauses,
          and flags <strong>perpetuity risks</strong> or whitelisting traps.
        </p>
        <p className="text-slate-400 text-sm leading-relaxed">
          Ensure compliance and launch campaigns with binding clickwrap execution without hiring expensive legal teams.
        </p>

        <button
          onClick={runAudit}
          disabled={isAuditing}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-5 py-3 rounded-lg flex items-center justify-center gap-2 shadow-md shadow-indigo-600/10 transition-all"
        >
          <RefreshCw className={`h-4 w-4 ${isAuditing ? 'animate-spin' : ''}`} />
          {isAuditing ? "Auditing Contract Clauses..." : "Upload & Analyze Contract"}
        </button>
      </div>

      {/* Contract Simulation Display */}
      <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Mock Document Screen */}
        <div className="md:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between min-h-[360px]">
          <div className="flex items-center justify-between border-b border-slate-850 pb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-indigo-400" /> contract_brief_sandra.docx
            </span>
            <span className="text-[10px] text-slate-500">
              Page 1 of 3
            </span>
          </div>

          {/* Legal document mock lines */}
          <div className="flex-1 mt-4 bg-slate-950 border border-slate-900 rounded-lg p-4 font-mono text-[9px] text-slate-500 space-y-3 leading-relaxed overflow-y-auto max-h-60 select-none">
            <p className="font-bold text-slate-300 uppercase tracking-widest text-center border-b border-slate-900 pb-2 text-[10px]">
              INFLUENCER COLLABORATION AGREEMENT
            </p>
            <p>
              This Influencer Collaboration Agreement (the "Agreement") is entered into as of May 22, 2026, by and between
              <span className={`px-1.5 rounded transition-all ${auditStep >= 1 ? 'bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30' : 'bg-slate-900'}`}>
                Verza Beauty Corp (Client)
              </span>
              and sandra.green (Creator).
            </p>
            <p className="font-bold text-slate-400">Section 3: DELIVERABLES & FEES</p>
            <p>
              Creator agrees to submit (1) raw footage clip for client review. Upon raw clip delivery, Client shall disburse
              <span className={`px-1.5 rounded transition-all ${auditStep >= 2 ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30' : 'bg-slate-900'}`}>
                Milestone 1: $1,500 USD
              </span>
              from escrow. Upon final video publication, Client shall release
              <span className={`px-1.5 rounded transition-all ${auditStep >= 2 ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30' : 'bg-slate-900'}`}>
                Milestone 2: $1,500 USD
              </span>
              escrowed remainder.
            </p>
            <p className="font-bold text-slate-400">Section 8: IP RIGHTS & USAGE</p>
            <p>
              Creator grants Client an exclusive license to distribute, edit, and amplify the final video deliverables.
              <span className={`px-1.5 rounded transition-all ${auditStep >= 3 ? 'bg-orange-500/20 text-orange-300 font-bold border border-orange-500/30' : 'bg-slate-900'}`}>
                Usage rights shall extend in perpetuity across all digital social platforms.
              </span>
              Client is allowed to run paid ads from Creator's profile for a duration of 30 days.
            </p>
          </div>
        </div>

        {/* Audit Report Sidebar */}
        <div className="md:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div className="border-b border-slate-850 pb-2 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> AI Audited Intel
            </span>
            {isAuditing && (
              <RefreshCw className="h-3.5 w-3.5 text-indigo-400 animate-spin" />
            )}
          </div>

          {/* Audit results points */}
          <div className="flex-1 mt-4 space-y-3.5">
            {auditStep === 0 && !auditComplete && (
              <div className="flex flex-col items-center justify-center h-full text-center text-slate-600 p-4 space-y-2">
                <Scale className="h-10 w-10 text-slate-800" />
                <p className="text-xs leading-normal">Click 'Upload & Analyze Contract' to verify legal clauses instantly.</p>
              </div>
            )}

            {/* Step 1: Parties */}
            {auditStep >= 1 && (
              <div className="p-2.5 bg-slate-950 border border-slate-900 rounded-lg text-[10px] space-y-1 animate-in slide-in-from-top-2 duration-300">
                <span className="text-slate-500 font-bold uppercase tracking-wider block">Contracting Parties</span>
                <p className="text-slate-300 font-bold">Verza Beauty Corp ↔ @sandra.green</p>
              </div>
            )}

            {/* Step 2: Milestones */}
            {auditStep >= 2 && (
              <div className="p-2.5 bg-slate-950 border border-slate-900 rounded-lg text-[10px] space-y-1 animate-in slide-in-from-top-2 duration-300">
                <span className="text-slate-500 font-bold uppercase tracking-wider block">Extracted Milestones</span>
                <p className="text-slate-300 font-bold">Total Budget: $3,000 USD</p>
                <ul className="text-slate-400 space-y-0.5 pl-2 list-disc">
                  <li>Milestone 1: $1,500 (Raw submission)</li>
                  <li>Milestone 2: $1,500 (Final approval)</li>
                </ul>
              </div>
            )}

            {/* Step 3: Usage Warnings */}
            {auditStep >= 3 && (
              <div className="p-2.5 bg-slate-950 border border-slate-900 rounded-lg text-[10px] space-y-1.5 animate-in slide-in-from-top-2 duration-300">
                <span className="text-orange-400 font-bold uppercase tracking-wider block flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500" /> Risk Alert
                </span>
                <p className="text-slate-400 leading-normal">
                  <strong>Clause 8.1 grants Perpetuity Rights.</strong> Brief requested 1 Year usage.
                  Recommend updating template to limit license duration.
                </p>
              </div>
            )}

            {/* Step 4: AI Recommendations */}
            {auditStep >= 4 && (
              <div className="p-2.5 bg-slate-950 border border-indigo-500/20 rounded-lg text-[10px] space-y-1 animate-in slide-in-from-top-2 duration-300">
                <span className="text-indigo-400 font-bold uppercase tracking-wider block">Audit Action Summary</span>
                <p className="text-slate-400 leading-normal">
                  ✔ 30-day Whitelisting matches brief. <br />
                  ✔ Milestone payment gates align with Escrow rules. <br />
                  ⚠ Perpetuity clause needs revision.
                </p>
              </div>
            )}
          </div>

          {/* Auto sign indicators */}
          {auditComplete && (
            <div className="mt-4 pt-3 border-t border-slate-850 flex gap-2">
              <button className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[10px] py-2 rounded-lg transition-colors">
                Apply AI Revisions
              </button>
              <button className="flex-1 border border-slate-700 hover:bg-slate-800 text-slate-200 font-extrabold text-[10px] py-2 rounded-lg transition-colors">
                Sign Clickwrap
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SLIDE 6: CONSOLIDATED WALLET & FINANCIAL OPS
   ============================================================================ */
interface WalletProps {
  total: number;
  setTotal: (val: number) => void;
  escrow: number;
  setEscrow: (val: number) => void;
  available: number;
  topUpVal: string;
  setTopUpVal: (val: string) => void;
  showTopUpSuccess: boolean;
  setShowTopUpSuccess: (val: boolean) => void;
  payAmount: string;
  setPayAmount: (val: string) => void;
  selectedPayee: string;
  setSelectedPayee: (val: string) => void;
  showPaySuccess: boolean;
  setShowPaySuccess: (val: boolean) => void;
}

function SlideWalletBudget({
  total,
  setTotal,
  escrow,
  setEscrow,
  available,
  topUpVal,
  setTopUpVal,
  showTopUpSuccess,
  setShowTopUpSuccess,
  payAmount,
  setPayAmount,
  selectedPayee,
  setSelectedPayee,
  showPaySuccess,
  setShowPaySuccess,
}: WalletProps) {
  // Top-up handler
  const handleTopUp = () => {
    const amt = parseInt(topUpVal) || 0;
    if (amt <= 0) return;
    setTotal(total + amt);
    setShowTopUpSuccess(true);
    setTimeout(() => {
      setShowTopUpSuccess(false);
      setTopUpVal("");
    }, 2500);
  };

  // Direct Pay Creator handler
  const handlePayCreator = () => {
    const amt = parseInt(payAmount) || 0;
    if (amt <= 0 || amt > available) return;
    setTotal(total - amt);
    setShowPaySuccess(true);
    setTimeout(() => {
      setShowPaySuccess(false);
      setPayAmount("");
    }, 2500);
  };

  // Payout breakdown ratios
  const availableRatio = total > 0 ? (available / total) * 100 : 0;
  const escrowRatio = total > 0 ? (escrow / total) * 100 : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
      {/* Wallet Pitch */}
      <div className="lg:col-span-5 space-y-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold uppercase tracking-wider">
          <Wallet className="h-3.5 w-3.5" /> Campaign Wallet Control
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Consolidated Wallet & Payout Administration
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Managing accounts payable for dozens of creators is an operational nightmare. Finance teams hate
          routing individual bank payouts, auditing receipts, and filing 1099 tax forms.
        </p>
        <p className="text-slate-400 text-sm leading-relaxed">
          Verza integrates <strong>Campaign Wallets</strong> for brands. Pre-fund your wallet via ACH or Card and disburse
          guaranteed escrow balances, revision bonuses, or performance commissions from one dashboard.
        </p>
        <p className="text-slate-400 text-sm leading-relaxed">
          Verza acts as the Merchant of Record. Pay <strong>one consolidated invoice</strong> to Verza; our platform automatically
          disburses payments to individual creators and handles tax reporting behind the scenes.
        </p>
      </div>

      {/* Interactive Wallet Dashboard Simulator */}
      <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Unified Wallet card */}
        <div className="md:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col justify-between space-y-6">
          <div className="flex justify-between items-center border-b border-slate-850 pb-2.5">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Building className="h-4 w-4 text-indigo-400" /> Verza Brand Wallet
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Liquidity Console
            </span>
          </div>

          {/* Balances block */}
          <div className="space-y-4">
            <div>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">
                Total Wallet Liquidity
              </span>
              <span className="text-3xl font-black text-white block mt-1">
                ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>

            {/* Split Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Available: ${available.toLocaleString()}
                </span>
                <span className="flex items-center gap-1 text-indigo-400">
                  <span className="h-2 w-2 rounded-full bg-indigo-500" />
                  Escrowed: ${escrow.toLocaleString()}
                </span>
              </div>
              <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
                <div
                  className="bg-emerald-500 h-full transition-all duration-500"
                  style={{ width: `${availableRatio}%` }}
                />
                <div
                  className="bg-indigo-500 h-full transition-all duration-500"
                  style={{ width: `${escrowRatio}%` }}
                />
              </div>
            </div>
          </div>

          {/* Quick Insights */}
          <div className="p-3 bg-slate-950 border border-slate-900 rounded-lg space-y-2">
            <div className="flex justify-between items-center text-[9px] text-slate-500 font-bold uppercase tracking-wider">
              <span>Financial Status</span>
              <span className="text-emerald-400">Escrow Secure</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Available funds can be loaded instantly into new campaigns or paid out directly as creator rewards.
              Escrowed funds are locked for active campaigns.
            </p>
          </div>
        </div>

        {/* Financial Actions Panels */}
        <div className="md:col-span-5 flex flex-col gap-4">
          {/* Top-up Panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col justify-between space-y-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
              <Plus className="h-4 w-4 text-indigo-400" /> Top Up Wallet
            </span>

            {showTopUpSuccess ? (
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold text-center animate-in zoom-in-95 duration-200">
                Top-up Successful! Balance added.
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-[10px]">
                    $
                  </span>
                  <input
                    type="number"
                    placeholder="5000"
                    value={topUpVal}
                    onChange={(e) => setTopUpVal(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 pl-5 py-1 text-xs text-slate-200 focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleTopUp}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[10px] px-3 py-1 rounded transition-colors"
                >
                  Load
                </button>
              </div>
            )}

            <span className="text-[9px] text-slate-500 leading-normal">
              ACH top-ups are cleared instantly. Credit cards accrue standard Stripe fees.
            </span>
          </div>

          {/* Pay Creator Panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col justify-between space-y-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
              <Send className="h-3.5 w-3.5 text-indigo-400" /> Pay Creator
            </span>

            {showPaySuccess ? (
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold text-center animate-in zoom-in-95 duration-200">
                Payment sent directly to creator's wallet.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={selectedPayee}
                    onChange={(e) => setSelectedPayee(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[10px] text-slate-300 focus:outline-none"
                  >
                    <option value="@sandra.green">@sandra.green</option>
                    <option value="@fit_beast">@fit_beast</option>
                    <option value="@organic_yogi">@organic_yogi</option>
                  </select>

                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-[9px]">
                      $
                    </span>
                    <input
                      type="number"
                      placeholder="1200"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 pl-4 py-1 text-[10px] text-slate-200 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  onClick={handlePayCreator}
                  disabled={available < (parseInt(payAmount) || 0)}
                  className="w-full bg-slate-100 hover:bg-slate-200 disabled:bg-slate-800 text-slate-950 font-extrabold text-[10px] py-1.5 rounded transition-colors"
                >
                  Disburse Payment
                </button>
              </div>
            )}

            <span className="text-[9px] text-slate-500 leading-normal">
              Direct wallet transfers are real-time, zero-fee payout releases.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SLIDE 7: COMPARISON & CALL TO ACTION (CTA)
   ============================================================================ */
function SlideCTA() {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="text-center max-w-2xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full text-xs font-bold uppercase tracking-wider">
          <Zap className="h-3.5 w-3.5" /> Return on Investment
        </div>
        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
          Why Brands Scale Faster on Verza OS
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Compare the manual operational overhead of influencer marketing against the automated efficiency
          of a centralized operating system.
        </p>
      </div>

      {/* Comparison Matrix Table */}
      <div className="bg-slate-900 border border-slate-850 rounded-2xl overflow-hidden shadow-2xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-950 border-b border-slate-850 text-xs font-bold uppercase tracking-wider text-slate-400">
              <th className="p-4 md:p-5">Campaign Lifecycle Stage</th>
              <th className="p-4 md:p-5 text-rose-400">Legacy Agency / Manual Model</th>
              <th className="p-4 md:p-5 text-indigo-400 bg-indigo-500/5">Verza Operating System</th>
            </tr>
          </thead>
          <tbody className="text-xs md:text-sm text-slate-300 divide-y divide-slate-850">
            {[
              {
                stage: "Creator Scouting",
                legacy: "Scrolling Instagram hashtags, cataloging leads in spreadsheets, manually tracking followers.",
                verza: "Optic AI Scout crawling platforms, scoring matches against brand guidelines, auto-compiling lists.",
              },
              {
                stage: "Outreach & Nurturing",
                legacy: "Sending hundreds of separate emails, manual follow-ups, copying/pasting templates.",
                verza: "Automated personalized sequences drafted by AI and dispatched in batches via Gmail/SMS.",
              },
              {
                stage: "Legal Contracts",
                legacy: "Emailing contract PDF attachments, collecting signatures via Docusign, manual revisions.",
                verza: "AI auditing contracts for indemnity/perpetuity risks, automated clickwrap agreements generated from briefs.",
              },
              {
                stage: "Quality Assurance",
                legacy: "Watching drafts subjectively, emailing revision feedback manually, risking compliance issues.",
                verza: "Verza Score AI running automated engagement & checklist verification. Gated escrow payouts.",
              },
              {
                stage: "Financial Disbursements",
                legacy: "Routing 30 bank payouts, collecting individual invoices, collecting W9 files, reporting 1099 taxes.",
                verza: "One monthly invoice paid to Verza. Automatic creator payouts via Stripe. Automated tax tracking.",
              },
            ].map((row, i) => (
              <tr key={i} className="hover:bg-slate-850/30 transition-colors">
                <td className="p-4 font-bold text-slate-100">{row.stage}</td>
                <td className="p-4 text-slate-400 leading-relaxed">{row.legacy}</td>
                <td className="p-4 text-indigo-200/90 leading-relaxed bg-indigo-500/5">
                  <div className="flex gap-2 items-start">
                    <Check className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span>{row.verza}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dynamic CTA box */}
      <div className="bg-gradient-to-r from-indigo-650 via-indigo-600 to-violet-700 rounded-2xl p-8 text-center space-y-6 shadow-2xl relative overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-12 -left-12 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />

        <h3 className="text-2xl md:text-3xl font-black text-white leading-tight">
          Ready to scale your creator strategy with zero operational friction?
        </h3>
        <p className="text-indigo-100 text-sm max-w-xl mx-auto leading-relaxed">
          Create a free account or book a live 15-minute onboarding call with our technical team to see
          how Verza can automate your creator workflows.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center pt-2">
          <a
            href="https://app.tryverza.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto bg-white hover:bg-slate-100 text-indigo-950 font-black text-sm px-8 py-3.5 rounded-lg flex items-center justify-center gap-1.5 shadow-lg transition-transform hover:-translate-y-0.5"
          >
            Create Your Account <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href="https://tryverza.com/demo"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto border-2 border-white/30 hover:border-white/50 bg-white/5 hover:bg-white/10 text-white font-black text-sm px-8 py-3 rounded-lg flex items-center justify-center gap-1.5 shadow transition-all hover:-translate-y-0.5"
          >
            Schedule a Demo Call
          </a>
        </div>
      </div>
    </div>
  );
}

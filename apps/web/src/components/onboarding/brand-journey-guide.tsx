"use client";

import { useState } from 'react';
import {
  ShieldCheck,
  Target,
  Rocket,
  ArrowRight,
  Quote,
  LayoutDashboard,
  BrainCircuit,
  Users,
  Zap,
  Wallet,
  CheckCircle2,
  Building,
  Store
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";

interface BrandJourneyGuideProps {
  onClose?: () => void;
}

export function BrandJourneyGuide({ onClose }: BrandJourneyGuideProps) {
  const { user, refreshAuthUser } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isCompleting, setIsCompleting] = useState(false);

  const handleComplete = async (destination: string) => {
    if (!user) return;
    setIsCompleting(true);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        hasCompletedBrandJourney: true
      });
      await refreshAuthUser();

      if (onClose) onClose();
      router.push(destination);
    } catch (error) {
      console.error("Error completing brand journey:", error);
      setIsCompleting(false);
    }
  };

  const isBrand = !!user?.isBrandAccount;
  const entityName = isBrand ? "Brand" : "Agency";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl animate-in fade-in duration-500">
      <div className="w-full max-w-2xl bg-card border border-border shadow-2xl rounded-[2.5rem] overflow-hidden relative">
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 flex">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                "flex-1 transition-all duration-500",
                step >= s ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </div>

        <div className="p-8 md:p-12">
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="space-y-4 text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest">
                  <LayoutDashboard className="h-3 w-3" /> The Command Center
                </div>
                <h2 className="text-4xl md:text-5xl font-black tracking-tighter leading-none">
                  Your Creator <br /> <span className="text-primary">Operating System.</span>
                </h2>
                <p className="text-muted-foreground text-lg max-w-md mx-auto">
                  Welcome to Verza. This is your command center for managing talent, scaling campaigns, and automating financial compliance.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-6 rounded-3xl bg-muted/50 border border-muted flex flex-col gap-3">
                  <Users className="h-6 w-6 text-indigo-600" />
                  <h4 className="font-bold">Centralized Talent</h4>
                  <p className="text-sm text-muted-foreground">Manage your entire roster and inbound applications in one secure place.</p>
                </div>
                <div className="p-6 rounded-3xl bg-muted/50 border border-muted flex flex-col gap-3">
                  <Zap className="h-6 w-6 text-purple-600" />
                  <h4 className="font-bold">Portfolio Logic</h4>
                  <p className="text-sm text-muted-foreground">Run recruitment, seeding, and performance-based hybrid campaigns simultaneously.</p>
                </div>
              </div>

              <Button
                size="lg"
                className="w-full h-16 rounded-2xl text-lg font-bold group bg-primary hover:bg-primary/90"
                onClick={() => setStep(2)}
              >
                Enter the Command Center
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="space-y-2 text-center">
                <h3 className="text-3xl font-black tracking-tight">The Three Pillars</h3>
                <p className="text-muted-foreground">Verza empowers your {entityName.toLowerCase()} across three core areas. Choose where to start.</p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => handleComplete('/agency')}
                  className="w-full p-6 rounded-3xl border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left group flex items-center gap-6"
                >
                  <div className="h-14 w-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                    <Users className="h-7 w-7 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-lg">Onboard Talent</h4>
                    <p className="text-sm text-muted-foreground">Invite your existing creators to set up their private profiles and sign contracts.</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </button>

                <button
                  onClick={() => handleComplete('/campaigns')}
                  className="w-full p-6 rounded-3xl border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left group flex items-center gap-6"
                >
                  <div className="h-14 w-14 rounded-2xl bg-purple-500/10 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                    <Target className="h-7 w-7 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-lg">Launch Campaign Portfolio</h4>
                    <p className="text-sm text-muted-foreground">Deploy hybrid campaigns—blend flat-fee sponsorships with performance incentives to maximize ROI.</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </button>

                <button
                  onClick={() => handleComplete('/wallet')}
                  className="w-full p-6 rounded-3xl border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left group flex items-center gap-6"
                >
                  <div className="h-14 w-14 rounded-2xl bg-green-500/10 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                    <Wallet className="h-7 w-7 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-lg">Financial Infrastructure</h4>
                    <p className="text-sm text-muted-foreground">Top up your wallet to fund performance rewards and automate creator payouts.</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </button>
              </div>

              <div className="text-center pt-4">
                <Button variant="ghost" onClick={() => setStep(3)} className="text-muted-foreground">
                  View Compliance Features
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 text-green-600 text-[10px] font-black uppercase tracking-widest mb-2">
                  <ShieldCheck className="h-3 w-3" /> Compliance First
                </div>
                <h3 className="text-3xl font-black tracking-tight">Financial OS</h3>
                <p className="text-muted-foreground">Verza handles the heavy lifting so you can focus on growth.</p>
              </div>

              <div className="p-6 rounded-3xl bg-muted/50 border border-muted relative overflow-hidden">
                <Quote className="absolute top-4 left-4 h-8 w-8 text-muted-foreground/20" />
                <div className="relative z-10 space-y-4 text-center">
                  <p className="text-sm italic leading-relaxed text-foreground/80 max-w-md mx-auto">
                    “Verza streamlined our entire creator payroll. What used to take days of manual tracking now happens automatically. It's the only way to scale talent management.”
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Building className="h-5 w-5 text-primary" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-black tracking-tight">Scale Partner</p>
                      <p className="text-[10px] text-muted-foreground uppercase font-bold">Leading Brand Agency</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl border bg-card flex flex-col items-center text-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="text-[10px] font-bold uppercase">Automated Tax Forms</p>
                </div>
                <div className="p-4 rounded-2xl border bg-card flex flex-col items-center text-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-purple-600" />
                  <p className="text-[10px] font-bold uppercase">Smart Contract Audit</p>
                </div>
              </div>

              <Button
                size="lg"
                className="w-full h-16 rounded-2xl text-lg font-bold group bg-primary hover:bg-primary/90"
                onClick={() => setStep(2)}
              >
                Back to Action Pillars
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

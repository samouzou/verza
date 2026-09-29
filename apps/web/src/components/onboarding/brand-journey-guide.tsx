"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Target, Users, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";

import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";

interface BrandJourneyGuideProps {
  onClose?: () => void;
}

const START_OPTIONS = [
  {
    title: "Launch a campaign",
    description: "Start a campaign now.",
    href: "/campaigns/post",
    icon: Target,
  },
  {
    title: "Invite creators",
    description: "Add creators to your campaign.",
    href: "/agency",
    icon: Users,
  },
  {
    title: "Pay creators",
    description: "Fund payouts and send money to creators.",
    href: "/wallet",
    icon: Wallet,
  },
] as const;

export function BrandJourneyGuide({ onClose }: BrandJourneyGuideProps) {
  const { user, refreshAuthUser } = useAuth();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const handleComplete = async (destination: string) => {
    if (!user || pendingHref) return;
    setPendingHref(destination);
    try {
      const userDocRef = doc(db, "users", user.uid);
      await updateDoc(userDocRef, {
        hasCompletedBrandJourney: true,
      });
      await refreshAuthUser();

      if (onClose) onClose();
      router.push(destination);
    } catch (error) {
      console.error("Error completing brand journey:", error);
      setPendingHref(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl animate-in fade-in duration-500">
      <div className="w-full max-w-xl bg-card border border-border shadow-2xl rounded-[2rem] overflow-hidden">
        <div className="p-8 md:p-10 space-y-8">
          <div className="space-y-2 text-center">
            <h2 className="text-3xl font-black tracking-tight">
              What do you want to do first?
            </h2>
            <p className="text-muted-foreground">
              Pick one. You can do the others from the app whenever you are ready.
            </p>
          </div>

          <div className="space-y-3">
            {START_OPTIONS.map((option) => {
              const Icon = option.icon;
              const pending = pendingHref === option.href;
              return (
                <button
                  key={option.href}
                  type="button"
                  disabled={pendingHref !== null}
                  onClick={() => void handleComplete(option.href)}
                  className="w-full p-5 rounded-3xl border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left group flex items-center gap-5 disabled:opacity-60 disabled:pointer-events-none"
                >
                  <div className="h-12 w-12 rounded-2xl bg-emerald-600/10 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                    {pending ? (
                      <Loader2 className="h-6 w-6 text-emerald-600 animate-spin" />
                    ) : (
                      <Icon className="h-6 w-6 text-emerald-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg">{option.title}</h3>
                    <p className="text-sm text-muted-foreground">{option.description}</p>
                  </div>
                  <ArrowRight
                    className={cn(
                      "h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0"
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

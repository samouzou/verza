"use client";

import { useState } from "react";
import { ArrowRight, DollarSign, Loader2, Sparkles, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { useAuth } from "@/hooks/use-auth";
import { db, functions } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type PathType = "monetized" | "emerging" | "community";

interface CreatorCareerGuideProps {
  onClose?: () => void;
}

const START_OPTIONS = [
  {
    path: "monetized" as const,
    title: "Find brand deals",
    description: "Browse campaigns and apply.",
    href: "/campaigns",
    icon: DollarSign,
  },
  {
    path: "community" as const,
    title: "Sell to my community",
    description: "Open your Store for tips, courses, and downloads.",
    href: "/store",
    icon: Users,
  },
  {
    path: "emerging" as const,
    title: "Make content",
    description: "Start in Reelwright.",
    href: "/ai-studio",
    icon: Sparkles,
  },
] as const;

export function CreatorCareerGuide({ onClose }: CreatorCareerGuideProps) {
  const { user, refreshAuthUser } = useAuth();
  const router = useRouter();
  const [pendingPath, setPendingPath] = useState<PathType | null>(null);

  const handleComplete = async (path: PathType, destination: string) => {
    if (!user || pendingPath) return;
    setPendingPath(path);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        hasCompletedCareerPath: true,
        careerPathResult: path,
      });

      try {
        await httpsCallable(functions, "startCareerPathEmailSequence")({});
      } catch (pathEmailErr) {
        console.error("Career path email sequence failed (non-blocking):", pathEmailErr);
      }

      await refreshAuthUser();
      if (onClose) onClose();
      router.push(destination);
    } catch (error) {
      console.error("Error saving career path:", error);
      setPendingPath(null);
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
              const pending = pendingPath === option.path;
              return (
                <button
                  key={option.path}
                  type="button"
                  disabled={pendingPath !== null}
                  onClick={() => void handleComplete(option.path, option.href)}
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

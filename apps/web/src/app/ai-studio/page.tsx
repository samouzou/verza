"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Clapperboard, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTour } from "@/hooks/use-tour";
import { aiStudioTour } from "@/lib/tours";
import { trackEvent } from "@/lib/analytics";
import { reelwrightUrl } from "@/lib/reelwright";
import { useAuth } from "@/hooks/use-auth";

const STUDIO_URL = reelwrightUrl({ from: "verza" });

const STEPS = [
  {
    icon: Users,
    label: "Cast",
    title: "Start with a character",
    body: "Pick someone who holds a look — then take them into the next shot.",
  },
  {
    icon: Clapperboard,
    label: "Shoot",
    title: "Step into a scene",
    body: "Describe the moment in your own words. Landscape or portrait. Keep going from the last frame.",
  },
  {
    icon: Sparkles,
    label: "Continue",
    title: "Edit by talking",
    body: "Change the mood, keep the same face, cut the next beat. The reel continues.",
  },
] as const;

function ReelwrightDoorway() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { startTour } = useTour();
  const { user } = useAuth();

  const studioHref =
    user?.careerPathResult === "emerging"
      ? reelwrightUrl({ from: "verza", path: "emerging" })
      : STUDIO_URL;

  useEffect(() => {
    if (searchParams.get("purchase_success") === "true") {
      toast({
        title: "Payment received",
        description:
          "Generation now lives in Reelwright. Open the studio to keep creating.",
      });
    }
  }, [searchParams, toast]);

  const openStudio = () => {
    trackEvent({
      action: "open_reelwright",
      category: "reelwright",
      label: user?.careerPathResult || "nav",
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0B0B0B] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="pointer-events-none absolute left-1/2 top-8 h-64 w-64 -translate-x-1/2 rounded-full bg-[#EAB308]/20 blur-3xl" />

        <div className="relative z-10 px-6 py-10 sm:px-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#EAB308]">
            Verza growth path
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            Reelwright
          </h1>
          <p className="mt-3 max-w-xl text-lg text-white/75">
            Characters that hold. Scenes that continue. Edit by talking.
          </p>
          <p className="mt-2 max-w-xl text-sm text-white/50">
            AI Studio moved into its own studio. Prototype hooks and visuals in
            Reelwright, then bring the cut back to Verza for campaigns, Store, and payouts.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              id="reelwright-open-studio"
              asChild
              className="bg-[#EAB308] text-black hover:bg-[#FACC15]"
            >
              <a
                href={studioHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={openStudio}
              >
                Open Reelwright
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button
              variant="outline"
              className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => startTour(aiStudioTour)}
            >
              How it fits
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div
            key={step.label}
            className="rounded-xl border border-border bg-card p-4"
          >
            <step.icon className="h-5 w-5 text-[#EAB308]" />
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {step.label}
            </p>
            <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Stay in Verza for{" "}
        <Link href="/campaigns" className="text-primary underline-offset-4 hover:underline">
          campaigns
        </Link>
        {" · "}
        <Link href="/insights" className="text-primary underline-offset-4 hover:underline">
          insights
        </Link>
        {" · "}
        <Link href="/store" className="text-primary underline-offset-4 hover:underline">
          Store
        </Link>
      </p>
    </div>
  );
}

export default function AiStudioPage() {
  return (
    <Suspense fallback={null}>
      <ReelwrightDoorway />
    </Suspense>
  );
}

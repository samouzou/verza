"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { db, functions } from "@/lib/firebase";
import type { Gig } from "@/types";

/**
 * Brand-safe funding entry point for MCP / chat.
 * Stripe Checkout URLs include a long # fragment that chat clients often strip,
 * which breaks payment ("This link is incomplete"). This page mints a fresh
 * session in-browser and redirects with the full URL intact.
 */
export default function CampaignFundPage() {
  const params = useParams();
  const gigId = typeof params?.id === "string" ? params.id : "";
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparing secure checkout…");

  useEffect(() => {
    if (authLoading || !gigId) return;

    if (!user) {
      setError("Sign in to fund this campaign.");
      return;
    }
    if (!isAgencyTeam) {
      setError("Only brand team members can fund this campaign.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setStatus("Loading campaign…");
        const snap = await getDoc(doc(db, "gigs", gigId));
        if (!snap.exists()) {
          throw new Error("Campaign not found.");
        }
        const gig = {id: snap.id, ...snap.data()} as Gig;
        if (gig.brandId !== user.primaryAgencyId) {
          throw new Error("This campaign belongs to another brand workspace.");
        }
        if (gig.status !== "pending_payment") {
          throw new Error(
            gig.status === "open" || gig.status === "in-progress"
              ? "This campaign is already funded."
              : `This campaign can’t be funded (status: ${gig.status}).`
          );
        }

        setStatus("Opening Stripe checkout…");
        const createCheckout = httpsCallable(functions, "createGigFundingCheckoutSession");
        const result = await createCheckout({
          id: gig.id,
          title: gig.title,
          description: gig.description,
          platforms: gig.platforms,
          ratePerCreator: gig.ratePerCreator,
          creatorsNeeded: gig.creatorsNeeded,
          videosPerCreator: gig.videosPerCreator,
          campaignType: gig.campaignType || "standard_sponsorship",
          usageRights: gig.usageRights || "1_year",
          allowWhitelisting: !!gig.allowWhitelisting,
          affiliateSettings: gig.affiliateSettings,
          requireVerzaScore: gig.requireVerzaScore,
          verzaScoreThreshold: gig.verzaScoreThreshold,
          deliverablesDueDate: gig.deliverablesDueDate,
        });
        const data = result.data as {url?: string};
        if (!data.url) {
          throw new Error("Could not create a payment link. Try again from the campaign page.");
        }
        if (cancelled) return;
        window.location.href = data.url;
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not start checkout.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, gigId, user, isAgencyTeam]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-16">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn’t open funding</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          {gigId && (
            <Button asChild variant="outline">
              <Link href={`/campaigns/${gigId}`}>Back to campaign</Link>
            </Button>
          )}
          {!user && (
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-24 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{status}</p>
      <p className="text-xs text-muted-foreground">
        You’ll be redirected to Stripe to complete payment. Don’t close this tab.
      </p>
    </div>
  );
}

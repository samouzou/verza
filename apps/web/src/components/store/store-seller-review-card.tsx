"use client";

import { useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

type Props = {
  connectReady: boolean;
};

export function StoreSellerReviewCard({ connectReady }: Props) {
  const { user, refreshAuthUser } = useAuth();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const status = user.storeSellerStatus ?? "none";
  const hasSocial = !!(
    user.instagramConnected ||
    user.youtubeConnected ||
    user.tiktokConnected
  );

  if (status === "approved") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Store selling approved</p>
          <p className="text-muted-foreground">
            You can publish courses, tip jars, and download links.
          </p>
        </div>
      </div>
    );
  }

  if (status === "pending_review") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Store application under review</p>
          <p className="text-muted-foreground">
            You can keep drafting products. Publishing goes live after Verza approves your
            seller account.
          </p>
        </div>
      </div>
    );
  }

  if (status === "suspended") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Store selling suspended</p>
          <p className="text-muted-foreground">
            Contact{" "}
            <a className="underline" href="mailto:support@tryverza.com">
              support@tryverza.com
            </a>{" "}
            if you think this is a mistake.
          </p>
        </div>
      </div>
    );
  }

  const rejected = status === "rejected";

  const submit = async () => {
    setSubmitting(true);
    try {
      const callable = httpsCallable(functions, "submitStoreSellerReview");
      await callable({ note: note.trim() || undefined });
      await refreshAuthUser();
      toast({
        title: "Submitted for review",
        description: "We’ll email you when your Store is approved.",
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not submit for review.";
      toast({ variant: "destructive", title: "Review", description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-medium">
            {rejected ? "Resubmit Store for review" : "Get approved to sell"}
          </p>
          <p className="text-muted-foreground">
            Before any course, tip jar, or download can go live, Verza reviews your seller
            account. Connect payouts and at least one social in Insights, then submit.
          </p>
          {rejected && user.storeSellerRejectReason && (
            <p className="text-destructive">
              Last decision: {user.storeSellerRejectReason}
            </p>
          )}
        </div>
      </div>

      <ul className="space-y-1 text-xs text-muted-foreground pl-8 list-disc">
        <li className={connectReady ? "text-foreground" : undefined}>
          Payouts connected{connectReady ? " ✓" : " — open Settings"}
        </li>
        <li className={hasSocial ? "text-foreground" : undefined}>
          Social connected{hasSocial ? " ✓" : " — open Insights"}
        </li>
      </ul>

      <div className="flex flex-wrap gap-2 pl-8">
        {!connectReady && (
          <Button asChild size="sm" variant="outline">
            <Link href="/settings">Open Settings</Link>
          </Button>
        )}
        {!hasSocial && (
          <Button asChild size="sm" variant="outline">
            <Link href="/insights">Open Insights</Link>
          </Button>
        )}
      </div>

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for reviewers (what you sell, audience, etc.)"
        maxLength={500}
        className="min-h-[72px]"
      />

      <Button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || !connectReady || !hasSocial}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : rejected ? (
          "Resubmit for review"
        ) : (
          "Submit for review"
        )}
      </Button>
    </div>
  );
}

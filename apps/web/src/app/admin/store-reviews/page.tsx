"use client";

import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

type ReviewRow = {
  id: string;
  uid: string;
  email: string | null;
  displayName: string | null;
  status: string;
  hasConnectedSocial?: boolean;
  instagramConnected?: boolean;
  youtubeConnected?: boolean;
  tiktokConnected?: boolean;
  stripePayoutsEnabled?: boolean;
  note?: string | null;
  rejectReason?: string | null;
};

export default function AdminStoreReviewsPage() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const checkAccess = useCallback(async () => {
    if (!user) {
      setAllowed(false);
      return;
    }
    try {
      const callable = httpsCallable(functions, "getStoreReviewerAccess");
      const res = await callable({});
      setAllowed((res.data as { isReviewer?: boolean }).isReviewer === true);
    } catch {
      setAllowed(false);
    }
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const callable = httpsCallable(functions, "listStoreSellerReviews");
      const res = await callable({ status: statusFilter });
      const data = res.data as { reviews?: ReviewRow[] };
      setReviews(Array.isArray(data.reviews) ? data.reviews : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not load reviews.";
      toast({ variant: "destructive", title: "Reviews", description: message });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    if (!isLoading) void checkAccess();
  }, [isLoading, checkAccess]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const decide = async (
    creatorId: string,
    decision: "approved" | "rejected" | "suspended"
  ) => {
    setBusyId(creatorId);
    try {
      const callable = httpsCallable(functions, "reviewStoreSeller");
      await callable({
        creatorId,
        decision,
        reason: reasons[creatorId]?.trim() || undefined,
      });
      toast({ title: `Marked ${decision}` });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not update review.";
      toast({ variant: "destructive", title: "Review", description: message });
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading || allowed === null) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !allowed) {
    return (
      <div className="mx-auto max-w-lg space-y-2 py-20 text-center">
        <h1 className="text-xl font-semibold">Store reviews</h1>
        <p className="text-sm text-muted-foreground">
          You don’t have access to this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Store seller reviews"
        description="Approve creators before they can sell courses, tip jars, or downloads."
      />

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["pending_review", "Pending"],
            ["approved", "Approved"],
            ["rejected", "Rejected"],
            ["suspended", "Suspended"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={statusFilter === key ? "secondary" : "ghost"}
            onClick={() => setStatusFilter(key)}
          >
            {label}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {loading && reviews.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications in this view.</p>
      ) : (
        <ul className="space-y-4">
          {reviews.map((row) => (
            <li key={row.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{row.displayName || "Creator"}</p>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                  <p className="text-[11px] font-mono text-muted-foreground">{row.uid}</p>
                </div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {row.status}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Payouts: {row.stripePayoutsEnabled ? "yes" : "no"} · Social:{" "}
                {[
                  row.instagramConnected && "IG",
                  row.youtubeConnected && "YT",
                  row.tiktokConnected && "TT",
                ]
                  .filter(Boolean)
                  .join(", ") || "none"}
              </p>
              {row.note && (
                <p className="text-sm rounded-md bg-muted/40 p-2">{row.note}</p>
              )}
              {row.rejectReason && (
                <p className="text-sm text-destructive">{row.rejectReason}</p>
              )}
              {(statusFilter === "pending_review" ||
                statusFilter === "approved" ||
                statusFilter === "rejected") && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    placeholder="Reject / suspend reason"
                    value={reasons[row.uid] ?? ""}
                    onChange={(e) =>
                      setReasons((prev) => ({ ...prev, [row.uid]: e.target.value }))
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === row.uid}
                      onClick={() => void decide(row.uid, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.uid}
                      onClick={() => void decide(row.uid, "rejected")}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === row.uid}
                      onClick={() => void decide(row.uid, "suspended")}
                    >
                      Suspend
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

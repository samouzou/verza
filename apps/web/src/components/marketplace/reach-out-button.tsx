"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Loader2, Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { db, functions } from "@/lib/firebase";
import { setPostAuthRedirect } from "@/lib/post-auth-redirect";
import { useToast } from "@/hooks/use-toast";
import { gigHasCreatorCap, isPoolBudgetGig, type Gig } from "@/types";

type InviteStatus = "invited" | "already_invited" | "already_applied" | "already_accepted";

export function ReachOutButton({
  creatorId,
  creatorName,
}: {
  creatorId: string;
  creatorName?: string;
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { toast } = useToast();
  const returnTo = `/creator/${creatorId}`;
  const isBrand =
    user?.isBrandAccount ||
    user?.role === "agency_owner" ||
    user?.role === "agency_admin" ||
    user?.role === "agency_member";

  const [open, setOpen] = useState(false);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [loadingGigs, setLoadingGigs] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [offerByGig, setOfferByGig] = useState<Record<string, string>>({});

  const agencyId = user?.primaryAgencyId;

  useEffect(() => {
    if (!open || !agencyId || !isBrand) return;
    setLoadingGigs(true);
    const unsub = onSnapshot(
      query(collection(db, "gigs"), where("brandId", "==", agencyId)),
      (snap) => {
        const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Gig));
        setGigs(fetched);
        setLoadingGigs(false);
      },
      () => setLoadingGigs(false)
    );
    return () => unsub();
  }, [open, agencyId, isBrand]);

  const liveGigs = useMemo(() => {
    return gigs
      .filter((g) => g.status === "open" || g.status === "in-progress")
      .sort((a, b) => {
        const am = (a.createdAt as { toMillis?: () => number })?.toMillis?.() || 0;
        const bm = (b.createdAt as { toMillis?: () => number })?.toMillis?.() || 0;
        return bm - am;
      });
  }, [gigs]);

  const invite = async (gig: Gig) => {
    const offered = offerByGig[gig.id];
    if (isPoolBudgetGig(gig) && (!offered || Number(offered) < 1)) {
      toast({
        title: "Enter an offer",
        description: "Set what you expect to pay this creator from the campaign budget.",
        variant: "destructive",
      });
      return;
    }
    setInvitingId(gig.id);
    try {
      const callable = httpsCallable(functions, "inviteCreatorToCampaign");
      const result = await callable({
        gigId: gig.id,
        creatorId,
        ...(isPoolBudgetGig(gig) ? { offeredPayout: Number(offered) } : {}),
      });
      const status = (result.data as { status?: InviteStatus }).status;
      if (status === "already_accepted") {
        toast({ title: "Already on this campaign", description: `${creatorName || "This creator"} is already on the roster.` });
      } else if (status === "already_applied") {
        toast({
          title: "They already applied",
          description: "Review their application on the campaign page.",
        });
      } else if (status === "already_invited") {
        toast({ title: "Invite already sent", description: "They're still deciding on this brief." });
      } else {
        toast({
          title: "Invite sent",
          description: `${creatorName || "The creator"} can accept from the campaign page.`,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not send the invite.";
      toast({ title: "Invite failed", description: message, variant: "destructive" });
    } finally {
      setInvitingId(null);
    }
  };

  if (isLoading) {
    return (
      <Button className="w-full mt-6" disabled>
        Reach out
      </Button>
    );
  }

  if (!isAuthenticated) {
    return (
      <Button asChild className="w-full mt-6">
        <Link href={`/login?next=${encodeURIComponent(returnTo)}`} onClick={() => setPostAuthRedirect(returnTo)}>
          Sign up to reach out
        </Link>
      </Button>
    );
  }

  if (!isBrand) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        Ready to work together? Invite them to a campaign from your brand workspace.
      </p>
    );
  }

  const postHref = `/campaigns/post?inviteCreator=${encodeURIComponent(creatorId)}`;

  return (
    <>
      <Button className="w-full mt-6" onClick={() => setOpen(true)}>
        <Megaphone className="mr-2 h-4 w-4" />
        Invite to a campaign
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite {creatorName || "this creator"}</DialogTitle>
            <DialogDescription>
              Pick a live campaign. They get an email and can accept from the brief.
            </DialogDescription>
          </DialogHeader>
          {loadingGigs ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : liveGigs.length === 0 ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                You don&apos;t have a live campaign yet. Post one, then we&apos;ll prompt you to send this invite.
              </p>
              <Button asChild className="w-full">
                <Link href={postHref}>Post a campaign</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {liveGigs.map((gig) => {
                const invited = (gig.invitedCreatorIds || []).includes(creatorId);
                const applied = (gig.appliedCreatorIds || []).includes(creatorId);
                const accepted = (gig.acceptedCreatorIds || []).includes(creatorId);
                const rejected = (gig.rejectedCreatorIds || []).includes(creatorId);
                const cap = gigHasCreatorCap(gig);
                const spotsLeft = cap
                  ? Math.max(0, (gig.creatorsNeeded || 0) - (gig.acceptedCreatorIds || []).length)
                  : Infinity;
                const full = cap && spotsLeft <= 0;
                const pool = isPoolBudgetGig(gig);
                return (
                  <div key={gig.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{gig.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {full ? "Full" : cap ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left` : "Open roster"}
                        </p>
                      </div>
                      {accepted ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/campaigns/${gig.id}`}>On roster</Link>
                        </Button>
                      ) : applied ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/campaigns/${gig.id}`}>Review application</Link>
                        </Button>
                      ) : rejected ? (
                        <span className="text-xs text-muted-foreground shrink-0">Declined</span>
                      ) : invited ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/campaigns/${gig.id}`}>Invite sent</Link>
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={full || invitingId === gig.id}
                          onClick={() => void invite(gig)}
                        >
                          {invitingId === gig.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}
                        </Button>
                      )}
                    </div>
                    {pool && !accepted && !applied && !invited && !rejected && !full && (
                      <div className="space-y-1">
                        <Label htmlFor={`offer-${gig.id}`} className="text-[11px] text-muted-foreground">
                          Expected pay ($)
                        </Label>
                        <Input
                          id={`offer-${gig.id}`}
                          type="number"
                          min={1}
                          step="1"
                          placeholder="e.g. 250"
                          value={offerByGig[gig.id] || ""}
                          onChange={(e) =>
                            setOfferByGig((prev) => ({ ...prev, [gig.id]: e.target.value }))
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <Button asChild variant="ghost" className="w-full">
                <Link href={postHref}>Post a new campaign instead</Link>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

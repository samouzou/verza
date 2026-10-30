"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Loader2, UserPlus } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { db, functions } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { isPoolBudgetGig, type Agency, type Gig, type UserProfileFirestoreData } from "@/types";

type InviteStatus = "invited" | "already_invited" | "already_applied" | "already_accepted";

type KnownCreator = {
  uid: string;
  displayName: string;
  avatarUrl: string | null;
  onRoster: boolean;
  pastHire: boolean;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function busyOnGig(gig: Gig, uid: string): boolean {
  return (
    (gig.acceptedCreatorIds || []).includes(uid) ||
    (gig.appliedCreatorIds || []).includes(uid) ||
    (gig.invitedCreatorIds || []).includes(uid) ||
    (gig.rejectedCreatorIds || []).includes(uid)
  );
}

export function InviteKnownCreatorsButton({ gig, agency }: { gig: Gig; agency: Agency | null }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<KnownCreator[]>([]);
  const [search, setSearch] = useState("");
  const [offerByUid, setOfferByUid] = useState<Record<string, string>>({});
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const pool = isPoolBudgetGig(gig);
  const canInvite = gig.status === "open" || gig.status === "in-progress";

  useEffect(() => {
    if (!open) return;
    if (!agency) {
      setLoading(true);
      return;
    }
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const rosterIds = new Set(
          (agency.talent || [])
            .filter((t) => t.status === "active" && t.userId)
            .map((t) => t.userId)
        );
        const pastIds = new Set<string>();
        const gigsSnap = await getDocs(query(collection(db, "gigs"), where("brandId", "==", agency.id)));
        gigsSnap.forEach((d) => {
          const accepted = (d.data().acceptedCreatorIds || []) as string[];
          accepted.forEach((id) => {
            if (id) pastIds.add(id);
          });
        });

        const teamIds = new Set<string>([
          agency.ownerId,
          ...(agency.team || []).map((m) => m.userId),
        ]);
        const allIds = [...new Set([...rosterIds, ...pastIds])].filter(
          (id) => !teamIds.has(id) && !busyOnGig(gig, id)
        );

        const talentName = new Map(
          (agency.talent || []).map((t) => [t.userId, t.displayName || t.email || "Creator"])
        );
        const profiles = new Map<string, UserProfileFirestoreData>();
        for (const group of chunk(allIds, 10)) {
          if (group.length === 0) continue;
          const snap = await getDocs(query(collection(db, "users"), where(documentId(), "in", group)));
          snap.forEach((docSnap) => {
            profiles.set(docSnap.id, { uid: docSnap.id, ...docSnap.data() } as UserProfileFirestoreData);
          });
        }

        const next: KnownCreator[] = allIds.map((uid) => {
          const profile = profiles.get(uid);
          return {
            uid,
            displayName: profile?.displayName || talentName.get(uid) || "Creator",
            avatarUrl: profile?.avatarUrl || null,
            onRoster: rosterIds.has(uid),
            pastHire: pastIds.has(uid),
          };
        }).sort((a, b) => a.displayName.localeCompare(b.displayName));

        if (!cancelled) setPeople(next);
      } catch (error) {
        console.error("Failed to load known creators", error);
        if (!cancelled) {
          setPeople([]);
          toast({
            title: "Could not load roster",
            description: "Try again in a moment.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // Candidate pool is roster + past hires. Current-campaign busy state is filtered live.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gig snapshots would refetch the whole list
  }, [open, agency]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people.filter((p) => !busyOnGig(gig, p.uid));
    return people.filter(
      (p) => !busyOnGig(gig, p.uid) && p.displayName.toLowerCase().includes(q)
    );
  }, [people, search, gig]);

  const invite = async (person: KnownCreator) => {
    const offered = offerByUid[person.uid];
    if (pool && (!offered || Number(offered) < 1)) {
      toast({
        title: "Enter an offer",
        description: "Set what you expect to pay this creator from the campaign budget.",
        variant: "destructive",
      });
      return;
    }
    setInvitingId(person.uid);
    try {
      const callable = httpsCallable(functions, "inviteCreatorToCampaign");
      const result = await callable({
        gigId: gig.id,
        creatorId: person.uid,
        ...(pool ? { offeredPayout: Number(offered) } : {}),
      });
      const status = (result.data as { status?: InviteStatus }).status;
      if (status === "already_accepted") {
        toast({ title: "Already on this campaign", description: `${person.displayName} is already on the roster.` });
      } else if (status === "already_applied") {
        toast({ title: "They already applied", description: "Review their application on this page." });
      } else if (status === "already_invited") {
        toast({ title: "Invite already sent", description: `${person.displayName} is still deciding.` });
      } else {
        toast({
          title: "Invite sent",
          description: `${person.displayName} can accept from the campaign page.`,
        });
      }
      setPeople((prev) => prev.filter((p) => p.uid !== person.uid));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not send the invite.";
      toast({ title: "Invite failed", description: message, variant: "destructive" });
    } finally {
      setInvitingId(null);
    }
  };

  if (!canInvite) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="mr-2 h-4 w-4" />
        Invite from roster
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite someone you already know</DialogTitle>
            <DialogDescription>
              Active roster talent and creators you have hired on past campaigns. They still accept the brief.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                placeholder="Search by name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {filtered.length === 0 ? (
                <div className="space-y-3 py-2 text-sm text-muted-foreground">
                  <p>
                    {people.length === 0
                      ? "No one on your roster or past campaigns is free to invite yet."
                      : "No matching creators."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/agency">Open agency roster</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/campaigns">Browse campaigns</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
                  {filtered.map((person) => (
                    <div key={person.uid} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/creator/${person.uid}`}
                          className="flex items-center gap-2 min-w-0 hover:opacity-80"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={person.avatarUrl || ""} />
                            <AvatarFallback>{person.displayName.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{person.displayName}</p>
                            <div className="flex flex-wrap gap-1">
                              {person.onRoster && (
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Roster</Badge>
                              )}
                              {person.pastHire && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5">Past hire</Badge>
                              )}
                            </div>
                          </div>
                        </Link>
                        <Button
                          size="sm"
                          disabled={invitingId === person.uid}
                          onClick={() => void invite(person)}
                        >
                          {invitingId === person.uid ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}
                        </Button>
                      </div>
                      {pool && (
                        <div className="space-y-1">
                          <Label htmlFor={`known-offer-${person.uid}`} className="text-[11px] text-muted-foreground">
                            Expected pay ($)
                          </Label>
                          <Input
                            id={`known-offer-${person.uid}`}
                            type="number"
                            min={1}
                            step="1"
                            placeholder="e.g. 250"
                            value={offerByUid[person.uid] || ""}
                            onChange={(e) =>
                              setOfferByUid((prev) => ({ ...prev, [person.uid]: e.target.value }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

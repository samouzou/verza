
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Loader2, Store, Building } from "lucide-react";
import { collection, documentId, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth, type UserProfile } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { Agency } from "@/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function isSwitchableWorkspace(user: UserProfile, agency: Agency): boolean {
  if (agency.ownerId === user.uid) return true;
  const membership = user.agencyMemberships?.find((m) => m.agencyId === agency.id);
  return !!membership && membership.status === "active" &&
    (membership.role === "admin" || membership.role === "member" || membership.role === "owner");
}

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { user, refreshAuthUser } = useAuth();
  const { toast } = useToast();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [switchingToId, setSwitchingToId] = useState<string | null>(null);

  const agencyIds = useMemo(() => {
    if (!user) return [];
    const membershipIds = user.agencyMemberships?.map((m) => m.agencyId) || [];
    return Array.from(new Set([...membershipIds, user.primaryAgencyId].filter(Boolean))) as string[];
  }, [user]);

  useEffect(() => {
    if (agencyIds.length === 0) {
      setAgencies([]);
      return;
    }
    const q = query(collection(db, "agencies"), where(documentId(), "in", agencyIds.slice(0, 30)));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAgencies(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Agency)));
    });
    return () => unsubscribe();
  }, [agencyIds.join("|")]);

  if (!user || agencies.length === 0) {
    return null;
  }

  const isBrand = !!user.isBrandAccount;
  const WorkspaceIcon = isBrand ? Store : Building;
  const noun = isBrand ? "Brand" : "Agency";
  const active = agencies.find((agency) => agency.id === user.primaryAgencyId) || agencies[0];
  const switchable = agencies.filter((agency) => isSwitchableWorkspace(user, agency));

  const handleSwitch = async (agencyId: string) => {
    if (!user || agencyId === user.primaryAgencyId || switchingToId) return;
    const agency = agencies.find((item) => item.id === agencyId);
    if (!agency || !isSwitchableWorkspace(user, agency)) return;

    setSwitchingToId(agencyId);
    try {
      await httpsCallable(functions, "switchPrimaryAgency")({ agencyId });
      await refreshAuthUser();
    } catch (error: any) {
      toast({
        title: "Could not switch workspace",
        description: error.message || `Campaigns still point at the previous ${noun.toLowerCase()}.`,
        variant: "destructive",
      });
    } finally {
      setSwitchingToId(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className={cn(
            "justify-between gap-2 bg-sidebar-accent/40 border-sidebar-border",
            compact ? "h-8 max-w-[160px] px-2" : "w-full h-10 px-2 group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center"
          )}
          disabled={!!switchingToId}
        >
          <span className="flex items-center gap-2 min-w-0">
            {switchingToId ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : (
              <WorkspaceIcon className="h-4 w-4 shrink-0" />
            )}
            <span className={cn("truncate text-sm font-medium", compact ? "" : "group-data-[collapsible=icon]:hidden")}>
              {active.name}
            </span>
          </span>
          <ChevronsUpDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", compact ? "" : "group-data-[collapsible=icon]:hidden")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" side={compact ? "bottom" : "right"} sideOffset={8}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {noun} workspace
        </DropdownMenuLabel>
        {agencies.map((agency) => {
          const membership = user.agencyMemberships?.find((m) => m.agencyId === agency.id);
          const isActive = agency.id === user.primaryAgencyId;
          const canSwitch = isSwitchableWorkspace(user, agency);
          const pending = membership?.status === "pending";
          return (
            <DropdownMenuItem
              key={agency.id}
              disabled={!canSwitch || isActive || !!switchingToId}
              onSelect={() => handleSwitch(agency.id)}
              className="flex items-center gap-2"
            >
              <Check className={cn("h-4 w-4", isActive ? "opacity-100" : "opacity-0")} />
              <span className="flex-1 truncate">{agency.name}</span>
              {pending && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Invite</span>}
              {switchingToId === agency.id && <Loader2 className="h-3 w-3 animate-spin" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/agency">Manage {noun.toLowerCase()}s</Link>
        </DropdownMenuItem>
        {switchable.length < 2 && agencies.length < 2 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Invites to other {noun.toLowerCase()}s will appear here.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

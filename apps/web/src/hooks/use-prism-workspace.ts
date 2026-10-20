"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { useAuth } from "@/hooks/use-auth";
import { functions } from "@/lib/firebase";

function isCreatorRole(role: string | undefined): boolean {
  return role === "individual_creator" || role === "talent";
}

/**
 * The agency id Prism should use. Brand teams keep their primary agency.
 * Creators get a personal workspace that does not unlock brand tools.
 */
export function usePrismWorkspace() {
  const { user, isLoading, isAgencyTeam } = useAuth();
  const isCreator = isCreatorRole(user?.role);
  const brandWorkspace = isAgencyTeam && user?.primaryAgencyId ? user.primaryAgencyId : null;
  const [personalId, setPersonalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading || !user || brandWorkspace || !isCreator) return;
    if (user.prismWorkspaceId) {
      setPersonalId(user.prismWorkspaceId);
      return;
    }
    let cancelled = false;
    httpsCallable(functions, "ensurePrismWorkspace")({})
      .then((res) => {
        const id = (res.data as { agencyId?: string }).agencyId ?? null;
        if (!cancelled) setPersonalId(id);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't open Prism.");
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading, user, brandWorkspace, isCreator]);

  const opening = !!user && isCreator && !brandWorkspace && !personalId && !error;
  return {
    user,
    authLoading: isLoading || opening,
    agencyId: brandWorkspace ?? (isCreator ? personalId : null),
    allowed: !!brandWorkspace || isCreator,
    lead:
      user?.role === "agency_owner" ||
      user?.role === "agency_admin" ||
      isCreator,
    error,
  };
}

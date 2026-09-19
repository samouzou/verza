"use client";

import { useCallback, useState } from "react";
import { httpsCallable } from "firebase/functions";
import type {
  OpticLeadResponse,
  OpticLeadStage,
  OpticPassReason,
} from "@verza/types";

import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

export type OpticLeadDraftPatch = {
  draftEmail?: string;
  draftEmailSubject?: string | null;
  draftDm?: string;
};

export type OpticLeadCrmPatch = {
  pipelineStage?: OpticLeadStage;
  outreachResponse?: OpticLeadResponse | null;
  passReason?: OpticPassReason | null;
  crmNote?: string | null;
  touchLastContacted?: boolean;
};

export type OpticLeadProfilePatch = {
  creatorName?: string;
  niche?: string | null;
  bio?: string | null;
  followerCount?: string | null;
  externalUrl?: string | null;
  matchReason?: string | null;
  discoveryPlatform?: string;
};

export function useOpticLeadOutreach() {
  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [emailUpdatingId, setEmailUpdatingId] = useState<string | null>(null);
  const [draftUpdatingId, setDraftUpdatingId] = useState<string | null>(null);
  const [profileUpdatingId, setProfileUpdatingId] = useState<string | null>(null);
  const [regeneratingDraftId, setRegeneratingDraftId] = useState<string | null>(
    null
  );

  const setOutreachEmailed = useCallback(
    async (leadId: string, emailed: boolean) => {
      setUpdatingId(leadId);
      try {
        const callable = httpsCallable(functions, "setOpticLeadOutreachStatus");
        await callable({ leadId, emailed });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not update outreach status.";
        toast({ variant: "destructive", title: "Vault", description: message });
      } finally {
        setUpdatingId(null);
      }
    },
    [toast]
  );

  const setLeadCrm = useCallback(
    async (leadId: string, patch: OpticLeadCrmPatch) => {
      setUpdatingId(leadId);
      try {
        const callable = httpsCallable(functions, "setOpticLeadCrm");
        await callable({ leadId, ...patch });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not update vault CRM.";
        toast({ variant: "destructive", title: "Vault", description: message });
      } finally {
        setUpdatingId(null);
      }
    },
    [toast]
  );

  const setLeadEmail = useCallback(
    async (leadId: string, email: string) => {
      setEmailUpdatingId(leadId);
      try {
        const callable = httpsCallable(functions, "setOpticLeadEmail");
        await callable({ leadId, email });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not save email.";
        toast({ variant: "destructive", title: "Vault", description: message });
      } finally {
        setEmailUpdatingId(null);
      }
    },
    [toast]
  );

  const setLeadProfile = useCallback(
    async (leadId: string, patch: OpticLeadProfilePatch): Promise<boolean> => {
      setProfileUpdatingId(leadId);
      try {
        const callable = httpsCallable(functions, "updateOpticLeadProfile");
        await callable({ leadId, ...patch });
        return true;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not save creator details.";
        toast({ variant: "destructive", title: "Vault", description: message });
        return false;
      } finally {
        setProfileUpdatingId(null);
      }
    },
    [toast]
  );

  const setLeadDraft = useCallback(
    async (leadId: string, patch: OpticLeadDraftPatch): Promise<boolean> => {
      setDraftUpdatingId(leadId);
      try {
        const callable = httpsCallable(functions, "setOpticLeadOutreachDraft");
        await callable({ leadId, ...patch });
        return true;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not save the draft.";
        toast({ variant: "destructive", title: "Outreach", description: message });
        return false;
      } finally {
        setDraftUpdatingId(null);
      }
    },
    [toast]
  );

  const regenerateLeadDraft = useCallback(
    async (leadId: string): Promise<boolean> => {
      setRegeneratingDraftId(leadId);
      try {
        const callable = httpsCallable(functions, "regenerateOpticLeadDraft");
        await callable({ leadId });
        toast({
          title: "Outreach",
          description: "Email draft regenerated from the latest contact info.",
        });
        return true;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not regenerate the draft.";
        toast({
          variant: "destructive",
          title: "Outreach",
          description: message,
        });
        return false;
      } finally {
        setRegeneratingDraftId(null);
      }
    },
    [toast]
  );

  return {
    updatingId,
    emailUpdatingId,
    draftUpdatingId,
    profileUpdatingId,
    regeneratingDraftId,
    setOutreachEmailed,
    setLeadCrm,
    setLeadEmail,
    setLeadProfile,
    setLeadDraft,
    regenerateLeadDraft,
  };
}

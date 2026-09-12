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

export function useOpticLeadOutreach() {
  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [emailUpdatingId, setEmailUpdatingId] = useState<string | null>(null);
  const [draftUpdatingId, setDraftUpdatingId] = useState<string | null>(null);

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

  return {
    updatingId,
    emailUpdatingId,
    draftUpdatingId,
    setOutreachEmailed,
    setLeadCrm,
    setLeadEmail,
    setLeadDraft,
  };
}

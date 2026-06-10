"use client";

import { useCallback, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

export function useOpticLeadOutreach() {
  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [emailUpdatingId, setEmailUpdatingId] = useState<string | null>(null);

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

  return { updatingId, emailUpdatingId, setOutreachEmailed, setLeadEmail };
}

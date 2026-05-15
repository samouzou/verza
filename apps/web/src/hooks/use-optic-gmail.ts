"use client";

import { useCallback, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

export function useOpticGmail(opts: {
  connected: boolean;
  email: string | null;
}) {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [draftingLeadId, setDraftingLeadId] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const begin = httpsCallable(functions, "beginGmailConnect");
      const res = await begin();
      const url = (res.data as { url?: string }).url;
      if (!url) {
        throw new Error("No authorization URL returned.");
      }
      window.location.href = url;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start Gmail connection.";
      toast({ variant: "destructive", title: "Gmail", description: message });
      setConnecting(false);
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const callable = httpsCallable(functions, "disconnectGmail");
      await callable();
      toast({ title: "Gmail disconnected" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not disconnect Gmail.";
      toast({ variant: "destructive", title: "Gmail", description: message });
    } finally {
      setDisconnecting(false);
    }
  }, [toast]);

  const createDraft = useCallback(
    async (leadId: string) => {
      if (!opts.connected) {
        toast({
          variant: "destructive",
          title: "Connect Gmail first",
          description: "Link Gmail on the discovery page to save drafts in your inbox.",
        });
        return;
      }
      setDraftingLeadId(leadId);
      try {
        const callable = httpsCallable(functions, "createOpticGmailDraft");
        const res = await callable({ leadId });
        const data = res.data as { to?: string };
        toast({
          title: "Draft saved in Gmail",
          description: data.to
            ? `Open Gmail to review the draft to ${data.to}.`
            : "Open Gmail to review your new draft.",
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not create a Gmail draft.";
        toast({ variant: "destructive", title: "Gmail draft", description: message });
      } finally {
        setDraftingLeadId(null);
      }
    },
    [opts.connected, toast]
  );

  return {
    connected: opts.connected,
    email: opts.email,
    connecting,
    disconnecting,
    draftingLeadId,
    connect,
    disconnect,
    createDraft,
  };
}

"use client";

import { useCallback, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

export type OpticGmailThreadMessage = {
  id: string;
  from: string;
  fromEmail: string;
  date: string | null;
  snippet: string;
  body: string;
  direction: "outbound" | "inbound";
};

export function useOpticGmail(opts: {
  connected: boolean;
  email: string | null;
}) {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [draftingLeadId, setDraftingLeadId] = useState<string | null>(null);
  const [sendingLeadId, setSendingLeadId] = useState<string | null>(null);
  const [linkingLeadId, setLinkingLeadId] = useState<string | null>(null);
  const [threadLeadId, setThreadLeadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<OpticGmailThreadMessage[]>([]);
  const [threadReplyCount, setThreadReplyCount] = useState(0);
  const [threadLoadingId, setThreadLoadingId] = useState<string | null>(null);

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
          description: "Connect Gmail on this page to draft or send from your address.",
        });
        return;
      }
      setDraftingLeadId(leadId);
      try {
        const callable = httpsCallable(functions, "createOpticGmailDraft");
        const res = await callable({ leadId });
        const data = res.data as { to?: string };
        toast({
          title: "Sent to Gmail drafts",
          description: data.to
            ? `Open Gmail → Drafts, review, and send when ready — To: ${data.to}.`
            : "Open Gmail → Drafts to review and send when you're ready.",
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not create a Gmail draft.";
        toast({ variant: "destructive", title: "Gmail drafts", description: message });
      } finally {
        setDraftingLeadId(null);
      }
    },
    [opts.connected, toast]
  );

  const sendMessage = useCallback(
    async (leadId: string) => {
      if (!opts.connected) {
        toast({
          variant: "destructive",
          title: "Connect Gmail first",
          description: "Connect Gmail on this page to send from your address.",
        });
        return;
      }
      setSendingLeadId(leadId);
      try {
        const callable = httpsCallable(functions, "sendOpticGmailMessage");
        const res = await callable({ leadId });
        const data = res.data as { to?: string; followUp?: boolean };
        toast({
          title: data.followUp ? "Follow-up sent" : "Email sent",
          description: data.to
            ? `Sent from your Gmail to ${data.to}.`
            : "Sent from your connected Gmail.",
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not send the email.";
        toast({ variant: "destructive", title: "Send", description: message });
      } finally {
        setSendingLeadId(null);
      }
    },
    [opts.connected, toast]
  );

  const loadThread = useCallback(
    async (leadId: string) => {
      if (!opts.connected) return;
      setThreadLoadingId(leadId);
      try {
        const callable = httpsCallable(functions, "getOpticGmailThread");
        const res = await callable({ leadId });
        const data = res.data as {
          messages?: OpticGmailThreadMessage[];
          replyCount?: number;
        };
        setThreadLeadId(leadId);
        setThreadMessages(Array.isArray(data.messages) ? data.messages : []);
        setThreadReplyCount(
          typeof data.replyCount === "number" ? data.replyCount : 0
        );
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not load the Gmail thread.";
        toast({ variant: "destructive", title: "Thread", description: message });
      } finally {
        setThreadLoadingId(null);
      }
    },
    [opts.connected, toast]
  );

  const linkThread = useCallback(
    async (leadId: string) => {
      if (!opts.connected) {
        toast({
          variant: "destructive",
          title: "Connect Gmail first",
          description: "Connect Gmail with inbox read to find past threads.",
        });
        return false;
      }
      setLinkingLeadId(leadId);
      try {
        const callable = httpsCallable(functions, "linkOpticGmailThread");
        const res = await callable({ leadId });
        const data = res.data as {
          messages?: OpticGmailThreadMessage[];
          replyCount?: number;
          source?: string;
        };
        setThreadLeadId(leadId);
        setThreadMessages(Array.isArray(data.messages) ? data.messages : []);
        setThreadReplyCount(
          typeof data.replyCount === "number" ? data.replyCount : 0
        );
        toast({
          title: "Gmail thread linked",
          description:
            data.source === "existing"
              ? "This lead was already linked — replies refreshed."
              : "Found the conversation in your inbox and loaded replies.",
        });
        return true;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not find a Gmail thread.";
        toast({ variant: "destructive", title: "Find in Gmail", description: message });
        return false;
      } finally {
        setLinkingLeadId(null);
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
    sendingLeadId,
    connect,
    disconnect,
    createDraft,
    sendMessage,
    loadThread,
    linkThread,
    linkingLeadId,
    threadLeadId,
    threadMessages,
    threadReplyCount,
    threadLoadingId,
  };
}

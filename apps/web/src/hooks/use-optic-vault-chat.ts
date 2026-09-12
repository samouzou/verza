"use client";

import { useCallback, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import type { OpticLeadResponse, OpticLeadStage, OpticPassReason } from "@verza/types";

export type VaultChatSnapshot = {
  scopeLabel: string;
  leadCount: number;
  truncated: boolean;
  stages: Record<OpticLeadStage, number>;
  responses: Record<OpticLeadResponse, number>;
  passReasons: Record<OpticPassReason, number>;
  last7dContacts: number;
  neverTouched: number;
  hasEmail: number;
  reachedOut: number;
  inProgress: number;
};

export type VaultChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export function useOpticVaultChat() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<VaultChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [snapshot, setSnapshot] = useState<VaultChatSnapshot | null>(null);

  const ask = useCallback(
    async (question: string, campaignFilter: string, campaignTitle?: string) => {
      const trimmed = question.trim();
      if (!trimmed || asking) return;
      const userMsg: VaultChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setAsking(true);
      try {
        const callable = httpsCallable(functions, "askOpticVaultChat");
        const res = await callable({
          question: trimmed,
          campaignFilter,
          campaignTitle: campaignTitle ?? null,
        });
        const data = res.data as { answer?: unknown; snapshot?: VaultChatSnapshot };
        const answer =
          typeof data.answer === "string" ? data.answer.trim() : "";
        if (data.snapshot) setSnapshot(data.snapshot);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: answer || "No answer came back.",
          },
        ]);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Could not ask the vault.";
        toast({ variant: "destructive", title: "Ask the vault", description: message });
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            text: "I couldn’t read the vault just now. Try again in a moment.",
          },
        ]);
      } finally {
        setAsking(false);
      }
    },
    [asking, toast]
  );

  const clear = useCallback(() => {
    setMessages([]);
    setSnapshot(null);
  }, []);

  return { messages, asking, snapshot, ask, clear };
}

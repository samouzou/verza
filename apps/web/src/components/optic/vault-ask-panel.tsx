"use client";

import { useMemo, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { VaultChatMessage, VaultChatSnapshot } from "@/hooks/use-optic-vault-chat";
import { cn } from "@/lib/utils";

const CHIPS = [
  "How is this campaign doing?",
  "How many have we reached out to?",
  "What's blocking us?",
  "Who still needs a first touch?",
] as const;

function scopeCopy(campaignFilter: string, campaignTitle?: string): string {
  if (campaignFilter === "__all__") return "All vault leads";
  if (campaignFilter === "__pooled__") return "Pooled missions";
  return campaignTitle?.trim() || "This campaign";
}

export type VaultAskPanelProps = {
  campaignFilter: string;
  campaignTitle?: string;
  leadCount: number;
  messages: VaultChatMessage[];
  asking: boolean;
  snapshot: VaultChatSnapshot | null;
  onAsk: (question: string) => void;
  disabled?: boolean;
};

export function VaultAskPanel({
  campaignFilter,
  campaignTitle,
  leadCount,
  messages,
  asking,
  snapshot,
  onAsk,
  disabled,
}: VaultAskPanelProps) {
  const [draft, setDraft] = useState("");
  const view = scopeCopy(campaignFilter, campaignTitle);
  const counts = snapshot ?? null;

  const stats = useMemo(() => {
    if (!counts) {
      return [
        { label: "In view", value: leadCount },
      ];
    }
    return [
      { label: "In view", value: counts.leadCount },
      { label: "Reached out", value: counts.reachedOut },
      { label: "In play", value: counts.inProgress },
      { label: "Booked", value: counts.stages.booked },
      { label: "Passed", value: counts.stages.passed },
    ];
  }, [counts, leadCount]);

  const submit = (text: string) => {
    const q = text.trim();
    if (!q || asking || disabled) return;
    setDraft("");
    onAsk(q);
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Ask the vault</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Answering from {view} (campaign scope below)
              {leadCount >= 0 ? ` · ${leadCount} creator${leadCount === 1 ? "" : "s"}` : ""}
              {counts?.truncated ? " · latest 500 only" : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {stats.map((s) => (
            <span
              key={s.label}
              className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
            >
              <span className="tabular-nums font-semibold">{s.value}</span>
              <span className="text-muted-foreground">{s.label}</span>
            </span>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {CHIPS.map((chip) => (
            <Button
              key={chip}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={asking || disabled}
              onClick={() => submit(chip)}
            >
              {chip}
            </Button>
          ))}
        </div>

        {messages.length > 0 && (
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "text-sm leading-relaxed",
                  m.role === "user"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {m.role === "user" ? "You" : "Vault"}
                </p>
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            ))}
            {asking && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Counting the vault…
              </p>
            )}
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="How many are in conversation? Why are we passing?"
            disabled={asking || disabled}
            maxLength={500}
          />
          <Button
            type="submit"
            size="icon"
            disabled={asking || disabled || !draft.trim()}
            aria-label="Ask"
          >
            {asking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

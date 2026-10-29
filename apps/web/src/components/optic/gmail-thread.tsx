"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OpticGmailThreadMessage } from "@/hooks/use-optic-gmail";
import { splitQuotedReply } from "@/lib/optic/split-quoted-reply";
import { cn } from "@/lib/utils";

function QuotedToggle({ quoted }: { quoted: string }) {
  const [open, setOpen] = useState(false);
  if (!quoted) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Hide earlier messages" : "Earlier messages"}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded-full border border-border bg-background px-1.5 text-[11px] leading-none tracking-[0.2em] text-muted-foreground hover:bg-muted"
      >
        ···
      </button>
      {open && (
        <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-2 text-muted-foreground">
          {quoted}
        </p>
      )}
    </div>
  );
}

export function GmailThread({
  messages,
  replyCount,
  loading,
  onRefresh,
  canRead,
  readOnly,
  syncedByEmail,
  onReconnect,
}: {
  messages: OpticGmailThreadMessage[];
  replyCount: number;
  loading?: boolean;
  onRefresh?: () => void;
  canRead?: boolean;
  /** Shared team snapshot — view only, no live inbox refresh. */
  readOnly?: boolean;
  syncedByEmail?: string | null;
  onReconnect?: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const showMessages = messages.length > 0 || readOnly || canRead;

  useEffect(() => {
    const el = listRef.current;
    if (!el || messages.length === 0) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!showMessages && !canRead && !readOnly) {
    return (
      <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
        <p className="text-sm text-muted-foreground">
          Reconnect Gmail and allow inbox read to see replies on this thread.
        </p>
        {onReconnect && (
          <Button type="button" size="sm" variant="outline" onClick={onReconnect}>
            Reconnect Gmail
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            {replyCount === 0
              ? "No replies yet"
              : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
            {readOnly ? " · Team view (read-only)" : ""}
          </p>
          {readOnly && syncedByEmail && (
            <p className="text-[11px] text-muted-foreground">
              Synced from {syncedByEmail}. A teammate with that inbox can refresh for
              newer replies.
            </p>
          )}
        </div>
        {onRefresh && !readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">Refresh</span>
          </Button>
        )}
      </div>
      {loading && messages.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading thread…
        </p>
      ) : messages.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {readOnly
            ? "No shared messages yet. Ask a teammate with Gmail connected to open this thread once."
            : "No messages in this thread yet."}
        </p>
      ) : (
        <div ref={listRef} className="max-h-72 space-y-2 overflow-y-auto">
          {messages.map((m) => {
            const split = m.quoted
              ? { visible: m.body || m.snippet, quoted: m.quoted }
              : splitQuotedReply(m.body || m.snippet || "");
            return (
              <div
                key={m.id}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs leading-relaxed",
                  m.direction === "outbound"
                    ? "border-primary/20 bg-primary/[0.04]"
                    : "border-border bg-muted/40"
                )}
              >
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {m.direction === "outbound"
                      ? readOnly
                        ? m.from || "Team"
                        : "You"
                      : m.from}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {m.date
                      ? formatDistanceToNow(new Date(m.date), { addSuffix: true })
                      : ""}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-foreground/90">
                  {split.visible || m.snippet}
                </p>
                <QuotedToggle quoted={split.quoted} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

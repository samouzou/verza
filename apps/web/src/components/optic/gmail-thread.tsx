"use client";

import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OpticGmailThreadMessage } from "@/hooks/use-optic-gmail";
import { cn } from "@/lib/utils";

export function GmailThread({
  messages,
  replyCount,
  loading,
  onRefresh,
  canRead,
  onReconnect,
}: {
  messages: OpticGmailThreadMessage[];
  replyCount: number;
  loading?: boolean;
  onRefresh?: () => void;
  canRead?: boolean;
  onReconnect?: () => void;
}) {
  if (!canRead) {
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
        <p className="text-xs text-muted-foreground">
          {replyCount === 0
            ? "No replies yet"
            : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
        </p>
        {onRefresh && (
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
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {messages.map((m) => (
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
                  {m.direction === "outbound" ? "You" : m.from}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {m.date
                    ? formatDistanceToNow(new Date(m.date), { addSuffix: true })
                    : ""}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-foreground/90">
                {m.body || m.snippet}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

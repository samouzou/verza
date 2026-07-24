"use client";

import { Mail, MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { draftParagraphs, type LeadOutreachDraft } from "@/lib/optic/outreach-draft";

type Props = {
  draft: LeadOutreachDraft;
  compact?: boolean;
  className?: string;
};

export function OutreachDraftCard({ draft, compact, className }: Props) {
  const paragraphs = draftParagraphs(draft.body);
  const isEmail = draft.channel === "email";

  return (
    <div
      className={cn(
        "rounded-lg border text-left",
        isEmail
          ? "border-primary/20 bg-primary/[0.04]"
          : "border-teal-500/25 bg-teal-500/[0.06] dark:bg-teal-500/10",
        compact ? "p-2.5 space-y-1.5" : "p-3 space-y-2",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="secondary"
          className={cn(
            "gap-1 text-[10px] font-medium uppercase tracking-wide",
            isEmail ? "bg-primary/10 text-primary" : "bg-teal-500/15 text-teal-600 dark:text-teal-400"
          )}
        >
          {isEmail ? (
            <Mail className="h-3 w-3" aria-hidden />
          ) : (
            <MessageCircle className="h-3 w-3" aria-hidden />
          )}
          {isEmail ? "Email" : `${draft.platformLabel} DM`}
        </Badge>
        {!isEmail && (
          <span className="text-[10px] text-muted-foreground">Copy into {draft.platformLabel}</span>
        )}
      </div>

      {isEmail && draft.subject && (
        <p
          className={cn(
            "font-medium text-foreground border-b border-border/60 pb-1.5",
            compact ? "text-[11px]" : "text-xs"
          )}
        >
          <span className="text-muted-foreground font-normal">Subject · </span>
          {draft.subject}
        </p>
      )}

      <div className={cn("space-y-1.5", compact && "max-h-[7.5rem] overflow-y-auto pr-0.5")}>
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className={cn(
              "leading-relaxed text-foreground/90",
              compact ? "text-[11px]" : "text-xs"
            )}
          >
            {para}
          </p>
        ))}
      </div>
    </div>
  );
}

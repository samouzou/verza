"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Check,
  Copy,
  ExternalLink,
  Flame,
  Loader2,
  Send,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OutreachDraftCard } from "@/components/optic/outreach-draft-card";
import {
  leadInitials,
  matchBand,
  matchBandClasses,
  matchBandLabel,
  platformChipClasses,
} from "@/lib/optic/match-score";
import { getLeadOutreachDraft, outreachCopyText } from "@/lib/optic/outreach-draft";
import type { OpticLeadRow } from "@/lib/optic/types";
import { cn } from "@/lib/utils";

function tsToDate(ts: Timestamp | undefined | null): Date | null {
  if (!ts || typeof ts.toDate !== "function") return null;
  try {
    return ts.toDate();
  } catch {
    return null;
  }
}

export type LeadReportSheetProps = {
  lead: OpticLeadRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignLabel: string;
  gmailConnected?: boolean;
  onCreateGmailDraft?: (leadId: string) => void;
  draftingLeadId?: string | null;
  onOutreachToggle?: (leadId: string, emailed: boolean) => void;
  outreachUpdatingId?: string | null;
  onEmailChange?: (leadId: string, email: string) => void;
  emailUpdatingId?: string | null;
};

function BreakdownBar({ label, value }: { label: string; value?: number }) {
  const v =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">{v === null ? "—" : `${v}`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-orange-500/80 transition-all"
          style={{ width: v === null ? "0%" : `${v}%` }}
        />
      </div>
    </div>
  );
}

export function LeadReportSheet({
  lead,
  open,
  onOpenChange,
  campaignLabel,
  gmailConnected,
  onCreateGmailDraft,
  draftingLeadId,
  onOutreachToggle,
  outreachUpdatingId,
  onEmailChange,
  emailUpdatingId,
}: LeadReportSheetProps) {
  const [emailValue, setEmailValue] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEmailValue(lead?.email ?? "");
    setCopied(false);
  }, [lead?.id, lead?.email]);

  if (!lead) return null;

  const band = matchBand(lead.matchScore);
  const outreach = getLeadOutreachDraft(lead);
  const created = tsToDate(lead.createdAt);
  const contacted = Boolean(lead.outreachEmailed);
  const busyOutreach = outreachUpdatingId === lead.id;
  const busyEmail = emailUpdatingId === lead.id;
  const bio = lead.extensionScrape?.bio?.trim() || null;
  const externalUrl = lead.extensionScrape?.externalUrl?.trim() || null;
  const platform = lead.discoveryPlatform ?? "creator";

  const commitEmail = () => {
    if (!onEmailChange) return;
    const trimmed = emailValue.trim();
    const current = (lead.email ?? "").trim();
    if (trimmed !== current) onEmailChange(lead.id, trimmed);
  };

  const copyDraft = () => {
    if (!outreach) return;
    void navigator.clipboard.writeText(outreachCopyText(outreach));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="space-y-4 text-left">
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16 border-2 border-primary/20">
              {lead.avatarUrl ? (
                <AvatarImage
                  src={lead.avatarUrl}
                  alt={lead.creatorName ?? "Creator"}
                />
              ) : null}
              <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                {leadInitials(lead)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-2">
              <SheetTitle className="text-xl leading-tight">
                {lead.creatorName ?? "Unknown creator"}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Creator match report for {lead.creatorName ?? "this lead"}
              </SheetDescription>
              <div className="flex flex-wrap gap-1.5">
                <Badge
                  variant="outline"
                  className={cn("capitalize", platformChipClasses(platform))}
                >
                  {platform}
                </Badge>
                {lead.niche && (
                  <Badge variant="secondary" className="font-normal">
                    {lead.niche}
                  </Badge>
                )}
                {contacted && (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
                    Contacted
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="rounded-xl border bg-gradient-to-br from-orange-500/10 via-background to-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500 fill-orange-500" />
                <span className="text-sm font-medium text-muted-foreground">Match score</span>
              </div>
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
                  matchBandClasses(band)
                )}
              >
                {matchBandLabel(band)}
              </span>
            </div>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-orange-600 dark:text-orange-400">
              {typeof lead.matchScore === "number" ? lead.matchScore : "—"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {lead.matchReason?.trim() ||
                "Match score will appear on new leads from discovery missions."}
            </p>
            {lead.matchBreakdown && (
              <div className="mt-4 grid gap-3">
                <BreakdownBar label="Brief fit" value={lead.matchBreakdown.brief} />
                <BreakdownBar label="Audience" value={lead.matchBreakdown.audience} />
                <BreakdownBar label="Contactability" value={lead.matchBreakdown.contact} />
                <BreakdownBar label="Activity" value={lead.matchBreakdown.activity} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/30 border p-3">
              <p className="text-xs text-muted-foreground">Followers</p>
              <p className="mt-1 font-semibold tabular-nums">
                {lead.followerCount ?? "—"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 border p-3">
              <p className="text-xs text-muted-foreground">Posts</p>
              <p className="mt-1 font-semibold tabular-nums">
                {lead.postCountNumeric ??
                  lead.extensionScrape?.postCount ??
                  "—"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 border p-3 col-span-2">
              <p className="text-xs text-muted-foreground">Campaign</p>
              <p className="mt-1 text-sm font-medium line-clamp-2">{campaignLabel}</p>
            </div>
          </div>

          {(bio || externalUrl || lead.profileUrl) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Profile</h3>
              {bio && (
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {bio}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {lead.profileUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={lead.profileUrl} target="_blank" rel="noreferrer">
                      Open profile
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                {externalUrl && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={externalUrl} target="_blank" rel="noreferrer">
                      Link in bio
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Contact</h3>
            <div className="space-y-2">
              <Label htmlFor="report-email">Email</Label>
              {onEmailChange ? (
                <div className="flex items-center gap-2">
                  <Input
                    id="report-email"
                    type="email"
                    value={emailValue}
                    onChange={(e) => setEmailValue(e.target.value)}
                    onBlur={commitEmail}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="Add email…"
                    disabled={busyEmail}
                  />
                  {busyEmail && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              ) : (
                <p className="text-sm">{lead.email || "—"}</p>
              )}
            </div>
            {onOutreachToggle && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={contacted}
                  disabled={busyOutreach}
                  onCheckedChange={(v) => onOutreachToggle(lead.id, v === true)}
                />
                Mark as contacted
                {busyOutreach && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </label>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Outreach</h3>
              {outreach && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={copyDraft}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">Copy</span>
                  </Button>
                  {onCreateGmailDraft && outreach.channel === "email" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={
                        !gmailConnected ||
                        !lead.email ||
                        draftingLeadId === lead.id
                      }
                      onClick={() => onCreateGmailDraft(lead.id)}
                    >
                      {draftingLeadId === lead.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1.5">To drafts</span>
                    </Button>
                  )}
                </div>
              )}
            </div>
            {outreach ? (
              <OutreachDraftCard draft={outreach} />
            ) : (
              <p className="text-sm text-muted-foreground">No outreach draft for this lead.</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Found{" "}
            {created
              ? formatDistanceToNow(created, { addSuffix: true })
              : "—"}
            {lead.source ? ` · ${lead.source}` : ""}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

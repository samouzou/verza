"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Check,
  Copy,
  ExternalLink,
  Flame,
  Loader2,
  Mail,
  RefreshCw,
  Send,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { GmailThread } from "@/components/optic/gmail-thread";
import { OutreachDraftCard } from "@/components/optic/outreach-draft-card";
import { OutreachEmailEditor } from "@/components/optic/outreach-email-editor";
import type { OpticGmailThreadMessage } from "@/hooks/use-optic-gmail";
import { Textarea } from "@/components/ui/textarea";
import type {
  OpticLeadCrmPatch,
  OpticLeadDraftPatch,
  OpticLeadProfilePatch,
} from "@/hooks/use-optic-lead-outreach";
import {
  OPTIC_LEAD_RESPONSE_LABELS,
  OPTIC_LEAD_RESPONSES,
  OPTIC_LEAD_STAGE_LABELS,
  OPTIC_LEAD_STAGES,
  OPTIC_PASS_REASON_LABELS,
  OPTIC_PASS_REASONS,
  passReasonLabel,
  resolveLastContactedAt,
  resolveLeadStage,
  stageBadgeClasses,
} from "@/lib/optic/crm";
import {
  leadInitials,
  matchBand,
  matchBandClasses,
  matchBandLabel,
  platformChipClasses,
} from "@/lib/optic/match-score";
import {
  emailBodyForEditor,
  getLeadOutreachDraft,
  isEmailDraftEmpty,
  normalizeEmailHtml,
  outreachCopyText,
} from "@/lib/optic/outreach-draft";
import { OPTIC_PLATFORMS } from "@/lib/optic/platforms";
import type { OpticLeadRow } from "@/lib/optic/types";
import { cn } from "@/lib/utils";
import type { OpticLeadResponse, OpticLeadStage, OpticPassReason } from "@verza/types";

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
  onSendGmail?: (leadId: string) => void;
  sendingLeadId?: string | null;
  gmailCanRead?: boolean;
  onReconnectGmail?: () => void;
  onLoadThread?: (leadId: string) => void;
  onLinkThread?: (leadId: string) => void;
  linkingLeadId?: string | null;
  threadLeadId?: string | null;
  threadMessages?: OpticGmailThreadMessage[];
  threadReplyCount?: number;
  threadLoading?: boolean;
  threadReadOnly?: boolean;
  threadSyncedByEmail?: string | null;
  outreachUpdatingId?: string | null;
  onCrmChange?: (leadId: string, patch: OpticLeadCrmPatch) => void;
  onEmailChange?: (leadId: string, email: string) => void;
  emailUpdatingId?: string | null;
  onProfileChange?: (
    leadId: string,
    patch: OpticLeadProfilePatch
  ) => Promise<boolean>;
  profileUpdatingId?: string | null;
  onDraftChange?: (leadId: string, patch: OpticLeadDraftPatch) => Promise<boolean>;
  draftUpdatingId?: string | null;
  onRegenerateDraft?: (leadId: string) => Promise<boolean>;
  regeneratingDraftId?: string | null;
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
  onSendGmail,
  sendingLeadId,
  gmailCanRead,
  onReconnectGmail,
  onLoadThread,
  onLinkThread,
  linkingLeadId,
  threadLeadId,
  threadMessages,
  threadReplyCount,
  threadLoading,
  threadReadOnly,
  threadSyncedByEmail,
  outreachUpdatingId,
  onCrmChange,
  onEmailChange,
  emailUpdatingId,
  onProfileChange,
  profileUpdatingId,
  onDraftChange,
  draftUpdatingId,
  onRegenerateDraft,
  regeneratingDraftId,
}: LeadReportSheetProps) {
  const [emailValue, setEmailValue] = useState("");
  const [noteValue, setNoteValue] = useState("");
  const [subjectValue, setSubjectValue] = useState("");
  const [bodyValue, setBodyValue] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [nicheValue, setNicheValue] = useState("");
  const [bioValue, setBioValue] = useState("");
  const [followersValue, setFollowersValue] = useState("");
  const [externalUrlValue, setExternalUrlValue] = useState("");
  const [matchReasonValue, setMatchReasonValue] = useState("");
  const [platformValue, setPlatformValue] = useState("instagram");
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  useEffect(() => {
    setEmailValue(lead?.email ?? "");
    setNoteValue(lead?.crmNote ?? "");
    setSubjectValue(lead?.draftEmailSubject ?? "");
    const emailBody = lead?.draftEmail?.trim() ?? "";
    const dmBody = lead?.draftDm ?? "";
    setBodyValue(emailBody ? emailBodyForEditor(emailBody) : dmBody);
    setNameValue(lead?.creatorName ?? "");
    setNicheValue(lead?.niche ?? "");
    setBioValue(
      lead?.extensionScrape?.bio?.trim() || lead?.agentScrape?.bio?.trim() || ""
    );
    setFollowersValue(lead?.followerCount ?? "");
    setExternalUrlValue(
      lead?.extensionScrape?.externalUrl?.trim() ||
        lead?.agentScrape?.externalUrl?.trim() ||
        ""
    );
    setMatchReasonValue(lead?.matchReason ?? "");
    setPlatformValue(lead?.discoveryPlatform ?? "instagram");
    setCopied(false);
  }, [
    lead?.id,
    lead?.email,
    lead?.crmNote,
    lead?.draftEmail,
    lead?.draftEmailSubject,
    lead?.draftDm,
    lead?.creatorName,
    lead?.niche,
    lead?.followerCount,
    lead?.matchReason,
    lead?.discoveryPlatform,
    lead?.extensionScrape?.bio,
    lead?.extensionScrape?.externalUrl,
    lead?.agentScrape?.bio,
    lead?.agentScrape?.externalUrl,
  ]);

  useEffect(() => {
    if (!open || !lead?.id || !lead.gmailThreadId || !onLoadThread) {
      return;
    }
    onLoadThread(lead.id);
  }, [open, lead?.id, lead?.gmailThreadId, onLoadThread]);

  if (!lead) return null;

  const band = matchBand(lead.matchScore);
  const outreach = getLeadOutreachDraft(lead);
  const created = tsToDate(lead.createdAt);
  const lastContact = tsToDate(resolveLastContactedAt(lead));
  const stage = resolveLeadStage(lead);
  const busyCrm = outreachUpdatingId === lead.id;
  const busyEmail = emailUpdatingId === lead.id;
  const busyDraft = draftUpdatingId === lead.id;
  const busyRegen = regeneratingDraftId === lead.id;
  const busyProfile = profileUpdatingId === lead.id;
  const canRegenerateEmailDraft = Boolean(
    onRegenerateDraft && lead.email?.trim()
  );
  const bio =
    lead.extensionScrape?.bio?.trim() ||
    lead.agentScrape?.bio?.trim() ||
    null;
  const externalUrl =
    lead.extensionScrape?.externalUrl?.trim() ||
    lead.agentScrape?.externalUrl?.trim() ||
    null;
  const platform = lead.discoveryPlatform ?? "creator";

  const savedName = (lead.creatorName ?? "").trim();
  const savedNiche = (lead.niche ?? "").trim();
  const savedBio = (bio ?? "").trim();
  const savedFollowers = (lead.followerCount ?? "").trim();
  const savedExternal = (externalUrl ?? "").trim();
  const savedMatchReason = (lead.matchReason ?? "").trim();
  const savedPlatform = lead.discoveryPlatform ?? "instagram";
  const profileDirty =
    nameValue.trim() !== savedName ||
    nicheValue.trim() !== savedNiche ||
    bioValue.trim() !== savedBio ||
    followersValue.trim() !== savedFollowers ||
    externalUrlValue.trim() !== savedExternal ||
    matchReasonValue.trim() !== savedMatchReason ||
    platformValue !== savedPlatform;
  const draftChannel =
    outreach?.channel ??
    (lead.email?.trim() || lead.draftEmail?.trim() ? "email" : "dm");
  const savedBody =
    draftChannel === "email" ? (lead.draftEmail ?? "") : (lead.draftDm ?? "");
  const savedSubject = lead.draftEmailSubject ?? "";
  const savedEditorBody =
    draftChannel === "email" ? emailBodyForEditor(savedBody) : savedBody;
  const bodyDirty =
    draftChannel === "email"
      ? normalizeEmailHtml(bodyValue) !== normalizeEmailHtml(savedEditorBody)
      : bodyValue.trim() !== savedBody.trim();
  const draftDirty =
    bodyDirty ||
    (draftChannel === "email" && subjectValue.trim() !== savedSubject.trim());
  const hasBody =
    draftChannel === "email" ? !isEmailDraftEmpty(bodyValue) : Boolean(bodyValue.trim());
  const localDraft = hasBody
    ? {
        channel: draftChannel,
        subject: draftChannel === "email" ? subjectValue.trim() || undefined : undefined,
        body: bodyValue,
        platformLabel: outreach?.platformLabel ?? platform,
      }
    : outreach;

  const commitEmail = () => {
    if (!onEmailChange) return;
    const trimmed = emailValue.trim();
    const current = (lead.email ?? "").trim();
    if (trimmed !== current) onEmailChange(lead.id, trimmed);
  };

  const persistProfile = async (): Promise<boolean> => {
    if (!onProfileChange || !profileDirty) return true;
    if (!nameValue.trim()) return false;
    return onProfileChange(lead.id, {
      creatorName: nameValue.trim(),
      niche: nicheValue.trim() || null,
      bio: bioValue.trim() || null,
      followerCount: followersValue.trim() || null,
      externalUrl: externalUrlValue.trim() || null,
      matchReason: matchReasonValue.trim() || null,
      discoveryPlatform: platformValue,
    });
  };

  const persistDraft = async (): Promise<boolean> => {
    if (!onDraftChange) return true;
    if (!draftDirty) return true;
    if (!hasBody) return false;
    if (draftChannel === "email") {
      return onDraftChange(lead.id, {
        draftEmail: bodyValue,
        draftEmailSubject: subjectValue.trim() || null,
      });
    }
    return onDraftChange(lead.id, { draftDm: bodyValue });
  };

  const copyDraft = () => {
    if (!localDraft) return;
    void navigator.clipboard.writeText(outreachCopyText(localDraft));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const flushThen = async (fn: () => void) => {
    const ok = await persistDraft();
    if (ok) fn();
  };

  const restorePointerEvents = () => {
    document.body.style.removeProperty("pointer-events");
  };

  return (
    <>
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && sendOpen) return;
        if (!next) restorePointerEvents();
        onOpenChange(next);
      }}
    >
      <SheetContent
        className="w-full sm:max-w-lg overflow-y-auto"
        onPointerDownOutside={(e) => {
          if (sendOpen) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (sendOpen) e.preventDefault();
        }}
        onFocusOutside={(e) => {
          if (sendOpen) e.preventDefault();
        }}
      >
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
                <Badge
                  variant="outline"
                  className={cn("font-medium", stageBadgeClasses(stage))}
                >
                  {OPTIC_LEAD_STAGE_LABELS[stage]}
                </Badge>
                {stage === "passed" && lead.passReason && (
                  <Badge variant="secondary" className="font-normal">
                    {passReasonLabel(lead.passReason)}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {onCrmChange && (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Pipeline</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={busyCrm}
                  onClick={() => onCrmChange(lead.id, { touchLastContacted: true })}
                >
                  Log contact
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Stage</Label>
                  <Select
                    value={stage}
                    disabled={busyCrm}
                    onValueChange={(value) =>
                      onCrmChange(lead.id, {
                        pipelineStage: value as OpticLeadStage,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPTIC_LEAD_STAGES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {OPTIC_LEAD_STAGE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Reply</Label>
                  <Select
                    value={lead.outreachResponse ?? "__none__"}
                    disabled={busyCrm}
                    onValueChange={(value) =>
                      onCrmChange(lead.id, {
                        outreachResponse:
                          value === "__none__"
                            ? null
                            : (value as OpticLeadResponse),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No reply yet" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No reply yet</SelectItem>
                      {OPTIC_LEAD_RESPONSES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {OPTIC_LEAD_RESPONSE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {stage === "passed" && (
                <div className="space-y-1.5">
                  <Label>Pass reason</Label>
                  <Select
                    value={lead.passReason ?? "__none__"}
                    disabled={busyCrm}
                    onValueChange={(value) =>
                      onCrmChange(lead.id, {
                        pipelineStage: "passed",
                        passReason:
                          value === "__none__"
                            ? null
                            : (value as OpticPassReason),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Why they passed" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Choose a reason</SelectItem>
                      {OPTIC_PASS_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {OPTIC_PASS_REASON_LABELS[reason]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="crm-note">Note</Label>
                <Textarea
                  id="crm-note"
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  onBlur={() => {
                    const trimmed = noteValue.trim();
                    if (trimmed !== (lead.crmNote ?? "").trim()) {
                      onCrmChange(lead.id, { crmNote: trimmed || null });
                    }
                  }}
                  placeholder="Rate, usage, manager, next step…"
                  disabled={busyCrm}
                  className="min-h-[72px]"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Last contacted{" "}
                {lastContact
                  ? formatDistanceToNow(lastContact, { addSuffix: true })
                  : "—"}
                {busyCrm && (
                  <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />
                )}
              </p>
            </div>
          )}

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

          {(onProfileChange || bio || externalUrl || lead.profileUrl) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Profile</h3>
                {onProfileChange && profileDirty && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8"
                    disabled={busyProfile || !nameValue.trim()}
                    onClick={() => void persistProfile()}
                  >
                    {busyProfile ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">Save</span>
                  </Button>
                )}
              </div>
              {onProfileChange ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="report-name">Name</Label>
                      <Input
                        id="report-name"
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        disabled={busyProfile}
                        placeholder="Creator name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Platform</Label>
                      <Select
                        value={platformValue}
                        onValueChange={setPlatformValue}
                        disabled={busyProfile}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPTIC_PLATFORMS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="report-niche">Niche</Label>
                      <Input
                        id="report-niche"
                        value={nicheValue}
                        onChange={(e) => setNicheValue(e.target.value)}
                        disabled={busyProfile}
                        placeholder="Beauty, tech…"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="report-followers">Followers</Label>
                      <Input
                        id="report-followers"
                        value={followersValue}
                        onChange={(e) => setFollowersValue(e.target.value)}
                        disabled={busyProfile}
                        placeholder="12.4K"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="report-external">Link in bio</Label>
                      <Input
                        id="report-external"
                        value={externalUrlValue}
                        onChange={(e) => setExternalUrlValue(e.target.value)}
                        disabled={busyProfile}
                        placeholder="https://…"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="report-bio">Bio / notes</Label>
                    <Textarea
                      id="report-bio"
                      value={bioValue}
                      onChange={(e) => setBioValue(e.target.value)}
                      disabled={busyProfile}
                      placeholder="Bio or notes about this creator…"
                      className="min-h-[80px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="report-match-reason">Match note</Label>
                    <Input
                      id="report-match-reason"
                      value={matchReasonValue}
                      onChange={(e) => setMatchReasonValue(e.target.value)}
                      disabled={busyProfile}
                      placeholder="Why they fit"
                    />
                  </div>
                  {profileDirty && (
                    <p className="text-xs text-muted-foreground">
                      Unsaved profile edits — Save to update the vault
                      {followersValue.trim() !== savedFollowers ||
                      externalUrlValue.trim() !== savedExternal
                        ? " (match score may update)."
                        : "."}
                    </p>
                  )}
                </div>
              ) : (
                bio && (
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {bio}
                  </p>
                )
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
                {(onProfileChange ? externalUrlValue.trim() : externalUrl) && (
                  <Button variant="ghost" size="sm" asChild>
                    <a
                      href={
                        onProfileChange
                          ? externalUrlValue.trim()
                          : (externalUrl as string)
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
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
              {lead.email?.trim() &&
                !lead.draftEmail?.trim() &&
                canRegenerateEmailDraft && (
                  <p className="text-xs text-muted-foreground">
                    Email saved — generate an email draft below (contactability
                    score updates automatically).
                  </p>
                )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Outreach</h3>
              <div className="flex flex-wrap gap-1">
                {canRegenerateEmailDraft && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={busyRegen || busyDraft || busyEmail}
                    onClick={() => void onRegenerateDraft!(lead.id)}
                  >
                    {busyRegen ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">
                      {lead.draftEmail?.trim() ? "Regenerate" : "Generate email"}
                    </span>
                  </Button>
                )}
                {localDraft && (
                  <>
                  {onDraftChange && draftDirty && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8"
                      disabled={busyDraft || !hasBody}
                      onClick={() => void persistDraft()}
                    >
                      {busyDraft ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1.5">Save</span>
                    </Button>
                  )}
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
                  {onCreateGmailDraft && draftChannel === "email" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={
                        !gmailConnected ||
                        !lead.email ||
                        !hasBody ||
                        draftingLeadId === lead.id ||
                        sendingLeadId === lead.id ||
                        busyDraft
                      }
                      onClick={() => void flushThen(() => onCreateGmailDraft(lead.id))}
                    >
                      {draftingLeadId === lead.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Mail className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1.5">To drafts</span>
                    </Button>
                  )}
                  {onSendGmail && draftChannel === "email" && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={
                        !gmailConnected ||
                        !lead.email ||
                        !hasBody ||
                        sendingLeadId === lead.id ||
                        draftingLeadId === lead.id ||
                        busyDraft
                      }
                      onClick={() => setSendOpen(true)}
                    >
                      {sendingLeadId === lead.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1.5">
                        {lead.gmailThreadId ? "Follow up" : "Send"}
                      </span>
                    </Button>
                  )}
                  </>
                )}
              </div>
            </div>
            {onDraftChange ? (
              <div className="space-y-2">
                {draftChannel === "email" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="outreach-subject">Subject</Label>
                    <Input
                      id="outreach-subject"
                      value={subjectValue}
                      onChange={(e) => setSubjectValue(e.target.value)}
                      maxLength={200}
                      disabled={busyDraft}
                      placeholder="Subject line"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="outreach-body">
                    {draftChannel === "email" ? "Email" : `${platform} DM`}
                  </Label>
                  {draftChannel === "email" ? (
                    <OutreachEmailEditor
                      key={lead.id}
                      value={bodyValue}
                      onChange={setBodyValue}
                      readOnly={busyDraft}
                      placeholder="Edit the note before you send…"
                    />
                  ) : (
                    <Textarea
                      id="outreach-body"
                      value={bodyValue}
                      onChange={(e) => setBodyValue(e.target.value)}
                      maxLength={8000}
                      disabled={busyDraft}
                      placeholder="Edit the DM, then copy into the app…"
                      className="min-h-[180px]"
                    />
                  )}
                </div>
                {draftDirty && (
                  <p className="text-xs text-muted-foreground">
                    Unsaved edits — Save, or Send / To drafts will save first.
                  </p>
                )}
              </div>
            ) : outreach ? (
              <OutreachDraftCard draft={outreach} />
            ) : (
              <p className="text-sm text-muted-foreground">No outreach draft for this lead.</p>
            )}
            {tsToDate(lead.gmailSentAt) && (
              <p className="text-xs text-muted-foreground">
                Last emailed{" "}
                {formatDistanceToNow(tsToDate(lead.gmailSentAt)!, { addSuffix: true })}
              </p>
            )}
            {!lead.gmailThreadId &&
              lead.email &&
              onLinkThread &&
              !(threadLeadId === lead.id && (threadMessages?.length ?? 0) > 0) && (
              <div className="rounded-md border border-dashed p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  No thread linked yet. If you already emailed this creator from this Gmail,
                  we can search your inbox and attach the conversation.
                </p>
                {gmailCanRead ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!gmailConnected || linkingLeadId === lead.id}
                    onClick={() => onLinkThread(lead.id)}
                  >
                    {linkingLeadId === lead.id ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mail className="mr-2 h-3.5 w-3.5" />
                    )}
                    Find in Gmail
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!onReconnectGmail}
                    onClick={() => onReconnectGmail?.()}
                  >
                    Reconnect Gmail to search
                  </Button>
                )}
              </div>
            )}
            {(lead.gmailThreadId ||
              (threadLeadId === lead.id && (threadMessages?.length ?? 0) > 0)) && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Thread</h3>
                <GmailThread
                  messages={threadLeadId === lead.id ? threadMessages ?? [] : []}
                  replyCount={threadLeadId === lead.id ? threadReplyCount ?? 0 : 0}
                  loading={
                    (threadLoading && threadLeadId === lead.id) ||
                    linkingLeadId === lead.id
                  }
                  canRead={gmailCanRead}
                  readOnly={threadLeadId === lead.id ? threadReadOnly : false}
                  syncedByEmail={
                    threadLeadId === lead.id ? threadSyncedByEmail : null
                  }
                  onReconnect={onReconnectGmail}
                  onRefresh={
                    onLoadThread && lead.gmailThreadId && gmailCanRead
                      ? () => onLoadThread(lead.id)
                      : undefined
                  }
                />
              </div>
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
    <AlertDialog
      open={sendOpen}
      onOpenChange={(next) => {
        setSendOpen(next);
        if (!next) restorePointerEvents();
      }}
    >
      <AlertDialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {lead.gmailThreadId ? "Send a follow-up?" : "Send this email?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Sends from your connected Gmail
            {lead.email ? ` to ${lead.email}` : ""}. This uses the compose
            permission you already granted — it will leave your Sent folder.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void flushThen(() => {
                if (onSendGmail) onSendGmail(lead.id);
              });
            }}
          >
            {lead.gmailThreadId ? "Send follow-up" : "Send now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

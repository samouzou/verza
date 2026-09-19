"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Flame,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { LeadReportSheet } from "@/components/optic/lead-report-sheet";
import { AddManualLeadDialog } from "@/components/optic/add-manual-lead-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OpticGmailThreadMessage } from "@/hooks/use-optic-gmail";
import type {
  OpticLeadCrmPatch,
  OpticLeadDraftPatch,
  OpticLeadProfilePatch,
} from "@/hooks/use-optic-lead-outreach";
import type { OpticLeadsPagination } from "@/hooks/use-optic-leads";
import {
  OPTIC_LEAD_STAGE_LABELS,
  OPTIC_LEAD_STAGES,
  resolveLastContactedAt,
  resolveLeadStage,
  responseLabel,
  stageBadgeClasses,
} from "@/lib/optic/crm";
import { downloadLeadsCsv } from "@/lib/optic/csv";
import {
  leadInitials,
  matchBand,
  matchBandClasses,
  matchBandLabel,
  platformChipClasses,
} from "@/lib/optic/match-score";
import type { OpticCampaignOption, OpticLeadRow } from "@/lib/optic/types";
import { cn } from "@/lib/utils";
import type { OpticLeadStage } from "@verza/types";

function tsToDate(ts: Timestamp | undefined | null): Date | null {
  if (!ts || typeof ts.toDate !== "function") return null;
  try {
    return ts.toDate();
  } catch {
    return null;
  }
}

export type LeadVaultProps = {
  leads: OpticLeadRow[];
  loading?: boolean;
  pagination?: OpticLeadsPagination;
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
  campaigns: OpticCampaignOption[];
  campaignsLoading?: boolean;
  campaignFilter: string;
  onCampaignFilterChange: (value: string) => void;
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
  canAddManual?: boolean;
};

type SortMode = "score" | "followers-desc" | "followers-asc";

export function LeadVault({
  leads,
  loading,
  pagination,
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
  campaigns,
  campaignsLoading,
  campaignFilter,
  onCampaignFilterChange,
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
  canAddManual,
}: LeadVaultProps) {
  const [filter, setFilter] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("__all__");
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const byCampaign = leads;

  const staged = useMemo(() => {
    if (stageFilter === "__all__") return byCampaign;
    return byCampaign.filter((l) => resolveLeadStage(l) === stageFilter);
  }, [byCampaign, stageFilter]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return staged;
    return staged.filter((l) => {
      const stage = resolveLeadStage(l);
      const blob = [
        l.creatorName,
        l.profileUrl,
        l.niche,
        l.email,
        l.agencyName,
        l.draftEmail,
        l.followerCount,
        l.campaignTitle,
        l.campaignId,
        l.matchReason,
        typeof l.matchScore === "number" ? String(l.matchScore) : "",
        OPTIC_LEAD_STAGE_LABELS[stage],
        l.outreachResponse ? responseLabel(l.outreachResponse) : "",
        l.passReason,
        l.crmNote,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [staged, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortMode === "score") {
        const as =
          typeof a.matchScore === "number" ? a.matchScore : -1;
        const bs =
          typeof b.matchScore === "number" ? b.matchScore : -1;
        if (bs !== as) return bs - as;
      } else {
        const av =
          typeof a.followerCountNumeric === "number"
            ? a.followerCountNumeric
            : null;
        const bv =
          typeof b.followerCountNumeric === "number"
            ? b.followerCountNumeric
            : null;
        if (av === null && bv === null) {
          /* keep */
        } else if (av === null) return 1;
        else if (bv === null) return -1;
        else {
          const cmp = sortMode === "followers-desc" ? bv - av : av - bv;
          if (cmp !== 0) return cmp;
        }
      }
      const at = a.createdAt?.toMillis?.() ?? 0;
      const bt = b.createdAt?.toMillis?.() ?? 0;
      return bt - at;
    });
  }, [filtered, sortMode]);

  const selectedLead =
    sorted.find((l) => l.id === selectedId) ??
    leads.find((l) => l.id === selectedId) ??
    null;

  const campaignLabel = (lead: OpticLeadRow) => {
    if (lead.campaignTitle?.trim()) return lead.campaignTitle.trim();
    if (lead.campaignId) {
      const m = campaigns.find((c) => c.id === lead.campaignId);
      if (m?.title) return m.title;
      return `Campaign ${lead.campaignId.slice(0, 6)}…`;
    }
    return "Pooled mission";
  };

  const cycleFollowerSort = () => {
    setSortMode((prev) =>
      prev === "followers-desc"
        ? "followers-asc"
        : prev === "followers-asc"
          ? "score"
          : "followers-desc"
    );
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-2 min-w-[220px]">
              <Label>Campaign scope</Label>
              <Select
                value={campaignFilter}
                onValueChange={onCampaignFilterChange}
                disabled={campaignsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter by campaign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All leads</SelectItem>
                  <SelectItem value="__pooled__">
                    Pooled missions (no single campaign)
                  </SelectItem>
                  {campaigns.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {(g.title || "Campaign").slice(0, 56)}
                      {g.title && g.title.length > 56 ? "…" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 min-w-[180px]">
              <Label>Stage</Label>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All stages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All stages</SelectItem>
                  {OPTIC_LEAD_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {OPTIC_LEAD_STAGE_LABELS[stage]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1 min-w-[200px] max-w-xl">
              <Label htmlFor="vault-search" className="sr-only">
                Search
              </Label>
              <Input
                id="vault-search"
                type="search"
                placeholder="Search name, niche, stage, reply…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {canAddManual && (
              <AddManualLeadDialog
                campaigns={campaigns}
                campaignFilter={campaignFilter}
              />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filtered.length === 0}
              onClick={() => downloadLeadsCsv(filtered)}
            >
              Export CSV
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/optic">New mission</Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`}
            {pagination && !loading
              ? ` · page ${pagination.pageIndex + 1} · ${pagination.pageSize} per page · newest first`
              : ""}
            {(filter.trim() || stageFilter !== "__all__") &&
            staged.length !== filtered.length
              ? ` (search narrowed from ${staged.length})`
              : ""}
            {!loading &&
            stageFilter !== "__all__" &&
            byCampaign.length !== staged.length
              ? ` · ${staged.length} ${OPTIC_LEAD_STAGE_LABELS[stageFilter as OpticLeadStage].toLowerCase()}`
              : ""}
            {!loading &&
            campaignFilter !== "__all__" &&
            leads.length !== byCampaign.length
              ? ` · ${byCampaign.length} in this campaign view (of ${leads.length} on this page)`
              : ""}
            {!loading && sortMode === "score"
              ? " · Sorted by match score"
              : ""}
          </p>
          {pagination && (pagination.hasPrevPage || pagination.hasNextPage) && (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || !pagination.hasPrevPage}
                onClick={pagination.goPrevPage}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Newer
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || !pagination.hasNextPage}
                onClick={pagination.goNextPage}
              >
                Older
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading vault…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {leads.length === 0
              ? "No leads yet. Run a discovery mission from Optic."
              : "No leads match this campaign or search."}
          </p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[148px] whitespace-nowrap">
                    Stage
                  </TableHead>
                  <TableHead>Creator</TableHead>
                  <TableHead className="w-28">
                    <button
                      type="button"
                      onClick={() => setSortMode("score")}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      aria-label="Sort by match score"
                    >
                      <Flame className="h-3.5 w-3.5 text-orange-500" />
                      Score
                      {sortMode === "score" && (
                        <ArrowDown className="h-3 w-3" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">Reply</TableHead>
                  <TableHead className="hidden xl:table-cell">Niche</TableHead>
                  <TableHead className="whitespace-nowrap">
                    <button
                      type="button"
                      onClick={cycleFollowerSort}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      aria-label="Sort by followers"
                    >
                      Followers
                      {sortMode === "followers-desc" && (
                        <ArrowDown className="h-3 w-3" />
                      )}
                      {sortMode === "followers-asc" && (
                        <ArrowUp className="h-3 w-3" />
                      )}
                      {sortMode === "score" && (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Last contact</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((lead) => {
                  const lastContact = tsToDate(resolveLastContactedAt(lead));
                  const stage = resolveLeadStage(lead);
                  const busy = outreachUpdatingId === lead.id;
                  const band = matchBand(lead.matchScore);
                  const platform = lead.discoveryPlatform;
                  return (
                    <TableRow
                      key={lead.id}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-muted/40",
                        selectedId === lead.id && "bg-primary/5 border-l-2 border-l-primary"
                      )}
                      onClick={() => setSelectedId(lead.id)}
                    >
                      <TableCell
                        className="align-middle py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {onCrmChange ? (
                          <Select
                            value={stage}
                            disabled={busy}
                            onValueChange={(value) =>
                              onCrmChange(lead.id, {
                                pipelineStage: value as OpticLeadStage,
                              })
                            }
                          >
                            <SelectTrigger
                              className={cn(
                                "h-8 w-[136px] text-xs font-medium",
                                stageBadgeClasses(stage)
                              )}
                              aria-label={`Stage for ${lead.creatorName ?? lead.id}`}
                            >
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
                        ) : (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                              stageBadgeClasses(stage)
                            )}
                          >
                            {OPTIC_LEAD_STAGE_LABELS[stage]}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-middle">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-9 w-9 shrink-0 border border-border">
                            {lead.avatarUrl ? (
                              <AvatarImage
                                src={lead.avatarUrl}
                                alt={lead.creatorName ?? "Creator"}
                              />
                            ) : null}
                            <AvatarFallback className="text-[11px] font-medium bg-muted">
                              {leadInitials(lead)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {lead.creatorName ?? "Unknown"}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {platform && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] px-1.5 py-0 capitalize font-normal",
                                    platformChipClasses(platform)
                                  )}
                                >
                                  {platform}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground line-clamp-1 max-w-[140px]">
                                {campaignLabel(lead)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-middle">
                        {typeof lead.matchScore === "number" ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums",
                              matchBandClasses(band)
                            )}
                            title={lead.matchReason ?? undefined}
                          >
                            {lead.matchScore}
                            <span className="font-normal opacity-80 hidden sm:inline">
                              {matchBandLabel(band)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="align-middle text-muted-foreground text-sm hidden lg:table-cell">
                        <span className="line-clamp-1">
                          {lead.outreachResponse
                            ? responseLabel(lead.outreachResponse)
                            : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="align-middle text-muted-foreground text-sm hidden xl:table-cell">
                        <span className="line-clamp-1">{lead.niche ?? "—"}</span>
                      </TableCell>
                      <TableCell className="align-middle text-muted-foreground text-sm tabular-nums">
                        {lead.followerCount ?? "—"}
                      </TableCell>
                      <TableCell className="align-middle text-xs text-muted-foreground whitespace-nowrap">
                        {lastContact
                          ? formatDistanceToNow(lastContact, { addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell className="align-middle text-right text-muted-foreground">
                        <ChevronRight className="h-4 w-4 inline-block opacity-50" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {pagination && !loading && leads.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              Page {pagination.pageIndex + 1}
              {pagination.hasNextPage ? " · more older leads available" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pagination.hasPrevPage}
                onClick={pagination.goPrevPage}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Newer
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pagination.hasNextPage}
                onClick={pagination.goNextPage}
              >
                Older
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <LeadReportSheet
          lead={selectedLead}
          open={Boolean(selectedLead)}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null);
          }}
          campaignLabel={selectedLead ? campaignLabel(selectedLead) : ""}
          gmailConnected={gmailConnected}
          onCreateGmailDraft={onCreateGmailDraft}
          draftingLeadId={draftingLeadId}
          onSendGmail={onSendGmail}
          sendingLeadId={sendingLeadId}
          gmailCanRead={gmailCanRead}
          onReconnectGmail={onReconnectGmail}
          onLoadThread={onLoadThread}
          onLinkThread={onLinkThread}
          linkingLeadId={linkingLeadId}
          threadLeadId={threadLeadId}
          threadMessages={threadMessages}
          threadReplyCount={threadReplyCount}
          threadLoading={threadLoading}
          threadReadOnly={threadReadOnly}
          threadSyncedByEmail={threadSyncedByEmail}
          outreachUpdatingId={outreachUpdatingId}
          onCrmChange={onCrmChange}
          onEmailChange={onEmailChange}
          emailUpdatingId={emailUpdatingId}
          onProfileChange={onProfileChange}
          profileUpdatingId={profileUpdatingId}
          onDraftChange={onDraftChange}
          draftUpdatingId={draftUpdatingId}
          onRegenerateDraft={onRegenerateDraft}
          regeneratingDraftId={regeneratingDraftId}
        />
      </CardContent>
    </Card>
  );
}

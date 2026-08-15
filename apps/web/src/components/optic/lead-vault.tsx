"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Flame,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { LeadReportSheet } from "@/components/optic/lead-report-sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  gmailConnected?: boolean;
  onCreateGmailDraft?: (leadId: string) => void;
  draftingLeadId?: string | null;
  campaigns: OpticCampaignOption[];
  campaignsLoading?: boolean;
  campaignFilter: string;
  onCampaignFilterChange: (value: string) => void;
  onOutreachToggle?: (leadId: string, emailed: boolean) => void;
  outreachUpdatingId?: string | null;
  onEmailChange?: (leadId: string, email: string) => void;
  emailUpdatingId?: string | null;
};

type SortMode = "score" | "followers-desc" | "followers-asc";

export function LeadVault({
  leads,
  loading,
  gmailConnected,
  onCreateGmailDraft,
  draftingLeadId,
  campaigns,
  campaignsLoading,
  campaignFilter,
  onCampaignFilterChange,
  onOutreachToggle,
  outreachUpdatingId,
  onEmailChange,
  emailUpdatingId,
}: LeadVaultProps) {
  const [filter, setFilter] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const byCampaign = useMemo(() => {
    if (campaignFilter === "__all__") return leads;
    if (campaignFilter === "__pooled__") {
      return leads.filter((l) => !l.campaignId);
    }
    return leads.filter((l) => l.campaignId === campaignFilter);
  }, [leads, campaignFilter]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return byCampaign;
    return byCampaign.filter((l) => {
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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [byCampaign, filter]);

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
            <div className="space-y-2 flex-1 min-w-[200px] max-w-xl">
              <Label htmlFor="vault-search" className="sr-only">
                Search
              </Label>
              <Input
                id="vault-search"
                type="search"
                placeholder="Search name, niche, email, campaign…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
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

        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`}
          {(filter.trim() || campaignFilter !== "__all__") &&
          byCampaign.length !== filtered.length
            ? ` (search narrowed from ${byCampaign.length})`
            : ""}
          {!loading &&
          campaignFilter !== "__all__" &&
          leads.length !== byCampaign.length
            ? ` · ${byCampaign.length} in this campaign view (of ${leads.length})`
            : ""}
          {!loading && sortMode === "score"
            ? " · Sorted by match score"
            : ""}
        </p>

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
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20 whitespace-nowrap px-2">
                    Contacted
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
                  <TableHead className="hidden md:table-cell">Niche</TableHead>
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
                  <TableHead className="whitespace-nowrap">Found</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((lead) => {
                  const created = tsToDate(lead.createdAt);
                  const contacted = Boolean(lead.outreachEmailed);
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
                        className="align-middle py-3 w-20 px-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {onOutreachToggle ? (
                          <Checkbox
                            checked={contacted}
                            disabled={busy}
                            onCheckedChange={(v) =>
                              onOutreachToggle(lead.id, v === true)
                            }
                            aria-label={`Marked contacted: ${lead.creatorName ?? lead.id}`}
                          />
                        ) : (
                          "—"
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
                      <TableCell className="align-middle text-muted-foreground text-sm hidden md:table-cell">
                        <span className="line-clamp-1">{lead.niche ?? "—"}</span>
                      </TableCell>
                      <TableCell className="align-middle text-muted-foreground text-sm tabular-nums">
                        {lead.followerCount ?? "—"}
                      </TableCell>
                      <TableCell className="align-middle text-xs text-muted-foreground whitespace-nowrap">
                        {created
                          ? formatDistanceToNow(created, { addSuffix: true })
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
          onOutreachToggle={onOutreachToggle}
          outreachUpdatingId={outreachUpdatingId}
          onEmailChange={onEmailChange}
          emailUpdatingId={emailUpdatingId}
        />
      </CardContent>
    </Card>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, ExternalLink, Loader2, Send } from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { Button } from "@/components/ui/button";
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
import { OutreachDraftCard } from "@/components/optic/outreach-draft-card";
import { downloadLeadsCsv } from "@/lib/optic/csv";
import { getLeadOutreachDraft, outreachCopyText } from "@/lib/optic/outreach-draft";
import type { OpticCampaignOption, OpticLeadRow } from "@/lib/optic/types";

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
};

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
}: LeadVaultProps) {
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [byCampaign, filter]);

  const copyDraft = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const campaignLabel = (lead: OpticLeadRow) => {
    if (lead.campaignTitle?.trim()) return lead.campaignTitle.trim();
    if (lead.campaignId) {
      const m = campaigns.find((c) => c.id === lead.campaignId);
      if (m?.title) return m.title;
      return `Campaign ${lead.campaignId.slice(0, 6)}…`;
    }
    return "Pooled mission";
  };

  return (
    <div className="space-y-4">
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
                <SelectItem value="__pooled__">Pooled missions (no single campaign)</SelectItem>
                {campaigns.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {(g.title || "Campaign").slice(0, 56)}
                    {g.title && g.title.length > 56 ? "…" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 flex-1 min-w-[200px] max-w-md">
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
        {loading ? "Loading…" : `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`}
        {(filter.trim() || campaignFilter !== "__all__") && byCampaign.length !== filtered.length
          ? ` (search narrowed from ${byCampaign.length})`
          : ""}
        {!loading && campaignFilter !== "__all__" && leads.length !== byCampaign.length
          ? ` · ${byCampaign.length} in this campaign view (of ${leads.length})`
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 whitespace-nowrap">Contacted</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead className="min-w-[120px]">Campaign</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="min-w-[200px]">Outreach draft</TableHead>
                <TableHead>Found</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((lead) => {
                const created = tsToDate(lead.createdAt);
                const contacted = Boolean(lead.outreachEmailed);
                const busy = outreachUpdatingId === lead.id;
                const outreach = getLeadOutreachDraft(lead);
                return (
                  <TableRow key={lead.id}>
                    <TableCell className="align-top py-2">
                      {onOutreachToggle ? (
                        <div className="flex items-center pt-1">
                          <Checkbox
                            checked={contacted}
                            disabled={busy}
                            onCheckedChange={(v) =>
                              onOutreachToggle(lead.id, v === true)
                            }
                            aria-label={`Marked contacted: ${lead.creatorName ?? lead.id}`}
                          />
                          {busy && (
                            <Loader2 className="ml-1 h-3 w-3 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <p className="font-medium">{lead.creatorName ?? "Unknown"}</p>
                      {lead.profileUrl && (
                        <a
                          href={lead.profileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Profile
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground text-xs max-w-[180px]">
                      <span className="line-clamp-2">{campaignLabel(lead)}</span>
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {lead.niche ?? "—"}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {lead.followerCount ?? "—"}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {lead.email ?? "—"}
                    </TableCell>
                    <TableCell className="align-top min-w-[220px] max-w-md">
                      {outreach ? (
                        <OutreachDraftCard draft={outreach} compact />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="align-top text-xs text-muted-foreground whitespace-nowrap">
                      {created
                        ? formatDistanceToNow(created, { addSuffix: true })
                        : "—"}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {outreach && (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => copyDraft(lead)}
                            title={
                              outreach.channel === "email"
                                ? "Copy email draft"
                                : `Copy ${outreach.platformLabel} DM`
                            }
                          >
                            {copiedId === lead.id ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                          {onCreateGmailDraft && outreach.channel === "email" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 px-2"
                              disabled={
                                !gmailConnected ||
                                !lead.email ||
                                draftingLeadId === lead.id
                              }
                              onClick={() => onCreateGmailDraft(lead.id)}
                              title={
                                gmailConnected
                                  ? lead.email
                                    ? "Create a draft in Gmail — review there, then send"
                                    : "No email — use Copy for platform DM"
                                  : "Connect Gmail on Discovery first"
                              }
                            >
                              {draftingLeadId === lead.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5" />
                              )}
                              <span className="hidden sm:inline">To drafts</span>
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

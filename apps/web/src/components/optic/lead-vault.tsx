"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, ExternalLink, Loader2, Mail } from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadLeadsCsv } from "@/lib/optic/csv";
import type { OpticLeadRow } from "@/lib/optic/types";

function tsToDate(ts: Timestamp | undefined | null): Date | null {
  if (!ts || typeof ts.toDate !== "function") return null;
  try {
    return ts.toDate();
  } catch {
    return null;
  }
}

type Props = {
  leads: OpticLeadRow[];
  loading?: boolean;
};

export function LeadVault({
  leads,
  loading,
  gmailConnected,
  onCreateGmailDraft,
  draftingLeadId,
}: Props) {
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => {
      const blob = [
        l.creatorName,
        l.profileUrl,
        l.niche,
        l.email,
        l.agencyName,
        l.draftEmail,
        l.followerCount,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [leads, filter]);

  const copyDraft = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          type="search"
          placeholder="Filter by name, URL, niche, email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-md"
        />
        <div className="flex gap-2">
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
        {filter.trim() && leads.length !== filtered.length ? ` (of ${leads.length})` : ""}
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading vault…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {leads.length === 0
            ? "No leads yet. Run a discovery mission from Optic."
            : "No leads match this filter."}
        </p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Creator</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Draft pitch</TableHead>
                <TableHead>Found</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((lead) => {
                const created = tsToDate(lead.createdAt);
                return (
                  <TableRow key={lead.id}>
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
                    <TableCell className="align-top text-muted-foreground">
                      {lead.niche ?? "—"}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {lead.followerCount ?? "—"}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {lead.email ?? "—"}
                    </TableCell>
                    <TableCell className="align-top max-w-xs">
                      {lead.draftEmail ? (
                        <p className="text-xs leading-relaxed text-muted-foreground line-clamp-4">
                          {lead.draftEmail}
                        </p>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="align-top text-xs text-muted-foreground whitespace-nowrap">
                      {created
                        ? formatDistanceToNow(created, { addSuffix: true })
                        : "—"}
                    </TableCell>
                    <TableCell className="align-top">
                      {lead.draftEmail && (
                        <div className="flex items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => copyDraft(lead.draftEmail!, lead.id)}
                            title="Copy draft email"
                          >
                            {copiedId === lead.id ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                          {onCreateGmailDraft && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={
                                !gmailConnected ||
                                !lead.email ||
                                draftingLeadId === lead.id
                              }
                              onClick={() => onCreateGmailDraft(lead.id)}
                              title={
                                gmailConnected
                                  ? lead.email
                                    ? "Save draft in Gmail"
                                    : "No email on profile"
                                  : "Connect Gmail on discovery"
                              }
                            >
                              {draftingLeadId === lead.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Mail className="h-4 w-4" />
                              )}
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

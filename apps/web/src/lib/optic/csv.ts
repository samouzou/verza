import type { OpticLeadRow } from "./types";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function tsToIso(ts: OpticLeadRow["createdAt"]): string {
  if (!ts || typeof ts.toDate !== "function") return "";
  try {
    return ts.toDate().toISOString();
  } catch {
    return "";
  }
}

function numCell(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** Exports leads to a CSV download (vault fields + match report + scrape metadata). */
export function downloadLeadsCsv(leads: OpticLeadRow[], filename = "optic-leads.csv"): void {
  const headers = [
    "creatorName",
    "avatarUrl",
    "matchScore",
    "matchReason",
    "matchBrief",
    "matchAudience",
    "matchContact",
    "matchActivity",
    "niche",
    "email",
    "followerCount",
    "followerCountNumeric",
    "postCount",
    "postCountNumeric",
    "username",
    "bio",
    "externalUrl",
    "profileUrl",
    "draftEmail",
    "draftEmailSubject",
    "draftDm",
    "discoveryPlatform",
    "brandName",
    "source",
    "campaignId",
    "campaignTitle",
    "outreachEmailed",
    "outreachEmailedAt",
    "createdAt",
  ];
  const rows = leads.map((l) => {
    const scrape = l.extensionScrape;
    const breakdown = l.matchBreakdown;
    const postCount =
      scrape?.postCount?.trim() ||
      (typeof l.postCountNumeric === "number" ? String(l.postCountNumeric) : "");
    return [
      l.creatorName ?? "",
      l.avatarUrl ?? "",
      numCell(l.matchScore),
      l.matchReason ?? "",
      numCell(breakdown?.brief),
      numCell(breakdown?.audience),
      numCell(breakdown?.contact),
      numCell(breakdown?.activity),
      l.niche ?? "",
      l.email ?? "",
      l.followerCount ?? "",
      numCell(l.followerCountNumeric),
      postCount,
      numCell(l.postCountNumeric),
      scrape?.username ?? "",
      scrape?.bio ?? "",
      scrape?.externalUrl ?? "",
      l.profileUrl ?? "",
      l.draftEmail ?? "",
      l.draftEmailSubject ?? "",
      l.draftDm ?? "",
      l.discoveryPlatform ?? "",
      l.agencyName ?? "",
      l.source ?? "",
      l.campaignId ?? "",
      l.campaignTitle ?? "",
      l.outreachEmailed ? "yes" : "no",
      tsToIso(l.outreachEmailedAt),
      tsToIso(l.createdAt),
    ]
      .map((c) => csvEscape(String(c)))
      .join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

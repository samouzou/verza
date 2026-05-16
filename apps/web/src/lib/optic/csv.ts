import type { OpticLeadRow } from "./types";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Exports leads to a CSV download (desktop Optic vault parity). */
export function downloadLeadsCsv(leads: OpticLeadRow[], filename = "optic-leads.csv"): void {
  const headers = [
    "creatorName",
    "niche",
    "email",
    "followerCount",
    "profileUrl",
    "draftEmail",
    "brandName",
    "source",
    "campaignId",
    "campaignTitle",
    "outreachEmailed",
  ];
  const rows = leads.map((l) =>
    [
      l.creatorName ?? "",
      l.niche ?? "",
      l.email ?? "",
      l.followerCount ?? "",
      l.profileUrl ?? "",
      l.draftEmail ?? "",
      l.agencyName ?? "",
      l.source ?? "",
      l.campaignId ?? "",
      l.campaignTitle ?? "",
      l.outreachEmailed ? "yes" : "no",
    ]
      .map((c) => csvEscape(String(c)))
      .join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

import type { OpticLeadRow } from "./types";

export type MatchBand = "strong" | "good" | "fair" | "weak" | "unknown";

export function matchBand(score: number | null | undefined): MatchBand {
  if (typeof score !== "number" || !Number.isFinite(score)) return "unknown";
  if (score >= 90) return "strong";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "weak";
}

export function matchBandLabel(band: MatchBand): string {
  switch (band) {
    case "strong":
      return "Strong";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "weak":
      return "Weak";
    default:
      return "—";
  }
}

/** Marketplace-inspired score chip colors. */
export function matchBandClasses(band: MatchBand): string {
  switch (band) {
    case "strong":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "good":
      return "bg-primary/10 text-primary border-primary/30";
    case "fair":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30";
    case "weak":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted/60 text-muted-foreground border-border";
  }
}

export function platformChipClasses(platform?: string | null): string {
  switch ((platform ?? "").toLowerCase()) {
    case "instagram":
      return "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/25";
    case "youtube":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25";
    case "tiktok":
      return "bg-foreground/10 text-foreground border-foreground/20";
    case "facebook":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25";
    case "twitch":
      return "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function leadInitials(lead: OpticLeadRow): string {
  const name = (lead.creatorName ?? "").trim();
  if (!name) return "?";
  const parts = name.replace(/^@/, "").split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

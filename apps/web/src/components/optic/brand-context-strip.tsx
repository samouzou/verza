"use client";

import type { OpticBrandStrip } from "@/lib/optic/types";

type Props = {
  strip: OpticBrandStrip | null;
  payScopeHint: string;
};

export function BrandContextStrip({ strip, payScopeHint }: Props) {
  if (!strip) return null;

  const bits: string[] = [];
  if (strip.brandSummary) bits.push(strip.brandSummary);
  if (strip.userDisplayName) bits.push(strip.userDisplayName);

  return (
    <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <p className="font-semibold">{strip.brandName}</p>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        {bits.length > 0
          ? bits.join(" · ")
          : "Add a mission statement in your Verza brand guide to sharpen pitches."}
      </p>
      <p className="mt-2 text-xs font-medium text-foreground/80">{payScopeHint}</p>
    </div>
  );
}

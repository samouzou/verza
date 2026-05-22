"use client";

import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type OpticCreditsBadgeProps = {
  balance: number;
  loading?: boolean;
  className?: string;
  compact?: boolean;
};

export function OpticCreditsBadge({
  balance,
  loading,
  className,
  compact,
}: OpticCreditsBadgeProps) {
  const low = !loading && balance <= 5;
  const empty = !loading && balance === 0;

  return (
    <Badge
      variant={empty ? "destructive" : low ? "secondary" : "outline"}
      className={cn(
        "gap-1 font-normal tabular-nums",
        compact && "text-xs",
        className
      )}
    >
      <Zap className={cn("shrink-0", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
      {loading ? (
        <span>Optic credits…</span>
      ) : (
        <span>
          {balance} Optic credit{balance === 1 ? "" : "s"} remaining
        </span>
      )}
    </Badge>
  );
}

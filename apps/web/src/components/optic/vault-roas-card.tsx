"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import type { Timestamp } from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OpticRoasInsight } from "@/lib/optic/types";
import { cn } from "@/lib/utils";

function tsToDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts || typeof ts.toDate !== "function") return null;
  try {
    return ts.toDate();
  } catch {
    return null;
  }
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function pct(n: number): string {
  const p = n * 100;
  return `${p.toFixed(p >= 1 ? 1 : 2)}%`;
}

export type VaultRoasCardProps = {
  campaignTitle?: string;
  insight: OpticRoasInsight | null;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh: (opts: {
    averageOrderValueUsd: number;
    conversionRate: number;
    viewRate: number;
  }) => void;
};

export function VaultRoasCard({
  campaignTitle,
  insight,
  loading,
  refreshing,
  error,
  onRefresh,
}: VaultRoasCardProps) {
  const [aov, setAov] = useState(
    String(insight?.inputs.averageOrderValueUsd ?? 50)
  );
  const [cvr, setCvr] = useState(
    String(((insight?.inputs.conversionRate ?? 0.005) * 100).toFixed(2))
  );
  const [view, setView] = useState(
    String(((insight?.inputs.viewRate ?? 0.08) * 100).toFixed(1))
  );

  const updated = tsToDate(insight?.updatedAt);
  const roasLabel =
    insight?.predictedRoas == null ? "—" : `${insight.predictedRoas.toFixed(2)}x`;

  const runRefresh = () => {
    const aovN = Number.parseFloat(aov);
    const cvrN = Number.parseFloat(cvr) / 100;
    const viewN = Number.parseFloat(view) / 100;
    onRefresh({
      averageOrderValueUsd: Number.isFinite(aovN) && aovN > 0 ? aovN : 50,
      conversionRate: Number.isFinite(cvrN) ? Math.min(1, Math.max(0, cvrN)) : 0.005,
      viewRate: Number.isFinite(viewN) ? Math.min(1, Math.max(0, viewN)) : 0.08,
    });
  };

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Predicted ROAS</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {campaignTitle?.trim() || "This campaign"}
              {insight?.source === "mcp" ? " · from launch report" : ""}
              {updated
                ? ` · updated ${formatDistanceToNow(updated, { addSuffix: true })}`
                : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={refreshing || loading}
            onClick={runRefresh}
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {insight ? "Recalculate" : "Estimate"}
          </Button>
        </div>

        {loading && !insight ? (
          <p className="text-sm text-muted-foreground">Loading estimate…</p>
        ) : insight ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 p-4 sm:col-span-2 lg:col-span-1">
                <p className="text-xs text-muted-foreground">Predicted ROAS</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                  {roasLabel}
                </p>
                <p
                  className={cn(
                    "mt-1 text-xs capitalize",
                    insight.confidence === "medium"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-amber-700 dark:text-amber-400"
                  )}
                >
                  {insight.confidence} confidence
                  {insight.usedProxies ? " · proxies" : ""}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Hire spend</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {money(insight.spendUsd)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {insight.hireCount} creators
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Expected revenue</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {money(insight.expectedRevenueUsd)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {Math.round(insight.expectedViews).toLocaleString()} views
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Creator budget</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {money(insight.budget.creatorCompensationUsd)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {insight.vaultLeadsUsed} vault leads modeled
                </p>
              </div>
            </div>

            {insight.creatorsPreview.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Reach model</p>
                <ul className="space-y-1.5 text-sm">
                  {insight.creatorsPreview.map((c, i) => (
                    <li
                      key={`${c.name ?? "c"}-${i}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-1.5 last:border-0"
                    >
                      <span className="truncate">{c.name ?? "Creator"}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {c.followers.toLocaleString()} followers
                        {c.matchScore != null ? ` · ${c.matchScore}%` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {insight.caveats[0] && (
              <p className="text-xs text-muted-foreground">{insight.caveats[0]}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No return estimate yet. Enter your typical order value and conversion rate, then
            estimate — or launch a campaign from Verza Assist for an automatic report.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="vault-roas-aov" className="text-xs">
              AOV (USD)
            </Label>
            <Input
              id="vault-roas-aov"
              inputMode="decimal"
              value={aov}
              onChange={(e) => setAov(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-roas-cvr" className="text-xs">
              Conv. rate (%)
            </Label>
            <Input
              id="vault-roas-cvr"
              inputMode="decimal"
              value={cvr}
              onChange={(e) => setCvr(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-roas-view" className="text-xs">
              View rate (%)
            </Label>
            <Input
              id="vault-roas-view"
              inputMode="decimal"
              value={view}
              onChange={(e) => setView(e.target.value)}
              className="h-8"
            />
          </div>
        </div>

        {insight && (
          <p className="text-xs text-muted-foreground">
            Current model: AOV {money(insight.inputs.averageOrderValueUsd)} · CVR{" "}
            {pct(insight.inputs.conversionRate)} · view {pct(insight.inputs.viewRate)}
          </p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

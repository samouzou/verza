"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  OpticRoasInsight,
  OpticRoasPipelineBucket,
  OpticRoasScenario,
  OpticRoasSpendBasis,
} from "@/lib/optic/types";
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

function roasText(roas: number | null): string {
  return roas == null ? "—" : `${roas.toFixed(2)}x`;
}

function roasTone(roas: number | null): string {
  if (roas == null) return "text-muted-foreground";
  return roas >= 1 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400";
}

const STAGE_LABELS: Record<OpticRoasPipelineBucket, string> = {
  booked: "Booked",
  negotiating: "In conversation",
  replied: "Replied",
  contacted: "Contacted",
  new: "Not contacted",
  excluded: "Out",
};

const BASIS_LABELS: Record<OpticRoasSpendBasis, string> = {
  quoted: "quoted",
  flat_fee: "flat fee",
  estimated: "estimated",
  unknown: "no rate",
};

const SCENARIOS: Array<{ key: "committed" | "likely" | "target"; label: string; hint: string }> = [
  { key: "committed", label: "Committed", hint: "Booked creators only" },
  { key: "likely", label: "Likely", hint: "Pipeline weighted by odds of booking" },
  { key: "target", label: "Full target", hint: "Every slot filled" },
];

const chartConfig = { roas: { label: "ROAS" } } satisfies ChartConfig;

function creatorsLabel(s: OpticRoasScenario, key: string): string {
  if (key === "likely") return `~${s.creators} creators expected`;
  return `${s.creators} creator${s.creators === 1 ? "" : "s"}`;
}

function ScenarioChart({ scenarios }: { scenarios: NonNullable<OpticRoasInsight["scenarios"]> }) {
  const data = SCENARIOS.map(({ key, label }) => ({ name: label, roas: scenarios[key].roas ?? 0, raw: scenarios[key].roas }));
  const max = Math.max(2, ...data.map((d) => d.roas)) * 1.15;
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[132px] w-full">
      <BarChart data={data} layout="vertical" margin={{ top: 14, right: 44, left: 4, bottom: 0 }}>
        <XAxis type="number" domain={[0, max]} hide />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={78} fontSize={12} />
        <ReferenceLine
          x={1}
          stroke="hsl(var(--muted-foreground))"
          strokeDasharray="4 4"
          label={{ value: "Break-even", position: "top", fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        />
        <Bar dataKey="roas" radius={4} barSize={18} isAnimationActive={false}>
          {data.map((d) => (
            <Cell
              key={d.name}
              fill={d.raw == null ? "hsl(var(--muted))" : d.raw >= 1 ? "hsl(var(--primary))" : "hsl(38 92% 50%)"}
            />
          ))}
          <LabelList
            dataKey="raw"
            position="right"
            fontSize={12}
            formatter={(v: number | null) => roasText(v)}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
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
  const scenarios = insight?.scenarios;
  const breakEvenFrom =
    scenarios && scenarios.likely.spendUsd > 0 ? scenarios.likely : scenarios?.target;
  const basis = insight?.spendBasis;
  const basisLine = basis
    ? (Object.keys(BASIS_LABELS) as OpticRoasSpendBasis[])
        .filter((k) => basis[k] > 0)
        .map((k) => `${basis[k]} ${BASIS_LABELS[k]}`)
        .join(" · ")
    : "";
  const excluded = insight?.pipeline?.excluded ?? 0;

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
        ) : insight && scenarios ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {SCENARIOS.map(({ key, label, hint }) => {
                const s = scenarios[key];
                return (
                  <div
                    key={key}
                    className={cn("rounded-lg border p-4", key === "likely" && "bg-muted/30")}
                    title={hint}
                  >
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", roasTone(s.roas))}>
                      {roasText(s.roas)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {money(s.spendUsd)} spend · {money(s.revenueUsd)} revenue
                    </p>
                    <p className="text-xs text-muted-foreground">{creatorsLabel(s, key)}</p>
                  </div>
                );
              })}
            </div>

            <ScenarioChart scenarios={scenarios} />

            <div className="space-y-1 text-xs text-muted-foreground">
              {breakEvenFrom?.breakEvenConversionRate != null && (
                <p>
                  <span className="font-medium text-foreground">
                    Break-even at {pct(breakEvenFrom.breakEvenConversionRate)} conversion
                  </span>{" "}
                  (you&apos;re modeling {pct(insight.inputs.conversionRate)}).
                </p>
              )}
              {basisLine && <p>Spend basis: {basisLine}.</p>}
              {excluded > 0 && (
                <p>
                  {excluded} creator{excluded === 1 ? "" : "s"} who passed, declined, or went quiet{" "}
                  {excluded === 1 ? "is" : "are"} left out.
                </p>
              )}
              <p className={roasTone(insight.confidence === "medium" ? 1 : 0)}>
                <span className="capitalize">{insight.confidence}</span> confidence
                {insight.usedProxies ? " · some placeholder creators" : ""}
              </p>
            </div>

            {insight.creatorsPreview.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Full target lineup</p>
                <ul className="space-y-1.5 text-sm">
                  {insight.creatorsPreview.map((c, i) => (
                    <li
                      key={`${c.name ?? "c"}-${i}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-1.5 last:border-0"
                    >
                      <span className="min-w-0 truncate">
                        {c.name ?? "Creator"}
                        {c.stage && (
                          <span className="ml-2 text-xs text-muted-foreground">{STAGE_LABELS[c.stage]}</span>
                        )}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {c.followers.toLocaleString()} followers
                        {c.spendUsd != null && c.spendBasis !== "unknown"
                          ? ` · ${money(c.spendUsd)}${c.spendBasis === "estimated" ? " est." : ""}`
                          : ""}
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
        ) : insight ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 p-4 sm:col-span-2 lg:col-span-1">
                <p className="text-xs text-muted-foreground">Predicted ROAS</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                  {roasText(insight.predictedRoas)}
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
            <p className="text-xs text-muted-foreground">
              Recalculate to see committed, likely, and full-target scenarios based on your pipeline.
            </p>
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

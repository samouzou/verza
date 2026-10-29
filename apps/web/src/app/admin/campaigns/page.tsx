"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { Loader2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";

type AdminCampaign = {
  id: string;
  title: string;
  status: string;
  brandId: string;
  campaignType: string | null;
  budgetMode: string;
  ratePerCreator: number;
  creatorsNeeded: number;
  campaignBudget: number;
  fundedAmount: number;
  budgetSpent: number;
  platformFeeFraction: number;
  platformFeePercent: number;
  createdAt: string | null;
};

export default function AdminCampaignsPage() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});
  const [feePercents, setFeePercents] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const checkAccess = useCallback(async () => {
    if (!user) {
      setAllowed(false);
      return;
    }
    try {
      const callable = httpsCallable(functions, "getAdminCampaignAccess");
      const res = await callable({});
      setAllowed((res.data as { allowed?: boolean }).allowed === true);
    } catch {
      setAllowed(false);
    }
  }, [user]);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const callable = httpsCallable(functions, "listAdminCampaigns");
      const res = await callable({ query: search });
      const rows = ((res.data as { campaigns?: AdminCampaign[] }).campaigns || []);
      setCampaigns(rows);
      setFeePercents((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          next[row.id] = String(row.platformFeePercent);
        }
        return next;
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not load campaigns",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isLoading) return;
    void checkAccess();
  }, [isLoading, checkAccess]);

  useEffect(() => {
    if (allowed) void load("");
  }, [allowed]); // initial list only; search uses load() directly

  async function fund(gigId: string) {
    const amount = Number(fundAmounts[gigId]);
    if (!Number.isFinite(amount) || amount < 1) {
      toast({ variant: "destructive", title: "Enter at least $1" });
      return;
    }
    setBusyId(gigId);
    try {
      const callable = httpsCallable(functions, "adminFundCampaign");
      const res = await callable({ gigId, amount });
      const data = res.data as { fundedAmount?: number };
      toast({ title: "Campaign funded", description: `Funded amount is now $${Number(data.fundedAmount || 0).toLocaleString()}.` });
      setFundAmounts((prev) => ({ ...prev, [gigId]: "" }));
      await load(queryText);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not fund campaign",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function saveFee(gigId: string) {
    const percent = Number(feePercents[gigId]);
    if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
      toast({ variant: "destructive", title: "Fee must be between 0 and 50%" });
      return;
    }
    setBusyId(gigId);
    try {
      const callable = httpsCallable(functions, "adminSetCampaignFee");
      const res = await callable({ gigId, percent });
      const data = res.data as { platformFeePercent?: number };
      toast({ title: "Fee updated", description: `This campaign now uses ${data.platformFeePercent}%.` });
      await load(queryText);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update fee",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading || allowed === null) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !allowed) {
    return (
      <div className="mx-auto max-w-lg space-y-2 py-20 text-center">
        <h1 className="text-xl font-semibold">Campaign admin</h1>
        <p className="text-sm text-muted-foreground">You don’t have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaign admin"
        description="Fund a campaign (credits brand escrow and this campaign’s locked amount) or set Verza’s fee for that campaign only."
      />

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(queryText);
        }}
      >
        <Input
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Campaign id or title"
          className="max-w-sm"
        />
        <Button type="submit" variant="outline" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => { setQueryText(""); void load(""); }} disabled={loading}>
          Recent
        </Button>
      </form>

      {loading && campaigns.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No campaigns in this view.</p>
      ) : (
        <ul className="space-y-4">
          {campaigns.map((row) => (
            <li key={row.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/campaigns/${row.id}`} className="font-medium hover:underline">
                    {row.title || "Untitled campaign"}
                  </Link>
                  <p className="text-[11px] font-mono text-muted-foreground">{row.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.budgetMode} · {row.campaignType || "standard"} · brand {row.brandId}
                  </p>
                </div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{row.status}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Funded ${row.fundedAmount.toLocaleString()} · spent ${row.budgetSpent.toLocaleString()}
                {row.budgetMode === "pool" ? ` · budget $${row.campaignBudget.toLocaleString()}` : ` · rate $${row.ratePerCreator.toLocaleString()}`}
                {` · fee ${row.platformFeePercent}%`}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`fund-${row.id}`}>Fund amount ($)</Label>
                  <div className="flex gap-2">
                    <Input
                      id={`fund-${row.id}`}
                      type="number"
                      min="1"
                      value={fundAmounts[row.id] ?? ""}
                      onChange={(e) => setFundAmounts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    />
                    <Button size="sm" disabled={busyId === row.id} onClick={() => void fund(row.id)}>
                      {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fund"}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`fee-${row.id}`}>Verza fee (%)</Label>
                  <div className="flex gap-2">
                    <Input
                      id={`fee-${row.id}`}
                      type="number"
                      min="0"
                      max="50"
                      step="0.1"
                      value={feePercents[row.id] ?? String(row.platformFeePercent)}
                      onChange={(e) => setFeePercents((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    />
                    <Button size="sm" variant="secondary" disabled={busyId === row.id} onClick={() => void saveFee(row.id)}>
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

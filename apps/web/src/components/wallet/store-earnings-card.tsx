"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { GraduationCap, Heart, Loader2, ShoppingBag } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/firebase";
import type { StorePurchase } from "@/types";
import { format } from "date-fns";

function formatUsd(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function kindLabel(kind: StorePurchase["kind"]) {
  if (kind === "course") return "Course";
  if (kind === "tip") return "Tip";
  return "Product";
}

function KindIcon({ kind }: { kind: StorePurchase["kind"] }) {
  if (kind === "course") return <GraduationCap className="h-3.5 w-3.5" />;
  if (kind === "tip") return <Heart className="h-3.5 w-3.5" />;
  return <ShoppingBag className="h-3.5 w-3.5" />;
}

interface StoreEarningsCardProps {
  creatorId: string;
}

export function StoreEarningsCard({ creatorId }: StoreEarningsCardProps) {
  const [purchases, setPurchases] = useState<StorePurchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const purchasesQ = query(
      collection(db, "storePurchases"),
      where("creatorId", "==", creatorId),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      purchasesQ,
      (snap) => {
        setPurchases(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as StorePurchase))
        );
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [creatorId]);

  const totals = useMemo(() => {
    const paid = purchases.filter((p) => p.status === "paid");
    return {
      sales: paid.length,
      netCents: paid.reduce((sum, p) => sum + (p.creatorNetCents || 0), 0),
    };
  }, [purchases]);

  const recent = purchases.slice(0, 8);

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-violet-600" />
              Store sales
            </CardTitle>
            <CardDescription>
              Fan purchases are deposited to your connected payout account
              (Stripe) — not your Verza Wallet. Campaign earnings above still
              use the wallet balance.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/store">Manage Store</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-3 py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading store sales…
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Lifetime sales
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {totals.sales}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  You received (after fees)
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {formatUsd(totals.netCents)}
                </p>
              </div>
            </div>

            {recent.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">
                No store sales yet. Share your product links from{" "}
                <Link href="/store" className="underline underline-offset-2">
                  Store
                </Link>
                .
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Product</th>
                      <th className="hidden px-4 py-2 font-medium sm:table-cell">
                        Buyer
                      </th>
                      <th className="hidden px-4 py-2 font-medium md:table-cell">
                        Date
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        You received
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((sale) => (
                      <tr key={sale.id} className="border-t">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className="gap-1 font-normal shrink-0"
                            >
                              <KindIcon kind={sale.kind} />
                              {kindLabel(sale.kind)}
                            </Badge>
                            <span className="truncate">{sale.productTitle}</span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">
                          {sale.buyerEmail}
                        </td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                          {sale.createdAt
                            ? format(sale.createdAt.toDate(), "PP")
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                          {formatUsd(sale.creatorNetCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

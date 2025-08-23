
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, PlusCircle, ArrowDownCircle, Banknote, Users, Loader2 } from "lucide-react";
import type { Stripe } from 'stripe';

interface WalletOverviewProps {
  balance: { available: Stripe.Balance.Available[], pending: Stripe.Balance.Available[] } | null;
  isLoading: boolean;
}

export function WalletOverview({ balance, isLoading }: WalletOverviewProps) {
  const formatBalance = (balanceArray: Stripe.Balance.Available[] | undefined) => {
    if (!balanceArray || balanceArray.length === 0) {
      return '0.00';
    }
    // Assuming a single currency (e.g., USD) for simplicity.
    // A more robust implementation would handle multiple currencies.
    const amount = balanceArray[0].amount / 100;
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="shadow-lg lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-6 w-6 text-primary" />
              Stripe Balance
            </CardTitle>
            <span className="text-xs text-muted-foreground">Live Data from Stripe</span>
          </div>
          <CardDescription>Funds available for immediate withdrawal from your connected Stripe account.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-4 h-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Syncing with Stripe...</p>
            </div>
          ) : (
            <div className="text-5xl font-bold mb-6">${formatBalance(balance?.available)}</div>
          )}
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
            <Button className="flex-1" disabled>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Funds (Disabled)
            </Button>
            <Button variant="outline" className="flex-1" disabled>
              <ArrowDownCircle className="mr-2 h-4 w-4" /> Withdraw Funds (Disabled)
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Banknote className="h-5 w-5 text-muted-foreground" />
              Pending Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <p className="text-2xl font-bold">${formatBalance(balance?.pending)}</p>
            )}
            <p className="text-xs text-muted-foreground">Funds currently processing in Stripe.</p>
          </CardContent>
        </Card>
        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              Agency View
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">Agency owners can manage payouts from the Agency page.</p>
            <Button variant="secondary" className="w-full" asChild>
                <a href="/agency">Go to Agency Dashboard</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

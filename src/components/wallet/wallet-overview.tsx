
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, ArrowDownCircle, Loader2 } from "lucide-react";
import Link from "next/link";

interface WalletOverviewProps {
  walletBalance: number;
  isLoading: boolean;
  stripeConnected: boolean;
  isPayingOut: boolean;
  onInitiatePayout: () => void;
}

export function WalletOverview({
  walletBalance,
  isLoading,
  stripeConnected,
  isPayingOut,
  onInitiatePayout,
}: WalletOverviewProps) {
  const formatted = walletBalance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-primary" />
            Verza Wallet
          </CardTitle>
        </div>
        <CardDescription>
          Earnings from approved campaigns. Connect a bank account to withdraw funds.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-4 h-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading balance...</p>
          </div>
        ) : (
          <div className="text-5xl font-bold mb-6">${formatted}</div>
        )}

        {stripeConnected ? (
          <Button
            className="w-full sm:w-auto"
            disabled={isPayingOut || walletBalance < 1 || isLoading}
            onClick={onInitiatePayout}
          >
            {isPayingOut ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowDownCircle className="mr-2 h-4 w-4" />
            )}
            {isPayingOut ? "Processing..." : "Payout to Bank"}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Connect a bank account to withdraw your earnings.
            </p>
            <Button variant="outline" className="w-full sm:w-auto" asChild>
              <Link href="/settings">Connect Bank Account</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

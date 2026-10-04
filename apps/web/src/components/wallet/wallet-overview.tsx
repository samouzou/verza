
"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, ArrowDownCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface WalletOverviewProps {
  walletBalance: number;
  isLoading: boolean;
  payoutReady: boolean;
  isPayingOut: boolean;
  onInitiatePayout: (amount: number) => Promise<void>;
}

export function WalletOverview({
  walletBalance,
  isLoading,
  payoutReady,
  isPayingOut,
  onInitiatePayout,
}: WalletOverviewProps) {
  const { toast } = useToast();
  const [isPayoutOpen, setIsPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const formatted = walletBalance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleConfirm = async () => {
    const amountNum = parseFloat(payoutAmount);
    if (isNaN(amountNum) || amountNum < 1) {
      toast({ title: "Invalid Amount", description: "Minimum payout is $1.", variant: "destructive" });
      return;
    }
    if (amountNum > walletBalance) {
      toast({ title: "Insufficient Balance", description: "Amount exceeds your wallet balance.", variant: "destructive" });
      return;
    }
    try {
      await onInitiatePayout(amountNum);
      setIsPayoutOpen(false);
      setPayoutAmount("");
    } catch {
      // The wallet page shows the error.
    }
  };

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
          Earnings from approved campaigns. Withdraw to your bank when you are
          ready — Store sales are paid out separately.
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

        {payoutReady ? (
          <Dialog open={isPayoutOpen} onOpenChange={setIsPayoutOpen}>
            <DialogTrigger asChild>
              <Button
                className="w-full sm:w-auto"
                disabled={isPayingOut || walletBalance < 1 || isLoading}
              >
                {isPayingOut ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowDownCircle className="mr-2 h-4 w-4" />
                )}
                {isPayingOut ? "Processing..." : "Payout to Bank"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Payout to Bank</DialogTitle>
                <DialogDescription>Choose how much to transfer to your connected bank account. Allow 1-7 business days.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="creator-payout-amount">Amount ($)</Label>
                  <Input
                    id="creator-payout-amount"
                    type="number"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    placeholder="0.00"
                    min="1"
                    max={walletBalance}
                  />
                  <p className="text-xs text-muted-foreground">
                    Wallet balance: <span className="font-bold text-foreground">${formatted}</span>
                    {" · "}
                    <button type="button" className="underline text-primary" onClick={() => setPayoutAmount(walletBalance.toFixed(2))}>Payout all</button>
                  </p>
                </div>
                <div className="p-3 bg-muted/50 rounded-md text-xs text-muted-foreground">
                  Funds are transferred via Stripe to your connected bank account. This action cannot be undone.
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsPayoutOpen(false)} disabled={isPayingOut}>Cancel</Button>
                <Button onClick={handleConfirm} disabled={isPayingOut}>
                  {isPayingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowDownCircle className="mr-2 h-4 w-4" />}
                  Confirm Payout
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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

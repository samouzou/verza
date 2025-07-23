
"use client";

import { PageHeader } from "@/components/page-header";
import { WalletOverview } from "@/components/wallet/wallet-overview";
import { TransactionHistory } from "@/components/wallet/transaction-history";
import { useAuth } from "@/hooks/use-auth";
import { AlertCircle, Loader2 } from "lucide-react";

export default function WalletPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Loading Wallet...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full pt-10">
        <AlertCircle className="w-12 h-12 text-primary mb-4" />
        <p className="text-xl text-muted-foreground">Please log in to view your wallet.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Creator Wallet"
        description="View your earnings, manage payouts, and see your transaction history."
      />
      <div className="space-y-8">
        <WalletOverview />
        <TransactionHistory />
      </div>
    </>
  );
}

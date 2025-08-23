
"use client";

import { PageHeader } from "@/components/page-header";
import { WalletOverview } from "@/components/wallet/wallet-overview";
import { TransactionHistory } from "@/components/wallet/transaction-history";
import { useAuth } from "@/hooks/use-auth";
import { AlertCircle, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import type { InternalPayout } from "@/types";
import { db, collection, query, where, onSnapshot, orderBy } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { Stripe } from "stripe";

type StripeBalance = {
  available: Stripe.Balance.Available[];
  pending: Stripe.Balance.Available[];
  error?: string;
};

export default function WalletPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [payouts, setPayouts] = useState<InternalPayout[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [stripeBalance, setStripeBalance] = useState<StripeBalance | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);

  useEffect(() => {
    if (user && !authLoading) {
      setIsLoadingData(true);
      setIsLoadingBalance(true);

      const payoutsQuery = query(
        collection(db, "internalPayouts"),
        where("talentId", "==", user.uid),
        orderBy("initiatedAt", "desc")
      );

      const unsubscribePayouts = onSnapshot(payoutsQuery, (snapshot) => {
        const history = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InternalPayout));
        setPayouts(history);
        setIsLoadingData(false);
      }, (error) => {
        console.error("Error fetching payout history:", error);
        toast({ title: "History Error", description: "Could not fetch your payout history.", variant: "destructive" });
        setIsLoadingData(false);
      });

      const getBalance = async () => {
        try {
          const getStripeAccountBalance = httpsCallable(functions, 'getStripeAccountBalance');
          const result = await getStripeAccountBalance();
          const balanceData = result.data as StripeBalance;
          if (balanceData.error) {
            toast({ title: "Balance Error", description: balanceData.error, variant: "destructive" });
            setStripeBalance(null);
          } else {
            setStripeBalance(balanceData);
          }
        } catch (error) {
          console.error("Error calling getStripeAccountBalance function:", error);
          toast({ title: "Balance Error", description: "Could not connect to Stripe to get your live balance.", variant: "destructive" });
          setStripeBalance(null);
        } finally {
          setIsLoadingBalance(false);
        }
      };

      getBalance();

      return () => {
        unsubscribePayouts();
      };
    } else if (!authLoading) {
      setIsLoadingData(false);
      setIsLoadingBalance(false);
    }
  }, [user, authLoading, toast]);


  if (authLoading || (isLoadingData && isLoadingBalance)) {
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
        <WalletOverview balance={stripeBalance} isLoading={isLoadingBalance} />
        <TransactionHistory transactions={payouts} />
      </div>
    </>
  );
}

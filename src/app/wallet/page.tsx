
"use client";

import { PageHeader } from "@/components/page-header";
import { WalletOverview } from "@/components/wallet/wallet-overview";
import { TransactionHistory } from "@/components/wallet/transaction-history";
import { useAuth } from "@/hooks/use-auth";
import { AlertCircle, Loader2 } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
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
  const [receivedPayouts, setReceivedPayouts] = useState<InternalPayout[]>([]);
  const [sentPayouts, setSentPayouts] = useState<InternalPayout[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [stripeBalance, setStripeBalance] = useState<StripeBalance | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);

  useEffect(() => {
    if (!user || authLoading) return;

    setIsLoadingData(true);

    // 1. Fetch payouts received as talent
    const receivedQuery = query(
      collection(db, "internalPayouts"),
      where("talentId", "==", user.uid),
      orderBy("initiatedAt", "desc")
    );

    const unsubscribeReceived = onSnapshot(receivedQuery, (snapshot) => {
      setReceivedPayouts(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InternalPayout)));
      setIsLoadingData(false);
    }, (error) => {
      console.error("Error fetching received payouts:", error);
      setIsLoadingData(false);
    });

    // 2. Fetch payouts sent by agency (if user is owner/manager)
    let unsubscribeSent = () => {};
    const isAgencyManager = user.role === 'agency_owner' || user.role === 'agency_admin' || user.role === 'agency_member';
    
    if (isAgencyManager && user.primaryAgencyId) {
      const sentQuery = query(
        collection(db, "internalPayouts"),
        where("agencyId", "==", user.primaryAgencyId),
        orderBy("initiatedAt", "desc")
      );

      unsubscribeSent = onSnapshot(sentQuery, (snapshot) => {
        // Filter out those where user is the talent (already in received) to avoid duplicates
        const sent = snapshot.docs
          .map(doc => ({ ...doc.data(), id: doc.id } as InternalPayout))
          .filter(p => p.talentId !== user.uid);
        setSentPayouts(sent);
      }, (error) => {
        console.error("Error fetching sent payouts:", error);
      });
    }

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
        setStripeBalance(null);
      } finally {
        setIsLoadingBalance(false);
      }
    };

    getBalance();

    return () => {
      unsubscribeReceived();
      unsubscribeSent();
    };
  }, [user, authLoading, toast]);

  const allTransactions = useMemo(() => {
    const combined = [...receivedPayouts, ...sentPayouts];
    return combined.sort((a, b) => b.initiatedAt.toMillis() - a.initiatedAt.toMillis());
  }, [receivedPayouts, sentPayouts]);


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
        title="Wallet"
        description="View your earnings, manage payouts, and see your transaction history."
      />
      <div className="space-y-8">
        <WalletOverview balance={stripeBalance} isLoading={isLoadingBalance} />
        <TransactionHistory transactions={allTransactions} currentUserId={user.uid} />
      </div>
    </>
  );
}

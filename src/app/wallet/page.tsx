
"use client";

import { PageHeader } from "@/components/page-header";
import { WalletOverview } from "@/components/wallet/wallet-overview";
import { TransactionHistory } from "@/components/wallet/transaction-history";
import { PayoutHistoryCard } from "@/components/agency/payout-history-card";
import { CommissionHistoryCard } from "@/components/agency/commission-history-card";
import { BudgetSummary } from "@/components/agency/budget-summary";
import { useAuth } from "@/hooks/use-auth";
import { AlertCircle, Loader2, Wallet } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import type { InternalPayout, Agency } from "@/types";
import { db, collection, query, where, onSnapshot, orderBy, doc } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export default function WalletPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [receivedPayouts, setReceivedPayouts] = useState<InternalPayout[]>([]);
  const [commissions, setCommissions] = useState<InternalPayout[]>([]);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isPayingOut, setIsPayingOut] = useState(false);

  const isAgencyManager = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';
  const stripeConnected = !!(user?.stripeAccountId && user?.stripePayoutsEnabled);
  const walletBalance = user?.walletBalance ?? 0;

  useEffect(() => {
    if (!user || authLoading) return;

    setIsLoadingData(true);

    const receivedQuery = query(
      collection(db, "internalPayouts"),
      where("talentId", "==", user.uid),
      orderBy("initiatedAt", "desc")
    );

    const unsubscribeReceived = onSnapshot(receivedQuery, (snapshot) => {
      const all = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InternalPayout));
      setReceivedPayouts(all.filter(p => p.type !== "agency_commission"));
      if (!isAgencyManager) setIsLoadingData(false);
    }, (error) => {
      console.error("Error fetching received payouts:", error);
      if (!isAgencyManager) setIsLoadingData(false);
    });

    let unsubscribeAgency: (() => void) | undefined;
    let unsubscribeCommissions: (() => void) | undefined;
    if (isAgencyManager && user.primaryAgencyId) {
      unsubscribeAgency = onSnapshot(doc(db, "agencies", user.primaryAgencyId), (snapshot) => {
        if (snapshot.exists()) {
          setAgency({ id: snapshot.id, ...snapshot.data() } as Agency);
        }
        setIsLoadingData(false);
      }, (error) => {
        console.error("Error fetching agency for wallet:", error);
        setIsLoadingData(false);
      });

      const commissionsQuery = query(
        collection(db, "internalPayouts"),
        where("agencyId", "==", user.primaryAgencyId),
        where("type", "==", "agency_commission"),
        orderBy("initiatedAt", "desc")
      );
      unsubscribeCommissions = onSnapshot(commissionsQuery, (snapshot) => {
        setCommissions(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InternalPayout)));
      }, (error) => {
        console.error("Error fetching commissions:", error);
      });
    }

    return () => {
      unsubscribeReceived();
      if (unsubscribeAgency) unsubscribeAgency();
      if (unsubscribeCommissions) unsubscribeCommissions();
    };
  }, [user, authLoading, isAgencyManager]);

  const handleInitiatePayout = async () => {
    if (!user) return;
    setIsPayingOut(true);
    try {
      const initiateCreatorPayout = httpsCallable(functions, 'initiateCreatorPayout');
      await initiateCreatorPayout();
      toast({
        title: "Payout Initiated!",
        description: `$${walletBalance.toFixed(2)} is on its way to your bank account. Allow 1-3 business days.`,
      });
    } catch (error: any) {
      toast({
        title: "Payout Failed",
        description: error?.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsPayingOut(false);
    }
  };

  const sortedEarnings = useMemo(() => {
    return [...receivedPayouts].sort((a, b) => b.initiatedAt.toMillis() - a.initiatedAt.toMillis());
  }, [receivedPayouts]);

  if (authLoading || isLoadingData) {
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
        description="View your earnings, manage agency budgets, and track transaction history."
      />
      <div className="space-y-8">
        {isAgencyManager && agency && (
          <div id="agency-budget-section" className="space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" /> Agency Budget
            </h3>
            <BudgetSummary agency={agency} />
          </div>
        )}

        <div className="space-y-4">
          <h3 className="text-lg font-bold">Personal Earnings</h3>
          <WalletOverview
            walletBalance={walletBalance}
            isLoading={false}
            stripeConnected={stripeConnected}
            isPayingOut={isPayingOut}
            onInitiatePayout={handleInitiatePayout}
          />
        </div>

        <div className="space-y-6">
          <div id="personal-earnings-section">
            <h3 className="text-lg font-semibold mb-4">Earnings History</h3>
            <TransactionHistory transactions={sortedEarnings} currentUserId={user.uid} />
          </div>

          {isAgencyManager && user.primaryAgencyId && (
            <>
              <div id="agency-commissions-section">
                <h3 className="text-lg font-semibold mb-4">Commission Earnings</h3>
                <CommissionHistoryCard commissions={commissions} />
              </div>
              <div id="agency-disbursements-section">
                <h3 className="text-lg font-semibold mb-4">Agency Disbursement History</h3>
                <PayoutHistoryCard agencyId={user.primaryAgencyId} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

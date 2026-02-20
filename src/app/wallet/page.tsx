
"use client";

import { PageHeader } from "@/components/page-header";
import { WalletOverview } from "@/components/wallet/wallet-overview";
import { TransactionHistory } from "@/components/wallet/transaction-history";
import { useAuth } from "@/hooks/use-auth";
import { AlertCircle, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import type { InternalPayout, Agency } from "@/types";
import { db, collection, query, where, onSnapshot, orderBy, doc } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { Stripe } from "stripe";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TopUpCard } from "@/components/agency/top-up-card";
import { PayoutHistoryCard } from "@/components/agency/payout-history-card";

type StripeBalance = {
  available: Stripe.Balance.Available[];
  pending: Stripe.Balance.Available[];
  error?: string;
};

export default function WalletPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  
  // State for creator view
  const [creatorPayouts, setCreatorPayouts] = useState<InternalPayout[]>([]);
  const [stripeBalance, setStripeBalance] = useState<StripeBalance | null>(null);
  const [isLoadingCreatorData, setIsLoadingCreatorData] = useState(true);

  // State for agency view
  const [agency, setAgency] = useState<Agency | null>(null);
  const [isLoadingAgencyData, setIsLoadingAgencyData] = useState(true);

  useEffect(() => {
    if (!user || authLoading) {
      if (!authLoading) {
          setIsLoadingCreatorData(false);
          setIsLoadingAgencyData(false);
      }
      return;
    }

    // Reset states on user change
    setIsLoadingCreatorData(true);
    setIsLoadingAgencyData(true);
    setCreatorPayouts([]);
    setStripeBalance(null);
    setAgency(null);

    // If user is an agency owner, fetch agency data
    if (user.isAgencyOwner && user.primaryAgencyId) {
      setIsLoadingAgencyData(true);
      const agencyDocRef = doc(db, 'agencies', user.primaryAgencyId);
      const unsubscribeAgency = onSnapshot(agencyDocRef, (docSnap) => {
        if (docSnap.exists()) {
          setAgency({ id: docSnap.id, ...docSnap.data() } as Agency);
        } else {
          toast({ title: "Error", description: "Could not find your agency data.", variant: "destructive" });
          setAgency(null);
        }
        setIsLoadingAgencyData(false);
      }, (error) => {
        console.error("Error fetching agency data:", error);
        toast({ title: "Error", description: "Failed to load agency wallet.", variant: "destructive" });
        setIsLoadingAgencyData(false);
      });
      // Agency payout history is handled by the PayoutHistoryCard component itself.
      // Creator data is not needed for this view.
      setIsLoadingCreatorData(false); 
      return () => unsubscribeAgency();
    } 
    // Otherwise, fetch creator-specific data
    else {
      setIsLoadingCreatorData(true);
      const payoutsQuery = query(
        collection(db, "internalPayouts"),
        where("talentId", "==", user.uid),
        orderBy("initiatedAt", "desc")
      );

      const unsubscribePayouts = onSnapshot(payoutsQuery, (snapshot) => {
        const history = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InternalPayout));
        setCreatorPayouts(history);
      }, (error) => {
        console.error("Error fetching payout history:", error);
        toast({ title: "History Error", description: "Could not fetch your payout history.", variant: "destructive" });
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
           setIsLoadingCreatorData(false);
        }
      };

      getBalance();
      // Agency data is not needed for this view
      setIsLoadingAgencyData(false);

      return () => {
        unsubscribePayouts();
      };
    }
  }, [user, authLoading, toast]);


  if (authLoading || isLoadingCreatorData || isLoadingAgencyData) {
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

  // Agency Owner View
  if (user.isAgencyOwner && agency) {
    return (
      <>
        <PageHeader
          title="Agency Wallet"
          description={`Manage funds and view transaction history for ${agency.name}.`}
        />
        <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Current Wallet Balance</CardTitle>
                        <CardDescription>This is the total amount of funds available in your agency's Verza wallet for payouts.</CardDescription>
                    </CardHeader>
                    <CardContent>
                         <p className="text-5xl font-bold">${(agency.walletBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                         <p className="text-xs text-muted-foreground mt-1">Updated in real-time. Balance is funded by client commissions and direct top-ups.</p>
                    </CardContent>
                </Card>
                <TopUpCard agencyId={agency.id} disabled={!user.isAgencyOwner} />
            </div>
          <PayoutHistoryCard agencyId={agency.id} />
        </div>
      </>
    );
  }

  // Default Creator View
  return (
    <>
      <PageHeader
        title="Creator Wallet"
        description="View your earnings, manage payouts, and see your transaction history."
      />
      <div className="space-y-8">
        <WalletOverview balance={stripeBalance} isLoading={isLoadingCreatorData} />
        <TransactionHistory transactions={creatorPayouts} />
      </div>
    </>
  );
}

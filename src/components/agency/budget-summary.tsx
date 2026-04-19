"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { DollarSign, PlusCircle, Lock, Wallet, Loader2, ArrowDownCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Agency } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

interface BudgetSummaryProps {
  agency: Agency;
}

export function BudgetSummary({ agency }: BudgetSummaryProps) {
  const { toast } = useToast();
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("500");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPayingOut, setIsPayingOut] = useState(false);

  const available = agency.availableBalance || 0;
  const escrow = agency.escrowBalance || 0;
  const total = available + escrow;

  const handlePayout = async () => {
    setIsPayingOut(true);
    try {
      const initiateAgencyPayout = httpsCallable(functions, 'initiateAgencyPayout');
      await initiateAgencyPayout({ agencyId: agency.id });
      toast({
        title: "Payout Initiated!",
        description: `$${available.toFixed(2)} is on its way to your bank account. Allow 1-3 business days.`,
      });
    } catch (error: any) {
      toast({ title: "Payout Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsPayingOut(false);
    }
  };

  const handleTopUp = async () => {
    const amountNum = parseFloat(topUpAmount);
    if (isNaN(amountNum) || amountNum < 10) {
      toast({ title: "Invalid Amount", description: "Minimum top-up is $10.", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    try {
      const createTopUpSession = httpsCallable(functions, 'createAgencyTopUpSession');
      const result = await createTopUpSession({ amount: amountNum, agencyId: agency.id });
      const data = result.data as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("Failed to get payment URL.");
      }
    } catch (error: any) {
      console.error(error);
      toast({ title: "Top-up Error", description: error.message, variant: "destructive" });
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-2 shadow-lg border-primary/10 bg-gradient-to-br from-background to-primary/5">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Total Verza Liquidity
            </CardTitle>
            <CardDescription>Consolidated budget across wallet and active deployments.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={isPayingOut || available < 1}>
                  {isPayingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowDownCircle className="mr-2 h-4 w-4" />}
                  Payout to Bank
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Initiate Agency Payout?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will transfer your available balance of <span className="font-bold text-foreground">${available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> to the connected bank account. Allow 1-3 business days. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handlePayout}>Confirm Payout</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Dialog open={isTopUpOpen} onOpenChange={setIsTopUpOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-primary text-primary-foreground font-bold shadow-md hover:shadow-lg transition-all">
                <PlusCircle className="mr-2 h-4 w-4" /> Top Up Wallet
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Top Up Agency Budget</DialogTitle>
                <DialogDescription>Add funds to your general wallet. These funds can be used to fund new gigs or pay talent instantly.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="top-up-amount">Amount ($)</Label>
                  <Input 
                    id="top-up-amount" 
                    type="number" 
                    value={topUpAmount} 
                    onChange={e => setTopUpAmount(e.target.value)}
                    min="10"
                  />
                </div>
                <div className="p-3 bg-muted/50 rounded-md text-xs text-muted-foreground">
                  Funds will be added to your <strong>Available Balance</strong> immediately after payment is confirmed.
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsTopUpOpen(false)} disabled={isProcessing}>Cancel</Button>
                <Button onClick={handleTopUp} disabled={isProcessing}>
                  {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <DollarSign className="mr-2 h-4 w-4"/>}
                  Continue to Secure Payment
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="text-4xl font-black text-primary mb-6">${total.toLocaleString()}</div>
          <div className="space-y-4">
            <div className="flex justify-between text-xs font-bold uppercase tracking-widest mb-1">
              <span className="flex items-center gap-1.5"><Wallet className="h-3 w-3 text-green-500" /> Available</span>
              <span className="flex items-center gap-1.5 text-muted-foreground"><Lock className="h-3 w-3" /> Escrowed (Active Gigs)</span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted border border-border/50">
              <div 
                className="h-full bg-green-500 transition-all" 
                style={{ width: `${total > 0 ? (available / total) * 100 : 0}%` }} 
              />
              <div 
                className="h-full bg-primary/40 transition-all" 
                style={{ width: `${total > 0 ? (escrow / total) * 100 : 0}%` }} 
              />
            </div>
            <div className="flex justify-between items-center pt-2">
              <div className="space-y-0.5">
                <p className="text-lg font-bold">${available.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground font-bold uppercase">General Wallet</p>
              </div>
              <div className="text-right space-y-0.5">
                <p className="text-lg font-bold text-muted-foreground">${escrow.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground font-bold uppercase">Locked in Escrow</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg border-muted">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Budget Insight</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Maintaining a healthy <strong>Available Balance</strong> allows you to scale campaigns and issue performance bonuses without repeated card charges.
          </p>
          <div className="p-3 bg-muted/30 rounded border border-dashed flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Active Roster Size</span>
              <span className="font-bold">{agency.talent?.length || 0}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Avg. Payout per Creator</span>
              <span className="font-bold">$1,250</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

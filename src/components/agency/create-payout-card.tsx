
"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Loader2, DollarSign, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { Agency } from '@/types';

interface CreatePayoutCardProps {
  agency: Agency;
  disabled: boolean;
}

export function CreatePayoutCard({ agency, disabled }: CreatePayoutCardProps) {
  const { toast } = useToast();
  const [payoutTalentId, setPayoutTalentId] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutDate, setPayoutDate] = useState(new Date().toISOString().split('T')[0]);
  const [payoutDescription, setPayoutDescription] = useState("");
  const [isSendingPayout, setIsSendingPayout] = useState(false);
  const createInternalPayoutCallable = httpsCallable(functions, 'createInternalPayout');

  const { platformFee, totalCharge } = useMemo(() => {
    const amountNum = parseFloat(payoutAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return { platformFee: 0, totalCharge: 0 };
    }
    const fee = (amountNum * 0.04) + 0.30;
    return {
      platformFee: fee,
      totalCharge: amountNum + fee,
    };
  }, [payoutAmount]);
  
  const handleSendPayout = async () => {
    const amountNum = parseFloat(payoutAmount);
    if (!payoutTalentId) {
        toast({ title: "Talent Required", description: "Please select a talent to pay.", variant: "destructive"});
        return;
    }
    if (isNaN(amountNum) || amountNum <= 0) {
        toast({ title: "Invalid Amount", description: "Please enter a valid positive amount.", variant: "destructive"});
        return;
    }
    if (!payoutDescription.trim()) {
        toast({ title: "Description Required", description: "Please enter a reason for this payment.", variant: "destructive"});
        return;
    }
     if (!payoutDate) {
        toast({ title: "Payment Date Required", description: "Please select a date for the payment.", variant: "destructive"});
        return;
    }

    setIsSendingPayout(true);
    try {
        await createInternalPayoutCallable({
            agencyId: agency.id,
            talentId: payoutTalentId,
            amount: amountNum,
            description: payoutDescription.trim(),
            paymentDate: payoutDate,
        });
        toast({ title: "Payout Initiated", description: "The internal payout has been recorded and is pending."});
        setPayoutTalentId("");
        setPayoutAmount("");
        setPayoutDescription("");
        setPayoutDate(new Date().toISOString().split('T')[0]);
    } catch (error: any) {
        console.error("Error sending payout:", error);
        toast({ title: "Payout Failed", description: error.message || "Could not initiate the payout.", variant: "destructive" });
    } finally {
        setIsSendingPayout(false);
    }
  };
  
  const selectedTalentForPayout = agency.talent.find(t => t.userId === payoutTalentId);

  return (
    <Card id="create-payout-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DollarSign className="text-primary" /> Create Internal Payout</CardTitle>
        <CardDescription>Send one-off or recurring payments to your talent.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="payout-talent">Talent</Label>
          <Select value={payoutTalentId} onValueChange={setPayoutTalentId} disabled={isSendingPayout || disabled}>
            <SelectTrigger id="payout-talent"><SelectValue placeholder="Select a talent..." /></SelectTrigger>
            <SelectContent>
              {agency.talent.filter(t => t.status === 'active').map(t => (
                <SelectItem key={t.userId} value={t.userId}>{t.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="payout-amount">Amount ($)</Label>
              <Input id="payout-amount" type="number" placeholder="100.00" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} disabled={isSendingPayout || disabled} />
            </div>
              <div>
              <Label htmlFor="payout-date">Payment Date</Label>
              <Input id="payout-date" type="date" value={payoutDate} onChange={(e) => setPayoutDate(e.target.value)} disabled={isSendingPayout || disabled} />
            </div>
        </div>
        <div>
          <Label htmlFor="payout-description">Payment For</Label>
          <Textarea id="payout-description" placeholder="e.g., July Retainer, Bonus for TikTok video" value={payoutDescription} onChange={(e) => setPayoutDescription(e.target.value)} disabled={isSendingPayout || disabled} />
        </div>
        {payoutAmount && (
          <div className="p-3 border rounded-md bg-muted text-sm space-y-2">
            <div className="flex justify-between"><span>Payout to {selectedTalentForPayout?.displayName || 'Talent'}</span><span>${parseFloat(payoutAmount).toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Platform & Processing Fee</span><span>${platformFee.toFixed(2)}</span></div>
            <Separator />
            <div className="flex justify-between font-bold"><span>Total Charge</span><span>${totalCharge.toFixed(2)}</span></div>
          </div>
        )}
          <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={isSendingPayout || !payoutTalentId || !payoutAmount || !payoutDescription || !payoutDate || disabled}>
              <Send className="mr-2 h-4 w-4" />
              Send Payment
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Payment</AlertDialogTitle>
              <AlertDialogDescription>
                You are about to send a payment of <span className="font-bold">${parseFloat(payoutAmount || "0").toLocaleString()}</span> to <span className="font-bold">{selectedTalentForPayout?.displayName || "this talent"}</span>. 
                The total charge to your payment method will be <span className="font-bold">${totalCharge.toFixed(2)}</span>. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSendPayout} disabled={isSendingPayout}>
                {isSendingPayout ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirm Payment
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

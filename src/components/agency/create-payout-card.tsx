
"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const [payoutDescription, setPayoutDescription] = useState("");
  const [isSendingPayout, setIsSendingPayout] = useState(false);
  const createInternalPayoutCallable = httpsCallable(functions, 'createInternalPayout');

  const selectedTalentForPayout = agency.talent.find(t => t.userId === payoutTalentId);

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

    setIsSendingPayout(true);
    try {
        await createInternalPayoutCallable({
            agencyId: agency.id,
            talentId: payoutTalentId,
            amount: amountNum,
            description: payoutDescription.trim(),
        });
        toast({ title: "Payout Initiated", description: "The payout transfer has been initiated."});
        setPayoutTalentId("");
        setPayoutAmount("");
        setPayoutDescription("");
    } catch (error: any) {
        console.error("Error sending payout:", error);
        toast({ title: "Payout Failed", description: error.message || "Could not initiate the payout.", variant: "destructive" });
    } finally {
        setIsSendingPayout(false);
    }
  };
  
  return (
    <Card id="create-payout-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DollarSign className="text-primary" /> Create Internal Payout</CardTitle>
        <CardDescription>Pay talent directly from your agency's wallet balance.</CardDescription>
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
        <div>
          <Label htmlFor="payout-amount">Amount ($)</Label>
          <Input id="payout-amount" type="number" placeholder="100.00" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} disabled={isSendingPayout || disabled} />
        </div>
        <div>
          <Label htmlFor="payout-description">Payment For</Label>
          <Textarea id="payout-description" placeholder="e.g., July Retainer, Bonus for TikTok video" value={payoutDescription} onChange={(e) => setPayoutDescription(e.target.value)} disabled={isSendingPayout || disabled} />
        </div>
        
          <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={isSendingPayout || !payoutTalentId || !payoutAmount || !payoutDescription || disabled}>
              <Send className="mr-2 h-4 w-4" />
              Send Payout
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Payout</AlertDialogTitle>
              <AlertDialogDescription>
                You are about to send a payout of <span className="font-bold">${parseFloat(payoutAmount || "0").toLocaleString()}</span> to <span className="font-bold">{selectedTalentForPayout?.displayName || "this talent"}</span> from your agency wallet. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSendPayout} disabled={isSendingPayout}>
                {isSendingPayout ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirm Payout
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

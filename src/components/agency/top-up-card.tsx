
"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, PlusCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

interface TopUpCardProps {
  agencyId: string;
  disabled: boolean;
}

export function TopUpCard({ agencyId, disabled }: TopUpCardProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const createAgencyTopUpSessionCallable = httpsCallable(functions, 'createAgencyTopUpSession');

  const handleTopUp = async () => {
    const topUpAmount = parseFloat(amount);
    if (isNaN(topUpAmount) || topUpAmount <= 0) {
      toast({ title: 'Invalid Amount', description: 'Please enter a valid amount to add.', variant: 'destructive' });
      return;
    }
    
    setIsProcessing(true);
    toast({ title: 'Redirecting to Checkout...', description: 'Please complete your payment to add funds.' });
    
    try {
      const result = await createAgencyTopUpSessionCallable({ agencyId, amount: topUpAmount });
      const data = result.data as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Could not retrieve checkout URL.');
      }
    } catch (error: any) {
      console.error('Error creating top-up session:', error);
      toast({ title: 'Top-up Failed', description: error.message || 'Could not start the top-up process.', variant: 'destructive' });
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Up Wallet</CardTitle>
        <CardDescription>Add funds to your agency wallet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="top-up-amount">Amount ($)</Label>
          <Input 
            id="top-up-amount" 
            type="number" 
            placeholder="e.g., 500.00" 
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isProcessing || disabled}
          />
        </div>
        <Button onClick={handleTopUp} disabled={isProcessing || !amount || disabled}>
          {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
          Add Funds
        </Button>
      </CardContent>
    </Card>
  );
}


"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Loader2, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { InternalPayout } from '@/types';
import { onSnapshot, collection, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface PayoutHistoryCardProps {
  agencyId: string;
}

export function PayoutHistoryCard({ agencyId }: PayoutHistoryCardProps) {
  const { toast } = useToast();
  const [payoutHistory, setPayoutHistory] = useState<InternalPayout[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    if (!agencyId) return;
    setIsLoadingHistory(true);
    const payoutsQuery = query(
        collection(db, "internalPayouts"), 
        where("agencyId", "==", agencyId),
        orderBy("initiatedAt", "desc")
    );
    const unsubscribe = onSnapshot(payoutsQuery, (snapshot) => {
        const history = snapshot.docs.map(doc => ({...doc.data(), id: doc.id} as InternalPayout));
        setPayoutHistory(history);
        setIsLoadingHistory(false);
    }, (error) => {
        console.error("Error fetching payout history:", error);
        toast({ title: "History Error", description: "Could not fetch payout history.", variant: "destructive" });
        setIsLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [agencyId, toast]);

  return (
    <Card id="payout-history-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DollarSign className="text-primary"/> Internal Payout History</CardTitle>
        <CardDescription>History of one-off payments made to your talent.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingHistory ? <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin"/></div>
         : payoutHistory.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Talent</TableHead>
                <TableHead>Payment Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Platform Fee</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payoutHistory.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.talentName}</TableCell>
                  <TableCell>{p.paymentDate ? new Date((p.paymentDate as Timestamp).seconds * 1000).toLocaleDateString() : (p.initiatedAt as Timestamp).toDate().toLocaleDateString()}</TableCell>
                  <TableCell>{p.description}</TableCell>
                  <TableCell><Badge variant={p.status === 'paid' ? 'default' : 'secondary'} className={`capitalize ${p.status === 'paid' ? 'bg-green-500' : ''}`}>{p.status}</Badge></TableCell>
                  <TableCell className="font-mono text-muted-foreground">${p.platformFee?.toFixed(2) || '0.00'}</TableCell>
                  <TableCell className="text-right font-mono">${p.amount.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
         ) : <p className="text-center text-muted-foreground py-6">No internal payouts have been made.</p>}
      </CardContent>
    </Card>
  );
}

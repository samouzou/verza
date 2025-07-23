
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, PlusCircle, ArrowDownCircle, Banknote, Users } from "lucide-react";
import { useState, useEffect } from 'react';
import type { InternalPayout } from '@/types';

interface WalletOverviewProps {
  payouts: InternalPayout[];
}

export function WalletOverview({ payouts }: WalletOverviewProps) {
  const [balance, setBalance] = useState(0);
  const [upcomingPayouts, setUpcomingPayouts] = useState(0);

  useEffect(() => {
    const paidBalance = payouts
      .filter(p => p.status === 'paid')
      .reduce((acc, p) => acc + p.amount, 0);
    setBalance(paidBalance);

    const pendingAmount = payouts
      .filter(p => p.status === 'pending')
      .reduce((acc, p) => acc + p.amount, 0);
    setUpcomingPayouts(pendingAmount);

  }, [payouts]);
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="shadow-lg lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-6 w-6 text-primary" />
              Available Balance
            </CardTitle>
            <span className="text-xs text-muted-foreground">Powered by Stripe</span>
          </div>
          <CardDescription>Funds available for immediate withdrawal.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-5xl font-bold mb-6">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
            <Button className="flex-1" disabled>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Funds (Disabled)
            </Button>
            <Button variant="outline" className="flex-1" disabled>
              <ArrowDownCircle className="mr-2 h-4 w-4" /> Withdraw Funds (Disabled)
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Banknote className="h-5 w-5 text-muted-foreground" />
              Upcoming Payouts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${upcomingPayouts.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            <p className="text-xs text-muted-foreground">{payouts.filter(p=>p.status === 'pending').length} pending payouts from your agency.</p>
          </CardContent>
        </Card>
        <Card className="shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              Agency View
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">Agency owners can manage payouts from the Agency page.</p>
            <Button variant="secondary" className="w-full" asChild>
                <a href="/agency">Go to Agency Dashboard</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

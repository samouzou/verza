"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, PlusCircle, ArrowDownCircle } from "lucide-react";
import { useState, useEffect } from 'react';

export function WalletOverview() {
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    // Simulate fetching balance
    setBalance(12345.67);
  }, []);
  
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-primary" />
            Creator Wallet Balance
          </CardTitle>
          <span className="text-xs text-muted-foreground">Powered by Stripe (mock)</span>
        </div>
        <CardDescription>Your current available funds.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-4xl font-bold mb-6">${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div className="flex space-x-4">
          <Button className="flex-1" disabled>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Funds
          </Button>
          <Button variant="outline" className="flex-1" disabled>
            <ArrowDownCircle className="mr-2 h-4 w-4" /> Withdraw
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground text-center">
          Actual payment processing and wallet functionality will be integrated in a future version.
        </p>
      </CardContent>
    </Card>
  );
}


"use client";

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, Landmark, BarChart3, TrendingUp, FileWarning, PlusCircle, Check, ShieldCheck } from "lucide-react";
import type { BankAccount, BankTransaction, TaxEstimation } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { estimateTaxes } from '@/ai/flows/tax-estimation-flow';
import { classifyTransaction } from '@/ai/flows/classify-transaction-flow';
import { getFunctions, httpsCallableFromURL } from 'firebase/functions';
import { useToast } from '@/hooks/use-toast';

// --- Mock Data ---
const MOCK_ACCOUNTS: BankAccount[] = [
  { id: 'acc_1', userId: 'user_1', name: 'Chase Sapphire Checking', officialName: 'CHASE SAPPHIRE CHECKING', mask: '1234', type: 'depository', subtype: 'checking', balance: 15234.88, provider: 'Finicity', providerAccountId: 'fin_1' },
  { id: 'acc_2', userId: 'user_1', name: 'Amex Gold Card', officialName: 'AMERICAN EXPRESS GOLD', mask: '5678', type: 'credit', subtype: 'credit card', balance: -1245.21, provider: 'Finicity', providerAccountId: 'fin_2' },
  { id: 'acc_3', userId: 'user_1', name: 'Creator Business Savings', officialName: 'BANK OF AMERICA SAVINGS', mask: '9012', type: 'depository', subtype: 'savings', balance: 50000.00, provider: 'Finicity', providerAccountId: 'fin_3' },
];

const MOCK_TRANSACTIONS_RAW: Omit<BankTransaction, 'isTaxDeductible' | 'category'>[] = [
  { id: 'txn_1', userId: 'user_1', accountId: 'acc_1', date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), description: "Payment from Nike, Inc.", amount: 5000.00, currency: 'USD', isBrandSpend: false, linkedReceiptId: null, createdAt: new Date() as any, updatedAt: new Date() as any },
  { id: 'txn_2', userId: 'user_1', accountId: 'acc_2', date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), description: "Adobe Creative Cloud", amount: -59.99, currency: 'USD', isBrandSpend: false, linkedReceiptId: null, createdAt: new Date() as any, updatedAt: new Date() as any },
  { id: 'txn_3', userId: 'user_1', accountId: 'acc_1', date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), description: "Starbucks Client Mtg", amount: -24.50, currency: 'USD', isBrandSpend: false, linkedReceiptId: 'receipt_123', createdAt: new Date() as any, updatedAt: new Date() as any },
  { id: 'txn_4', userId: 'user_1', accountId: 'acc_2', date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), description: "United Airlines Flight", amount: -453.81, currency: 'USD', isBrandSpend: false, linkedReceiptId: null, createdAt: new Date() as any, updatedAt: new Date() as any },
  { id: 'txn_5', userId: 'user_1', accountId: 'acc_1', date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), description: "Payment from Google LLC", amount: 12000.00, currency: 'USD', isBrandSpend: false, linkedReceiptId: null, createdAt: new Date() as any, updatedAt: new Date() as any },
  { id: 'txn_6', userId: 'user_1', accountId: 'acc_2', date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(), description: "H&M Store 432", amount: -150.75, currency: 'USD', isBrandSpend: false, linkedReceiptId: null, createdAt: new Date() as any, updatedAt: new Date() as any },
];
// --- End Mock Data ---

const GENERATE_FINICITY_CONNECT_URL = "https://generatefinicityconnecturl-cpmccwbluq-uc.a.run.app";

export default function BankingPage() {
  const { user, isLoading: authLoading, getUserIdToken } = useAuth();
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [taxEstimation, setTaxEstimation] = useState<TaxEstimation | null>(null);
  const [isLoadingTaxEstimation, setIsLoadingTaxEstimation] = useState(true);

  // Load Finicity Connect SDK script
  useEffect(() => {
    const scriptId = 'finicity-connect-sdk';
    if (document.getElementById(scriptId)) return; // Script already added

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://connect.finicity.com/assets/sdk/finicity-connect.min.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      const existingScript = document.getElementById(scriptId);
      if (existingScript) {
        document.body.removeChild(existingScript);
      }
    };
  }, []);

  useEffect(() => {
    // Simulate fetching account data
    setAccounts(MOCK_ACCOUNTS);

    // AI Transaction Classification logic
    const processTransactions = async () => {
      setIsLoadingTransactions(true);
      try {
        const processed = await Promise.all(MOCK_TRANSACTIONS_RAW.map(async (txn) => {
          if (txn.amount > 0) {
            return { ...txn, isTaxDeductible: false, category: 'Client Payment' };
          }
          try {
            const classification = await classifyTransaction({ description: txn.description });
            return { ...txn, ...classification, isTaxDeductible: !!classification.isTaxDeductible, category: classification.category };
          } catch (aiError) {
            console.error(`AI classification failed for "${txn.description}":`, aiError);
            return { ...txn, isTaxDeductible: false, category: 'Other' };
          }
        }));
        setTransactions(processed as BankTransaction[]);
      } catch (error) {
        console.error("Error processing transactions:", error);
        setTransactions(MOCK_TRANSACTIONS_RAW.map(t => ({...t, isTaxDeductible: false, category: 'Other'})) as BankTransaction[]);
      } finally {
        setIsLoadingTransactions(false);
      }
    };
    
    processTransactions();
  }, []);

  useEffect(() => {
    // AI Tax Estimation logic
    const runTaxEstimation = async () => {
      if (isLoadingTransactions || transactions.length === 0) {
        if (!isLoadingTransactions) setIsLoadingTaxEstimation(false);
        return;
      }
      setIsLoadingTaxEstimation(true);
      try {
        const grossIncome = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
        const estimation = await estimateTaxes({
          totalGrossIncome: grossIncome,
          transactions: transactions,
          filingStatus: 'single',
          taxYear: new Date().getFullYear(),
        });
        setTaxEstimation(estimation);
      } catch (error) {
        console.error("Error estimating taxes:", error);
        setTaxEstimation(null);
      } finally {
        setIsLoadingTaxEstimation(false);
      }
    };
    
    runTaxEstimation();
  }, [transactions, isLoadingTransactions]);

  const handleConnectFinicity = async () => {
    setIsConnecting(true);
    try {
      const firebaseFunctions = getFunctions();
      const generateUrlCallable = httpsCallableFromURL(firebaseFunctions, GENERATE_FINICITY_CONNECT_URL);
      const result = await generateUrlCallable();
      const { connectUrl } = result.data as {connectUrl: string};

      if (!connectUrl) {
          throw new Error("Connect URL not returned from server.");
      }

      const connectOptions = {
        onSuccess: (event: any) => {
          console.log('Finicity Connect Success!', event);
          toast({
            title: "Connection Successful!",
            description: "Your account has been linked. We will now fetch your data.",
          });
          // In a real app, you would now trigger a refresh of accounts/transactions
          // or wait for a webhook to update your database.
        },
        onCancel: () => {
          console.log('Finicity Connect Canceled.');
          toast({
            title: "Connection Canceled",
            description: "The bank connection process was canceled.",
            variant: "default",
          });
        },
        onError: (error: any) => {
          console.error('Finicity Connect Error:', error);
          toast({
            title: "Connection Error",
            description: error.message || "An error occurred while linking your account.",
            variant: "destructive",
          });
        },
      };

      if ((window as any).FinicityConnect) {
        (window as any).FinicityConnect.launch(connectUrl, connectOptions);
      } else {
        throw new Error("Finicity Connect SDK not loaded. Please try again in a moment.");
      }

    } catch (error: any) {
      console.error("Error launching Finicity Connect:", error);
      toast({
        title: "Setup Failed",
        description: error.message || "Could not start the bank connection process.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };


  const handleTransactionUpdate = (txnId: string, field: 'category' | 'isTaxDeductible', value: string | boolean) => {
    setTransactions(currentTxns => 
      currentTxns.map(txn => 
        txn.id === txnId ? { ...txn, [field]: value } : txn
      )
    );
  };
  
  if (authLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Please log in to manage banking and tax information.</p>
      </div>
    );
  }

  const transactionCategories = [ "Client Payment", "Software", "Travel", "Meals & Entertainment", "Office Supplies", "Marketing", "Other" ];

  return (
    <>
      <PageHeader
        title="Banking & Taxes"
        description="Connect bank accounts, categorize transactions, and estimate your taxes."
      />
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Landmark className="h-6 w-6 text-primary" /> Bank Connections</CardTitle>
            <CardDescription>Securely connect your bank accounts to automatically import transactions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center justify-between p-3 border rounded-md bg-muted/50">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-6 w-6 text-green-500" />
                    <div>
                      <p className="font-medium">{acc.name}</p>
                      <p className="text-sm text-muted-foreground">{acc.officialName} ••••{acc.mask}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-lg">${acc.balance.toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
                    <p className="text-xs text-muted-foreground capitalize">{acc.subtype}</p>
                  </div>
                </div>
              ))}
            </div>
            <Button onClick={handleConnectFinicity} className="w-full sm:w-auto" disabled={isConnecting}>
              {isConnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
              Connect New Account
            </Button>
            <p className="text-xs text-muted-foreground">
              Verza uses secure partners like Finicity to link your accounts. Your bank credentials are never stored by Verza.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /> Transactions</CardTitle>
            <CardDescription>AI has automatically categorized your transactions. Review and adjust as needed.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingTransactions ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-3 text-muted-foreground">AI is classifying your transactions...</p>
              </div>
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[200px]">Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-center w-[120px]">Tax Deductible</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map(txn => (
                  <TableRow key={txn.id}>
                    <TableCell className="text-sm text-muted-foreground">{new Date(txn.date).toLocaleDateString()}</TableCell>
                    <TableCell className="font-medium">{txn.description}</TableCell>
                    <TableCell>
                      <Select 
                        value={txn.category} 
                        onValueChange={(value) => handleTransactionUpdate(txn.id, 'category', value)}
                      >
                        <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                        <SelectContent>
                          {transactionCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${txn.amount > 0 ? 'text-green-600' : 'text-slate-700 dark:text-slate-300'}`}>
                      {txn.amount > 0 ? '+' : ''}${txn.amount.toLocaleString('en-US', {minimumFractionDigits: 2})}
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox 
                        checked={!!txn.isTaxDeductible} 
                        onCheckedChange={(checked) => handleTransactionUpdate(txn.id, 'isTaxDeductible', !!checked)}
                        aria-label="Is tax deductible"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-6 w-6 text-primary" /> Tax Estimation</CardTitle>
            <CardDescription>An AI-powered estimate of your potential tax liability based on categorized transactions.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingTaxEstimation ? (
               <div className="flex items-center justify-center h-32">
                 <Loader2 className="h-8 w-8 animate-spin text-primary" />
               </div>
            ) : taxEstimation ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Est. Taxable Income</p>
                  <p className="text-2xl font-bold">${taxEstimation.estimatedTaxableIncome.toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">Est. Tax Owed</p>
                  <p className="text-2xl font-bold">${taxEstimation.estimatedTaxOwed.toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
                </div>
                 <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <p className="text-sm text-blue-600 dark:text-blue-300">Suggested Set-Aside</p>
                  <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">{taxEstimation.suggestedSetAsidePercentage}%</p>
                </div>
                 <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <p className="text-sm text-blue-600 dark:text-blue-300">Set-Aside Amount</p>
                  <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">${taxEstimation.suggestedSetAsideAmount.toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
                </div>
              </div>
            ) : (
              <div className="p-6 border rounded-md bg-muted text-center">
                <p className="text-lg text-muted-foreground">Categorize transactions to see tax estimates.</p>
              </div>
            )}
             <div className="mt-6 p-4 border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20 rounded-r-lg">
                <div className="flex items-start gap-3">
                    <FileWarning className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-amber-700 dark:text-amber-300 mb-1">Notes & Disclaimers</h3>
                      <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-1 list-disc list-inside">
                        {(taxEstimation?.notes && taxEstimation.notes.length > 0) ? (
                          taxEstimation.notes.map((note, index) => <li key={index}>{note}</li>)
                        ) : (
                          <li>Tax estimations are for informational purposes only and are not financial or legal advice. Consult a qualified tax professional.</li>
                        )}
                      </ul>
                    </div>
                </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

    
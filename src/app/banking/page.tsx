
"use client";

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, Landmark, BarChart3, TrendingUp, FileWarning, PlusCircle, ShieldCheck } from "lucide-react";
import type { BankAccount, BankTransaction, TaxEstimation, Receipt } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { estimateTaxes } from '@/ai/flows/tax-estimation-flow';
import { classifyTransaction } from '@/ai/flows/classify-transaction-flow';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@/hooks/use-toast';
import { functions as firebaseFunctionsInstance, db, collection, onSnapshot, query, where, doc, updateDoc, Timestamp } from '@/lib/firebase';

export default function BankingPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [userReceipts, setUserReceipts] = useState<Receipt[]>([]);
  
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [isClassifying, setIsClassifying] = useState(false);
  
  const [taxEstimation, setTaxEstimation] = useState<TaxEstimation | null>(null);
  const [isLoadingTaxEstimation, setIsLoadingTaxEstimation] = useState(true);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // Real-time listener for Bank Accounts
  useEffect(() => {
    if (!user) return;
    setIsLoadingAccounts(true);
    const accountsQuery = query(collection(db, `users/${user.uid}/bankAccounts`));
    const unsubscribe = onSnapshot(accountsQuery, 
      (snapshot) => {
        const fetchedAccounts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankAccount));
        setAccounts(fetchedAccounts);
        setIsLoadingAccounts(false);
      },
      (error) => {
        console.error("Error fetching bank accounts:", error);
        toast({ title: "Error", description: "Could not fetch bank accounts.", variant: "destructive" });
        setIsLoadingAccounts(false);
      }
    );
    return () => unsubscribe();
  }, [user, toast]);

  // Real-time listener for Bank Transactions and AI classification
  useEffect(() => {
    if (!user) return;
    setIsLoadingTransactions(true);
    const transQuery = query(collection(db, `users/${user.uid}/bankTransactions`));
    const unsubscribe = onSnapshot(transQuery, 
      async (snapshot) => {
        const fetchedTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BankTransaction));
        
        setIsClassifying(true);
        const processedTransactions = await Promise.all(
          fetchedTransactions.map(async (txn) => {
            if (txn.category || txn.amount > 0) {
              return txn.amount > 0 ? { ...txn, isTaxDeductible: false, category: 'Client Payment' } : txn;
            }
            try {
              const classification = await classifyTransaction({ description: txn.description });
              const updatedTxn = { ...txn, ...classification, isTaxDeductible: !!classification.isTaxDeductible };
              
              const txnDocRef = doc(db, `users/${user.uid}/bankTransactions`, txn.id);
              updateDoc(txnDocRef, { category: classification.category, isTaxDeductible: !!classification.isTaxDeductible }).catch(e => console.warn("Failed to update transaction in Firestore:", e));
              
              return updatedTxn;
            } catch (aiError) {
              console.error(`AI classification failed for "${txn.description}":`, aiError);
              return { ...txn, isTaxDeductible: false, category: 'Other' };
            }
          })
        );
        setTransactions(processedTransactions);
        setIsClassifying(false);
        setIsLoadingTransactions(false);
      },
      (error) => {
        console.error("Error fetching transactions:", error);
        toast({ title: "Error", description: "Could not fetch transactions.", variant: "destructive" });
        setIsLoadingTransactions(false);
        setIsClassifying(false);
      }
    );
    return () => unsubscribe();
  }, [user, toast]);

  // Tax Estimation Effect
  useEffect(() => {
    const runTaxEstimation = async () => {
      if (isLoadingTransactions || transactions.length === 0) {
        if (!isLoadingTransactions) setIsLoadingTaxEstimation(false);
        return;
      }
      setIsLoadingTaxEstimation(true);
      try {
        const grossIncome = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
        
        // Convert Timestamps to plain objects for Server Action
        const serializableTransactions = transactions.map(txn => ({
          ...txn,
          createdAt: txn.createdAt instanceof Timestamp 
            ? { seconds: txn.createdAt.seconds, nanoseconds: txn.createdAt.nanoseconds } 
            : txn.createdAt,
          updatedAt: txn.updatedAt instanceof Timestamp 
            ? { seconds: txn.updatedAt.seconds, nanoseconds: txn.updatedAt.nanoseconds } 
            : txn.updatedAt,
        }));

        const estimation = await estimateTaxes({
          totalGrossIncome: grossIncome,
          transactions: serializableTransactions,
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
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to connect a bank account.", variant: "destructive" });
      return;
    }
    setIsConnecting(true);
    try {
      const generateUrlCallable = httpsCallable(firebaseFunctionsInstance, 'generateFinicityConnectUrl');
      const result = await generateUrlCallable();
      const { connectUrl } = result.data as { connectUrl: string };

      if (!connectUrl) {
          throw new Error("Connect URL not returned from server. Please try again.");
      }
      window.open(connectUrl, '_blank', 'noopener,noreferrer');
    } catch (error: any) {
      console.error("Error launching Finicity Connect:", error);
      toast({
        title: "Connection Setup Failed",
        description: error.message || "Could not start the bank connection process.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTransactionUpdate = async (txnId: string, field: keyof BankTransaction, value: string | boolean | null) => {
    if (!user) return;
    const txnDocRef = doc(db, `users/${user.uid}/bankTransactions`, txnId);
    try {
        await updateDoc(txnDocRef, { [field]: value });
        setTransactions(currentTxns => 
          currentTxns.map(txn => 
            txn.id === txnId ? { ...txn, [field]: value } : txn
          )
        );
    } catch (error) {
        console.error("Failed to update transaction in Firestore:", error);
        toast({ title: "Update Failed", description: "Could not save transaction change.", variant: "destructive" });
    }
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

  // Pagination logic
  const lastItemIndex = currentPage * itemsPerPage;
  const firstItemIndex = lastItemIndex - itemsPerPage;
  const currentTransactions = transactions.slice(firstItemIndex, lastItemIndex);
  const totalPages = Math.ceil(transactions.length / itemsPerPage);

  const transactionCategories = [ "Client Payment", "Software", "Travel", "Meals & Entertainment", "Office Supplies", "Marketing", "Other" ];

  return (
    <>
      <PageHeader
        title="Banking & Taxes"
        description="Connect bank accounts, categorize transactions, and estimate your taxes."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
            <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Landmark className="h-6 w-6 text-primary" /> Bank Connections</CardTitle>
                  <CardDescription>Securely connect your bank accounts to automatically import transactions.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                  {isLoadingAccounts ? (
                      <div className="flex items-center justify-center h-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                  ) : accounts.length > 0 ? (
                      accounts.map(acc => (
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
                      ))
                  ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">No bank accounts connected yet.</p>
                  )}
                  <Button onClick={handleConnectFinicity} className="w-full sm:w-auto" disabled={isConnecting}>
                    {isConnecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting...</> : <><PlusCircle className="mr-2 h-4 w-4" />Connect New Account</>}
                  </Button>
                  <p className="text-xs text-muted-foreground">Verza uses secure partners like Finicity to link your accounts. Your credentials are never stored by Verza.</p>
              </CardContent>
            </Card>

            <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /> Transactions</CardTitle>
                <CardDescription>AI has automatically categorized your transactions. Review and adjust as needed.</CardDescription>
            </CardHeader>
            <CardContent>
                {(isLoadingTransactions || isClassifying) ? (
                <div className="flex items-center justify-center h-48">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="ml-3 text-muted-foreground">{isClassifying ? 'AI is classifying your transactions...' : 'Loading transactions...'}</p>
                </div>
                ) : transactions.length > 0 ? (
                <>
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[200px]">Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center w-[120px]">Tax Deductible</TableHead>
                    <TableHead className="w-[250px]">Receipt</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {currentTransactions.map(txn => (
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
                        <TableCell>
                        <Select
                            value={txn.linkedReceiptId || 'no-receipt-linked'}
                            onValueChange={(receiptId) => handleTransactionUpdate(txn.id, 'linkedReceiptId', receiptId === 'no-receipt-linked' ? null : receiptId)}
                        >
                            <SelectTrigger>
                            <SelectValue placeholder="Link a receipt..." />
                            </SelectTrigger>
                            <SelectContent>
                            <SelectItem value="no-receipt-linked">
                                <span className="text-muted-foreground">No Receipt</span>
                            </SelectItem>
                            {userReceipts.map((receipt) => (
                                <SelectItem key={receipt.id} value={receipt.id}>
                                {receipt.description} - ${receipt.amount?.toFixed(2)}
                                </SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
                </Table>
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {firstItemIndex + 1} to {Math.min(lastItemIndex, transactions.length)} of {transactions.length} transactions.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
                </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-10">No transactions found for the connected accounts.</p>
                )}
            </CardContent>
            </Card>
        </div>
        <div className="lg:col-span-1 space-y-8">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-center">
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
      </div>
    </>
  );
}


"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, getDocs, Timestamp } from '@/lib/firebase';
import type { Contract } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, FileStack, ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface PayerInfo {
  name: string;
  totalPaid: number;
  lastPaymentDate: Date;
  address?: string;
  tin?: string;
  contractCount: number;
}

export default function TaxFormsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [payers, setPayers] = useState<Map<string, PayerInfo>>(new Map());
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());

  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => (currentYear - i).toString());
  }, []);

  useEffect(() => {
    if (user && !authLoading) {
      setIsLoadingData(true);
      const fetchPaidContracts = async () => {
        try {
          const contractsCol = collection(db, 'contracts');
          const q = query(
            contractsCol,
            where('userId', '==', user.uid),
            where('invoiceStatus', '==', 'paid')
          );
          const contractSnapshot = await getDocs(q);
          const fetchedContracts: Contract[] = contractSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract));

          const yearToFilter = parseInt(selectedYear, 10);
          const payersMap = new Map<string, PayerInfo>();

          fetchedContracts.forEach(c => {
            const paidDate = c.updatedAt instanceof Timestamp ? c.updatedAt.toDate() : null;
            if (paidDate && paidDate.getFullYear() === yearToFilter) {
              const brandName = c.brand || "Unknown Brand";
              const existingPayer = payersMap.get(brandName) || {
                name: brandName,
                totalPaid: 0,
                lastPaymentDate: new Date(0),
                contractCount: 0,
              };

              existingPayer.totalPaid += c.amount;
              existingPayer.contractCount += 1;
              if (paidDate > existingPayer.lastPaymentDate) {
                existingPayer.lastPaymentDate = paidDate;
                existingPayer.address = c.clientAddress || existingPayer.address;
                existingPayer.tin = c.clientTin || existingPayer.tin;
              }
              payersMap.set(brandName, existingPayer);
            }
          });
          setPayers(payersMap);
        } catch (error) {
          console.error("Error fetching paid contracts:", error);
          setPayers(new Map());
        } finally {
          setIsLoadingData(false);
        }
      };
      fetchPaidContracts();
    } else if (!authLoading && !user) {
      setIsLoadingData(false);
    }
  }, [user, authLoading, selectedYear]);

  const sortedPayers = useMemo(() => {
    return Array.from(payers.values()).sort((a, b) => b.totalPaid - a.totalPaid);
  }, [payers]);
  
  if (authLoading) {
     return <div className="space-y-4"><PageHeader title="Tax Forms" description="Loading..." /><Skeleton className="h-64 w-full" /></div>
  }
  
  if (!user) {
     return <div className="flex flex-col items-center justify-center h-full pt-10"><AlertCircle className="w-12 h-12 text-primary mb-4" /><p className="text-xl text-muted-foreground">Please log in to view your tax forms.</p></div>
  }

  const canGenerateForms = user.displayName && user.address && user.tin;

  return (
    <>
      <PageHeader
        title="Tax Forms"
        description="Generate draft 1099-NEC forms for your clients based on payments received."
      />
      <div className="space-y-6">
        {!canGenerateForms && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Recipient Information Incomplete</AlertTitle>
            <AlertDescription>
              To generate a 1099 form, you must have your full name, address, and Taxpayer ID (TIN) filled out in your profile.
              <Button asChild variant="link" className="p-0 h-auto ml-1 text-destructive">
                <Link href="/profile">Update your profile</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle>1099-NEC Generation</CardTitle>
                <CardDescription>Clients who have paid you in the selected year.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Tax Year:</span>
                 <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableYears.map(year => (
                      <SelectItem key={year} value={year}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingData ? (
                <div className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            ) : sortedPayers.length > 0 ? (
              <div className="space-y-3">
                {sortedPayers.map(payer => {
                  const queryParams = new URLSearchParams({
                    payerName: payer.name,
                    payerAddress: payer.address || "",
                    payerTin: payer.tin || "",
                    recipientName: user.displayName || "",
                    recipientAddress: user.address || "",
                    recipientTin: user.tin || "",
                    amount: payer.totalPaid.toString(),
                    year: selectedYear,
                  });

                  return (
                    <div key={payer.name} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-4">
                      <div>
                        <h3 className="font-semibold text-lg">{payer.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          Total Paid: <span className="font-medium text-green-600">${payer.totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> from {payer.contractCount} contract(s).
                        </p>
                      </div>
                       <Button asChild disabled={!canGenerateForms} >
                          <Link href={`/tax-forms/1099-nec?${queryParams.toString()}`}>
                              Generate 1099 Draft <ArrowRight className="ml-2 h-4 w-4" />
                          </Link>
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10">
                <FileStack className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">No Paid Invoices Found</h3>
                <p className="mt-1 text-sm text-muted-foreground">No payments were recorded for the selected year ({selectedYear}).</p>
              </div>
            )}
          </CardContent>
        </Card>

         <Alert variant="default" className="mt-6 border-amber-500/50 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200">
          <AlertCircle className="h-4 w-4 !text-amber-600 dark:!text-amber-400" />
          <AlertTitle className="font-semibold">Disclaimer</AlertTitle>
          <AlertDescription>
            The generated forms are for informational purposes only and are not official IRS documents. They are meant to help you consolidate payment information. Always consult with a qualified tax professional for tax advice and official filings.
          </AlertDescription>
        </Alert>
      </div>
    </>
  );
}

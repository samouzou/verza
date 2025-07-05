
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
import { AlertCircle, FileStack, ArrowRight, DollarSign } from "lucide-react";
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
  const [totalYearlyIncome, setTotalYearlyIncome] = useState(0);

  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => (currentYear - i).toString());
  }, []);

  useEffect(() => {
    if (user && !authLoading) {
      setIsLoadingData(true);
      setTotalYearlyIncome(0); // Reset for new selection
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
          let yearlyIncome = 0;

          fetchedContracts.forEach(c => {
            const paidDate = c.updatedAt instanceof Timestamp ? c.updatedAt.toDate() : null;
            if (paidDate && paidDate.getFullYear() === yearToFilter) {
              yearlyIncome += c.amount;
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
          setTotalYearlyIncome(yearlyIncome);
        } catch (error) {
          console.error("Error fetching paid contracts:", error);
          setPayers(new Map());
          setTotalYearlyIncome(0);
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
     return <div className="space-y-4"><PageHeader title="Tax Summaries" description="Loading..." /><Skeleton className="h-64 w-full" /></div>
  }
  
  if (!user) {
     return <div className="flex flex-col items-center justify-center h-full pt-10"><AlertCircle className="w-12 h-12 text-primary mb-4" /><p className="text-xl text-muted-foreground">Please log in to view your tax summaries.</p></div>
  }

  return (
    <>
      <PageHeader
        title="Tax Summaries"
        description="Generate annual income summaries for each client to assist with your tax preparation."
      />
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base font-semibold">
                            <DollarSign className="h-5 w-5 text-primary" />
                            Total Recorded Income for {selectedYear}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoadingData ? (
                        <Skeleton className="h-10 w-48" />
                        ) : (
                        <p className="text-3xl font-bold text-green-600">
                            ${totalYearlyIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                        Sum of all invoices marked as 'paid' within the selected tax year.
                        </p>
                    </CardContent>
                </Card>
            </div>
             <div className="lg:col-span-2 flex items-end justify-end">
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
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Income by Payer</CardTitle>
            <CardDescription>Breakdown of payments received from each client in {selectedYear}.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingData ? (
                <div className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            ) : sortedPayers.length > 0 ? (
              <div className="space-y-3">
                {sortedPayers.map(payer => {
                  return (
                    <div key={payer.name} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-4">
                      <div>
                        <h3 className="font-semibold text-lg">{payer.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          Total Paid: <span className="font-medium text-green-600">${payer.totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> from {payer.contractCount} contract(s).
                        </p>
                      </div>
                       <Button asChild>
                          <Link href={`/tax-forms/summary?payer=${encodeURIComponent(payer.name)}&year=${selectedYear}`}>
                            Generate Summary <ArrowRight className="ml-2 h-4 w-4" />
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
          <AlertTitle className="font-semibold">For Your Records</AlertTitle>
          <AlertDescription>
            These summaries are for informational purposes to help you and your accountant with tax preparation. They are not official IRS documents.
          </AlertDescription>
        </Alert>
      </div>
    </>
  );
}

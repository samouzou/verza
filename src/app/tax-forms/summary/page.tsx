"use client";

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import { db, collection, query, where, getDocs, Timestamp } from '@/lib/firebase';
import type { Contract } from "@/types";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { IncomeSummaryReport } from '@/components/tax-forms/income-summary-report';

function IncomeSummaryContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, isLoading: authLoading } = useAuth();
  
    const payerName = searchParams.get('payer');
    const year = searchParams.get('year');
  
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [totalIncome, setTotalIncome] = useState(0);
    const [isLoadingData, setIsLoadingData] = useState(true);

    useEffect(() => {
        if (user && !authLoading && payerName && year) {
          setIsLoadingData(true);
          const fetchPaidContracts = async () => {
            try {
              const yearToFilter = parseInt(year, 10);
              const contractsCol = collection(db, 'contracts');
              const q = query(
                contractsCol,
                where('userId', '==', user.uid),
                where('brand', '==', payerName),
                where('invoiceStatus', '==', 'paid')
              );
              const contractSnapshot = await getDocs(q);

              let relevantContracts: Contract[] = [];
              let incomeSum = 0;

              contractSnapshot.docs.forEach(doc => {
                  const data = doc.data() as Omit<Contract, 'id'>;
                  let paidDate: Date | null = null;
                  if (data.updatedAt) {
                      if (data.updatedAt instanceof Timestamp) {
                          paidDate = data.updatedAt.toDate();
                      } else if (typeof (data.updatedAt as any).seconds === 'number') {
                          paidDate = new Timestamp((data.updatedAt as any).seconds, (data.updatedAt as any).nanoseconds).toDate();
                      }
                  }
                  
                  if (paidDate && paidDate.getFullYear() === yearToFilter) {
                      relevantContracts.push({ id: doc.id, ...data } as Contract);
                      incomeSum += data.amount;
                  }
              });
              
              relevantContracts.sort((a,b) => (b.updatedAt?.toDate().getTime() ?? 0) - (a.updatedAt?.toDate().getTime() ?? 0));
              setContracts(relevantContracts);
              setTotalIncome(incomeSum);

            } catch (error) {
              console.error("Error fetching contracts for summary:", error);
              setContracts([]);
              setTotalIncome(0);
            } finally {
              setIsLoadingData(false);
            }
          };
          fetchPaidContracts();
        } else if (!authLoading && !user) {
            router.push('/login');
        }
    }, [user, authLoading, payerName, year, router]);

    if (authLoading || isLoadingData) {
        return <Skeleton className="h-[500px] w-full max-w-4xl mx-auto" />;
    }

    if (!payerName || !year) {
        return (
            <div className="text-center py-10">
                <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
                <h3 className="mt-4 text-lg font-medium">Invalid Parameters</h3>
                <p className="mt-1 text-sm text-muted-foreground">Payer name or year is missing. Please return to the previous page and try again.</p>
            </div>
        );
    }
    
    if (contracts.length === 0) {
       return (
            <div className="text-center py-10">
                <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">No Data Found</h3>
                <p className="mt-1 text-sm text-muted-foreground">No paid transactions found for {payerName} in {year}.</p>
            </div>
       );
    }

    return (
        <IncomeSummaryReport 
            payerName={payerName}
            year={year}
            creator={user}
            contracts={contracts}
            totalIncome={totalIncome}
        />
    );
}


export default function IncomeSummaryPage() {
    const router = useRouter();
    return (
        <>
            <PageHeader
                title="Income Summary Report"
                description="A detailed summary of income received from a specific client for tax purposes."
                actions={
                <Button variant="outline" onClick={() => router.push('/tax-forms')}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Summaries
                </Button>
                }
                className="hide-on-print"
            />
            <Suspense fallback={<div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
                <IncomeSummaryContent />
            </Suspense>
        </>
    );
}

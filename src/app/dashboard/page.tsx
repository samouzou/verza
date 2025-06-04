
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from 'next/navigation';
import type { DateRange } from "react-day-picker";
import confetti from 'canvas-confetti';
import Link from 'next/link';

import { PageHeader } from "@/components/page-header";
import { EarningsChart } from "@/components/dashboard/earnings-chart";
import { AtRiskPayments } from "@/components/dashboard/at-risk-payments";
import { UpcomingIncomeList } from "@/components/dashboard/upcoming-income";
import { DashboardFilters, type DashboardFilterState } from "@/components/dashboard/dashboard-filters";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DollarSign, FileText, AlertCircle, CalendarCheck, Loader2, AlertTriangle, FileSpreadsheet, CheckCircle as CheckCircleIcon, Sparkles, ExternalLink, TrendingUp } from "lucide-react"; 
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, getDocs, Timestamp } from '@/lib/firebase';
import type { Contract, EarningsDataPoint, UpcomingIncome, AtRiskPayment } from "@/types";
// MOCK_EARNINGS_DATA is no longer needed
import { Skeleton } from "@/components/ui/skeleton";

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

interface DashboardStats {
  totalPendingIncome: number;
  upcomingIncomeCount: number;
  totalContractsCount: number;
  atRiskPaymentsCount: number;
  totalOverdueCount: number;
  paidThisMonthAmount: number;
  invoicedThisMonthAmount: number; // For summary card
  upcomingIncomeList: UpcomingIncome[];
  atRiskPaymentsList: AtRiskPayment[];
  earningsChartData: EarningsDataPoint[];
}

const initialFilterState: DashboardFilterState = {
  brand: "all",
  project: "all",
  dateRange: undefined,
};

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [allContracts, setAllContracts] = useState<Contract[]>([]);
  const [filters, setFilters] = useState<DashboardFilterState>(initialFilterState);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [availableProjects, setAvailableProjects] = useState<string[]>([]);

  useEffect(() => {
    if (searchParams.get('subscription_success') === 'true') {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
      });
      router.replace('/dashboard', { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (user && !authLoading) {
      setIsLoadingData(true);
      const fetchAllContracts = async () => {
        try {
          const contractsCol = collection(db, 'contracts');
          const q = query(contractsCol, where('userId', '==', user.uid));
          const contractSnapshot = await getDocs(q);
          
          const fetchedContracts: Contract[] = contractSnapshot.docs.map(docSnap => {
            const data = docSnap.data();
            let createdAt = data.createdAt;
            if (createdAt && !(createdAt instanceof Timestamp)) {
              if (createdAt.seconds && typeof createdAt.seconds === 'number') {
                createdAt = new Timestamp(createdAt.seconds, createdAt.nanoseconds || 0);
              } else { createdAt = Timestamp.now(); }
            } else if (!createdAt) {
              createdAt = Timestamp.now();
            }

            let updatedAt = data.updatedAt;
            if (updatedAt && !(updatedAt instanceof Timestamp)) {
              if (updatedAt.seconds && typeof updatedAt.seconds === 'number') {
                updatedAt = new Timestamp(updatedAt.seconds, updatedAt.nanoseconds || 0);
              } else if (typeof updatedAt === 'string') { 
                updatedAt = Timestamp.fromDate(new Date(updatedAt));
              }
            }
            
            return { 
              id: docSnap.id, 
              ...data,
              createdAt: createdAt,
              updatedAt: updatedAt,
              invoiceStatus: data.invoiceStatus || 'none',
            } as Contract;
          });
          setAllContracts(fetchedContracts);

          const brands = new Set<string>();
          const projects = new Set<string>();
          fetchedContracts.forEach(c => {
            if (c.brand) brands.add(c.brand);
            if (c.projectName) projects.add(c.projectName);
          });
          setAvailableBrands(Array.from(brands).sort());
          setAvailableProjects(Array.from(projects).sort());

        } catch (error) {
          console.error("Error fetching all contracts:", error);
          setAllContracts([]);
        } finally {
          setIsLoadingData(false);
        }
      };
      fetchAllContracts();
    } else if (!authLoading && !user) {
      setAllContracts([]);
      setIsLoadingData(false);
    }
  }, [user, authLoading]);

  useEffect(() => {
    if (isLoadingData || !user) return;

    const filteredContracts = allContracts.filter(c => {
      const brandMatch = filters.brand === "all" || c.brand === filters.brand;
      const projectMatch = filters.project === "all" || c.projectName === filters.project;
      
      let dateMatch = true;
      // Date filter should apply to dueDate for pending/upcoming items
      // and updatedAt for paid items if we want to filter by payment date.
      // For simplicity here, we'll primarily filter based on dueDate for items shown in lists.
      // The chart and monthly summaries will do their own monthly aggregation.
      if (c.dueDate && filters.dateRange?.from) { 
        const contractDueDate = new Date(c.dueDate + 'T00:00:00'); 
        const fromDate = new Date(filters.dateRange.from.getFullYear(), filters.dateRange.from.getMonth(), filters.dateRange.from.getDate());
        
        if (filters.dateRange.to) {
          const toDate = new Date(filters.dateRange.to.getFullYear(), filters.dateRange.to.getMonth(), filters.dateRange.to.getDate(), 23, 59, 59);
          dateMatch = contractDueDate >= fromDate && contractDueDate <= toDate;
        } else { 
          const fromDateEnd = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 23, 59, 59);
          dateMatch = contractDueDate >= fromDate && contractDueDate <= fromDateEnd;
        }
      }
      return brandMatch && projectMatch && dateMatch;
    });
    
    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const sevenDaysFromTodayMidnight = addDays(todayMidnight, 7);
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    const upcomingIncomeSource: UpcomingIncome[] = [];
    const atRiskPaymentsListSource: AtRiskPayment[] = [];
    let totalPendingIncomeCalc = 0;
    let currentPaidThisMonthAmount = 0;
    let currentInvoicedThisMonthAmountForSummary = 0; // For summary card
    let currentTotalOverdueCountCalc = 0;

    // Initialize chart data for current year
    const newEarningsChartData: EarningsDataPoint[] = monthNames.map(monthName => ({
      month: monthName,
      year: currentYear,
      collected: 0,
      invoiced: 0,
    }));

    filteredContracts.forEach(c => {
      const contractDueDate = c.dueDate ? new Date(c.dueDate + 'T00:00:00') : null;
      const invoiceStatus = c.invoiceStatus || 'none';
      const updatedAtDate = c.updatedAt instanceof Timestamp ? c.updatedAt.toDate() : (c.updatedAt ? new Date(c.updatedAt as any) : null);
      
      let isEffectivelyOverdue = false;
      if (invoiceStatus === 'overdue') {
        isEffectivelyOverdue = true;
      } else if ((invoiceStatus === 'sent' || invoiceStatus === 'viewed') && contractDueDate && contractDueDate < todayMidnight) {
        isEffectivelyOverdue = true;
      } else if (c.status === 'overdue' && invoiceStatus !== 'paid') {
         isEffectivelyOverdue = true;
      }


      if (isEffectivelyOverdue) {
        currentTotalOverdueCountCalc++;
        atRiskPaymentsListSource.push({
          id: c.id, brand: c.brand, amount: c.amount, dueDate: c.dueDate,
          status: 'overdue', riskReason: 'Payment overdue', projectName: c.projectName,
        });
      } else if ((invoiceStatus === 'sent' || invoiceStatus === 'viewed' || c.status === 'pending') && invoiceStatus !== 'paid' && contractDueDate && contractDueDate >= todayMidnight && contractDueDate < sevenDaysFromTodayMidnight) {
         atRiskPaymentsListSource.push({
          id: c.id, brand: c.brand, amount: c.amount, dueDate: c.dueDate,
          status: c.status, 
          riskReason: 'Due soon', 
          projectName: c.projectName,
        });
      }

      if ((invoiceStatus === 'sent' || invoiceStatus === 'viewed' || c.status === 'pending') && invoiceStatus !== 'paid' && contractDueDate && contractDueDate >= todayMidnight) {
        upcomingIncomeSource.push({ id: c.id, brand: c.brand, amount: c.amount, dueDate: c.dueDate, projectName: c.projectName });
        totalPendingIncomeCalc += c.amount;
      }
      
      // Calculate for chart and monthly summaries
      if (invoiceStatus === 'paid' && updatedAtDate && updatedAtDate.getFullYear() === currentYear) {
        const paymentMonth = updatedAtDate.getMonth();
        newEarningsChartData[paymentMonth].collected += c.amount;
        if (paymentMonth === currentMonth) {
          currentPaidThisMonthAmount += c.amount;
        }
      }
      
      if ((invoiceStatus === 'sent' || invoiceStatus === 'viewed') && invoiceStatus !== 'paid' && contractDueDate && contractDueDate.getFullYear() === currentYear) {
        const dueMonth = contractDueDate.getMonth();
        newEarningsChartData[dueMonth].invoiced += c.amount;
        if (dueMonth === currentMonth) {
          currentInvoicedThisMonthAmountForSummary += c.amount;
        }
      }
    });
    
    upcomingIncomeSource.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    atRiskPaymentsListSource.sort((a, b) => {
      const aIsOverdue = a.status === 'overdue';
      const bIsOverdue = b.status === 'overdue';
      if (aIsOverdue && !bIsOverdue) return -1;
      if (!aIsOverdue && bIsOverdue) return 1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    setStats({
      totalPendingIncome: totalPendingIncomeCalc,
      upcomingIncomeCount: upcomingIncomeSource.length,
      totalContractsCount: allContracts.length, 
      atRiskPaymentsCount: atRiskPaymentsListSource.length,
      totalOverdueCount: currentTotalOverdueCountCalc,
      paidThisMonthAmount: currentPaidThisMonthAmount,
      invoicedThisMonthAmount: currentInvoicedThisMonthAmountForSummary,
      upcomingIncomeList: upcomingIncomeSource,
      atRiskPaymentsList: atRiskPaymentsListSource,
      earningsChartData: newEarningsChartData, 
    });

  }, [allContracts, filters, user, isLoadingData]);

  const handleFiltersChange = useCallback((newFilters: DashboardFilterState) => {
    setFilters(newFilters);
  }, []);

  if (authLoading || (isLoadingData && user)) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="Overview of your earnings, contracts, and payment timelines."
        />
        <DashboardFilters 
          availableBrands={availableBrands} 
          availableProjects={availableProjects} 
          onFiltersChange={handleFiltersChange}
          initialFilters={initialFilterState} 
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mb-6">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Skeleton className="h-[350px] w-full" />
          </div>
          <div className="lg:col-span-1 space-y-6">
            <Skeleton className="h-[200px] w-full" />
          </div>
        </div>
        <div className="mt-6">
          <Skeleton className="h-[200px] w-full" />
        </div>
      </>
    );
  }

  if (!user) {
     return (
        <div className="flex flex-col items-center justify-center h-full pt-10">
            <AlertCircle className="w-12 h-12 text-primary mb-4" />
            <p className="text-xl text-muted-foreground">Please log in to view your dashboard.</p>
        </div>
     )
  }
  
  if (!stats && !isLoadingData) {
    return (
      <div className="flex flex-col items-center justify-center h-full pt-10">
         <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Could not load dashboard data.</h2>
        <p className="text-muted-foreground">Please try refreshing the page or check your connection.</p>
      </div>
    );
  }
  
  if (!stats) return null; 

  const showSubscriptionCTA = user && user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'trialing';

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of your earnings, contracts, and payment timelines."
      />

      {showSubscriptionCTA && (
        <Alert className="mb-6 border-primary/50 bg-primary/5 text-primary-foreground [&>svg]:text-primary">
          <Sparkles className="h-5 w-5" />
          <AlertTitle className="font-semibold text-primary">Unlock Full Potential!</AlertTitle>
          <AlertDescription className="text-primary/90">
            {user.subscriptionStatus === 'canceled' ? 'Your Verza Pro subscription is canceled.' : 
             user.subscriptionStatus === 'past_due' ? 'Your Verza Pro subscription payment is past due.' :
             'You are currently on the free plan.'}
            {' '}Upgrade to Verza Pro to access all features and manage your creator business seamlessly.
          </AlertDescription>
          <div className="mt-3">
            <Button variant="default" size="sm" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/settings">
                {user.subscriptionStatus === 'canceled' || user.subscriptionStatus === 'past_due' ? 'Manage Subscription' : 'Upgrade to Pro'}
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </Alert>
      )}
      
      <DashboardFilters 
        availableBrands={availableBrands} 
        availableProjects={availableProjects} 
        onFiltersChange={handleFiltersChange}
        initialFilters={filters}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mb-6">
        <SummaryCard 
          title="Pending Income (Filtered)" 
          value={`$${stats.totalPendingIncome.toLocaleString()}`}
          icon={DollarSign}
          description={`${stats.upcomingIncomeCount} upcoming payments`}
        />
        <SummaryCard 
          title="Total Active Contracts" 
          value={stats.totalContractsCount.toString()}
          icon={FileText}
          description="All contracts managed"
        />
         <SummaryCard 
          title="Invoiced This Month" 
          value={`$${stats.invoicedThisMonthAmount.toLocaleString()}`}
          icon={FileSpreadsheet}
          description="Based on invoices sent/viewed this month"
        />
        <SummaryCard 
          title="Collected This Month" 
          value={`$${stats.paidThisMonthAmount.toLocaleString()}`}
          icon={CheckCircleIcon} 
          description="Based on invoices paid this month"
        />
        <SummaryCard 
          title="Payments At Risk (Filtered)" 
          value={stats.atRiskPaymentsCount.toString()}
          icon={AlertCircle}
          description={`${stats.totalOverdueCount} overdue`}
          className={stats.atRiskPaymentsCount > 0 ? "border-destructive text-destructive dark:border-destructive/70" : ""}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EarningsChart data={stats.earningsChartData} />
        </div>
        <div className="lg:col-span-1 space-y-6">
           <UpcomingIncomeList incomeSources={stats.upcomingIncomeList.slice(0,5)} />
        </div>
      </div>

      <div className="mt-6">
        <AtRiskPayments payments={stats.atRiskPaymentsList} />
      </div>
    </>
  );
}

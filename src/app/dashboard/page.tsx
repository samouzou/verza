
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from 'next/navigation';
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
import { 
  DollarSign, 
  FileText, 
  AlertCircle, 
  Loader2, 
  AlertTriangle, 
  FileSpreadsheet, 
  CheckCircle as CheckCircleIcon, 
  Sparkles, 
  ExternalLink, 
  CalendarClock, 
  LifeBuoy,
  Video,
  Zap
} from "lucide-react"; 
import { useAuth, type UserProfile } from "@/hooks/use-auth";
import { db, collection, query, where, doc, onSnapshot, Timestamp } from '@/lib/firebase';
import type { Contract, EarningsDataPoint, UpcomingIncome, AtRiskPayment, Agency, Gig } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useTour } from "@/hooks/use-tour";
import { dashboardTour } from "@/lib/tours";
import { SetupGuideCard } from "@/components/dashboard/setup-guide-card";
import { trackEvent } from "@/lib/analytics";

interface DashboardStats {
  totalPendingIncome: number;
  upcomingIncomeCount: number;
  totalContractsCount: number;
  atRiskPaymentsCount: number;
  totalOverdueCount: number;
  paidThisMonthAmount: number;
  invoicedThisMonthAmount: number;
  activeGigsCount: number;
  marketplaceEarnings: number;
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
  const { startTour } = useTour();

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [allContracts, setAllContracts] = useState<Contract[]>([]);
  const [allGigs, setAllGigs] = useState<Gig[]>([]);
  const [filters, setFilters] = useState<DashboardFilterState>(initialFilterState);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [availableProjects, setAvailableProjects] = useState<string[]>([]);
  
  const [subscriptionUser, setSubscriptionUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (searchParams.get('subscription_success') === 'true') {
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      
      // Track conversion
      trackEvent({
        action: 'subscription_success',
        category: 'revenue',
        label: user?.subscriptionPlanId || 'pro_plan'
      });

      router.replace('/dashboard', { scroll: false });
    }
  }, [searchParams, router, user]);

  useEffect(() => {
    if (!user || authLoading) {
      if (!authLoading) setIsLoadingData(false);
      return;
    }

    setIsLoadingData(true);
    const isTeamMember = (user.role === 'agency_admin' || user.role === 'agency_member') && user.primaryAgencyId;
    
    let unsubOwner: (() => void) | undefined;
    let unsubAgency: (() => void) | undefined;

    if (isTeamMember) {
      const agencyRef = doc(db, 'agencies', user.primaryAgencyId!);
      unsubAgency = onSnapshot(agencyRef, (agencySnap) => {
        if (agencySnap.exists()) {
          const ownerDocRef = doc(db, 'users', (agencySnap.data() as Agency).ownerId);
          if (unsubOwner) unsubOwner();
          unsubOwner = onSnapshot(ownerDocRef, (ownerDocSnap) => {
            setSubscriptionUser(ownerDocSnap.exists() ? ownerDocSnap.data() as UserProfile : user);
          });
        } else { setSubscriptionUser(user); }
      });
    } else { setSubscriptionUser(user); }
    
    const contractsQ = query(collection(db, 'contracts'), where(`access.${user.uid}`, 'in', ['owner', 'viewer', 'talent']));
    const unsubscribeContracts = onSnapshot(contractsQ, (snapshot) => {
      const fetched = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Contract));
      setAllContracts(fetched);
      
      const brands = new Set<string>();
      const projects = new Set<string>();
      fetched.forEach(c => {
        if (c.brand) brands.add(c.brand);
        if (c.projectName) projects.add(c.projectName);
      });
      setAvailableBrands(Array.from(brands).sort());
      setAvailableProjects(Array.from(projects).sort());
    });

    const gigsQ = query(collection(db, 'gigs'));
    const unsubscribeGigs = onSnapshot(gigsQ, (snapshot) => {
      const fetched = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Gig))
        .filter(g => g.brandId === user.primaryAgencyId || g.acceptedCreatorIds?.includes(user.uid));
      setAllGigs(fetched);
      setIsLoadingData(false);
    });

    return () => {
      unsubscribeContracts();
      unsubscribeGigs();
      if (unsubAgency) unsubAgency();
      if (unsubOwner) unsubOwner();
    };
  }, [user, authLoading]);

  useEffect(() => {
    if (isLoadingData || !user) return;

    const filteredContracts = allContracts.filter(c => {
      const brandMatch = filters.brand === "all" || c.brand === filters.brand;
      const projectMatch = filters.project === "all" || c.projectName === filters.project;
      let dateMatch = true;
      if (c.dueDate && filters.dateRange?.from) {
        const contractDueDate = new Date(c.dueDate + 'T00:00:00');
        const from = filters.dateRange.from;
        const to = filters.dateRange.to || from;
        dateMatch = contractDueDate >= from && contractDueDate <= to;
      }
      return brandMatch && projectMatch && dateMatch;
    });
    
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const currentYear = todayMidnight.getFullYear();

    const upcomingIncomeSource: UpcomingIncome[] = [];
    const atRiskPaymentsListSource: AtRiskPayment[] = [];
    let totalPendingIncomeCalc = 0;
    let currentPaidThisMonthAmount = 0;
    let currentInvoicedThisMonthAmount = 0;
    let currentTotalOverdueCount = 0;
    let marketplaceEarningsCalc = 0;

    const newEarningsChartData: EarningsDataPoint[] = monthNames.map(name => ({
      month: name, year: currentYear, collected: 0, invoiced: 0,
    } as any));

    filteredContracts.forEach(c => {
      const contractDueDate = c.dueDate ? new Date(c.dueDate + 'T00:00:00') : null;
      const isOverdue = (c.invoiceStatus === 'overdue') || (['sent', 'viewed'].includes(c.invoiceStatus || '') && 
        contractDueDate && contractDueDate < todayMidnight);

      if (isOverdue) {
        currentTotalOverdueCount++;
        atRiskPaymentsListSource.push({ ...c, riskReason: 'Payment overdue' } as any);
      }

      if (['sent', 'viewed', 'pending'].includes(c.invoiceStatus || 'pending') && 
        c.invoiceStatus !== 'paid' && contractDueDate && contractDueDate >= todayMidnight) {
        upcomingIncomeSource.push(c as any);
        totalPendingIncomeCalc += c.amount;
      }
      
      if (c.invoiceStatus === 'paid') {
        const date = (c.updatedAt as Timestamp).toDate();
        if (date.getFullYear() === currentYear) {
          newEarningsChartData[date.getMonth()].collected += c.amount;
          if (date.getMonth() === todayMidnight.getMonth()) currentPaidThisMonthAmount += c.amount;
        }
      }

      c.invoiceHistory?.forEach(event => {
        if (event.action === 'Invoice Sent to Client') {
          const date = event.timestamp.toDate();
          if (date.getFullYear() === currentYear) {
            newEarningsChartData[date.getMonth()].invoiced += c.amount;
            if (date.getMonth() === todayMidnight.getMonth()) currentInvoicedThisMonthAmount += c.amount;
          }
        }
      });
    });

    const activeGigs = allGigs.filter(g => g.status === 'open' || g.status === 'in-progress');
    allGigs.forEach(g => {
      if (g.status === 'completed' && g.acceptedCreatorIds?.includes(user.uid)) {
        marketplaceEarningsCalc += g.ratePerCreator;
      }
    });

    setStats({
      totalPendingIncome: totalPendingIncomeCalc,
      upcomingIncomeCount: upcomingIncomeSource.length,
      totalContractsCount: allContracts.length, 
      atRiskPaymentsCount: atRiskPaymentsListSource.length,
      totalOverdueCount: currentTotalOverdueCount,
      paidThisMonthAmount: currentPaidThisMonthAmount,
      invoicedThisMonthAmount: currentInvoicedThisMonthAmount,
      activeGigsCount: activeGigs.length,
      marketplaceEarnings: marketplaceEarningsCalc,
      upcomingIncomeList: upcomingIncomeSource.sort((a,b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()),
      atRiskPaymentsList: atRiskPaymentsListSource,
      earningsChartData: newEarningsChartData, 
    } as any);

  }, [allContracts, allGigs, filters, user, isLoadingData]);

  const handleFiltersChange = useCallback((newFilters: DashboardFilterState) => setFilters(newFilters), []);

  if (authLoading || (isLoadingData && user) || !subscriptionUser) {
    return (
      <div className="flex-1 p-8 space-y-8">
        <Skeleton className="h-12 w-1/3" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!user) return <div className="text-center py-20 text-muted-foreground">Please log in to view your dashboard.</div>;
  if (!stats) return null;

  const showSubscriptionCTA = subscriptionUser.subscriptionStatus !== 'active' && 
    subscriptionUser.subscriptionStatus !== 'trialing';

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your unified command center for contracts and deployment activity."
        actions={<Button variant="outline" onClick={() => startTour(dashboardTour)}><LifeBuoy className="mr-2 h-4 w-4" /> Take a Tour</Button>}
      />

      <SetupGuideCard />

      {showSubscriptionCTA && (
        <Alert className="mb-6 border-primary/50 bg-primary/5">
          <Sparkles className="h-5 w-5 text-primary" />
          <AlertTitle className="font-semibold text-primary">Unlock Full Potential!</AlertTitle>
          <AlertDescription>
            Upgrade to Verza Pro to access the Deployment Network and advanced financial tracking.
          </AlertDescription>
          <Button variant="default" size="sm" asChild className="mt-3">
            <Link href="/settings">Manage Subscription <ExternalLink className="ml-2 h-4 w-4" /></Link>
          </Button>
        </Alert>
      )}
      
      <DashboardFilters 
        availableBrands={availableBrands} availableProjects={availableProjects} 
        onFiltersChange={handleFiltersChange} initialFilters={filters}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-6">
        <SummaryCard 
          id="summary-card-active-deployments"
          title="Active Deployments" value={stats.activeGigsCount.toString()} 
          icon={Video} description="Ongoing campaigns" 
        />
        <SummaryCard 
          title="Secured Earnings" value={`$${stats.marketplaceEarnings.toLocaleString()}`}
          icon={Zap} description="Total from network"
        />
        <SummaryCard 
          title="Contract Income" value={`$${stats.totalPendingIncome.toLocaleString()}`}
          icon={DollarSign} description={`${stats.upcomingIncomeCount} pending payments`}
        />
        <SummaryCard 
          title="Invoiced (Mo)" value={`$${stats.invoicedThisMonthAmount.toLocaleString()}`}
          icon={FileSpreadsheet} description="Current month invoices"
        />
        <SummaryCard 
          title="Collected (Mo)" value={`$${stats.paidThisMonthAmount.toLocaleString()}`}
          icon={CheckCircleIcon} description="Net cash in this month"
        />
        <SummaryCard 
          id="summary-card-at-risk"
          title="At Risk" value={stats.atRiskPaymentsCount.toString()} 
          icon={AlertCircle} description={`${stats.totalOverdueCount} overdue`}
          className={stats.atRiskPaymentsCount > 0 ? "border-destructive text-destructive" : ""}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2" id="earnings-chart-container"><EarningsChart data={stats.earningsChartData} /></div>
        <div className="lg:col-span-1"><UpcomingIncomeList incomeSources={stats.upcomingIncomeList.slice(0,5)} /></div>
      </div>

      <div className="mt-6"><AtRiskPayments payments={stats.atRiskPaymentsList} /></div>
    </>
  );
}


"use client";

import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PlusCircle, Loader2, Briefcase, User, Search, Filter, Smartphone, DollarSign, X, LifeBuoy, CheckCircle2, Flame, Zap, Heart } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { Gig } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceCoPilot } from '@/components/marketplace/marketplace-copilot';
import { useTour } from '@/hooks/use-tour';
import { marketplaceTour } from '@/lib/tours';
import { cn } from '@/lib/utils';

const platforms = ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'Twitch', 'LinkedIn'];

function GigCard({ gig, showRole = false, currentUserId }: { gig: Gig; showRole?: boolean; currentUserId?: string }) {
  const isAccepted = currentUserId ? gig.acceptedCreatorIds?.includes(currentUserId) : false;
  const isCompleted = gig.status === 'completed';

  const getStatusLabel = (status: string) => {
    if (status === 'open') {
      if (gig.campaignType === 'cause_campaign') return 'Open for Creators';
      return (gig.ratePerCreator || 0) > 0 ? 'Capital Available' : 'Performance Only';
    }
    if (status === 'pending_payment') return 'Funding Pending';
    if (status === 'in-progress') return 'In Progress';
    if (status === 'completed') return 'Campaign Complete';
    return status?.replace(/_/g, ' ') || 'unknown';
  };

  return (
    <Card className={`flex flex-col min-h-[340px] hover:shadow-md transition-shadow ${isCompleted ? 'opacity-80' : ''} min-w-0`}>
      <CardHeader>
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg line-clamp-1 break-words">{gig.title}</CardTitle>
            <CardDescription className="flex items-center gap-1 mt-1 truncate">
              <Briefcase className="h-3 w-3" /> {gig.brandName}
            </CardDescription>
          </div>
          <Badge variant={gig.status === 'open' ? 'default' : (isCompleted ? 'secondary' : 'secondary')} className={gig.status === 'open' ? 'bg-green-500' : (isCompleted ? 'bg-blue-500/10 text-blue-600 border-blue-200' : '')}>
            {isCompleted && <CheckCircle2 className="mr-1 h-3 w-3 inline" />}
            {getStatusLabel(gig.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-4 min-w-0">
        <div 
          className="text-sm text-muted-foreground line-clamp-3 leading-relaxed break-words prose-sm prose-slate dark:prose-invert max-none overflow-hidden"
          dangerouslySetInnerHTML={{ __html: gig.description }}
        />
        <div className="flex flex-wrap gap-2">
          {gig.platforms?.map(platform => (
            <Badge key={platform} variant="outline" className="text-[10px] uppercase font-bold tracking-wider">
              {platform}
            </Badge>
          ))}
        </div>
        {showRole && (
          <div className="flex items-center gap-2 pt-2 border-t mt-auto">
            {isAccepted && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 gap-1">
                <User className="h-3 w-3" /> Creator
              </Badge>
            )}
            {gig.brandId === currentUserId && (
              <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 gap-1">
                <Briefcase className="h-3 w-3" /> Brand Team
              </Badge>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between items-center border-t pt-4 bg-muted/10">
        <div className="flex flex-col items-start gap-1">
          <div className="text-xl font-bold text-primary">
            {(gig.ratePerCreator || 0) > 0 ? (
              `$${(gig.ratePerCreator || 0).toLocaleString()}`
            ) : gig.campaignType === 'cause_campaign' ? (
              <div className="flex items-center gap-1.5 text-rose-500 text-sm">
                <Heart className="h-4 w-4 fill-rose-500" />
                <span>Volunteer</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-blue-600 text-sm">
                <Zap className="h-4 w-4 fill-blue-600" />
                <span>Performance Pay</span>
              </div>
            )}
          </div>
          {gig.affiliateSettings?.isEnabled && (gig.affiliateSettings?.rewardAmount || 0) > 0 && (
            <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-tight ${gig.campaignType === 'cause_campaign' ? 'text-rose-500' : 'text-blue-600'}`}>
              <Zap className={`h-3 w-3 ${gig.campaignType === 'cause_campaign' ? 'fill-rose-500' : 'fill-blue-600'}`} />
              <span>{gig.campaignType === 'cause_campaign' ? '+ Performance Bonus' : '+ Performance'}</span>
            </div>
          )}
        </div>
        <Button asChild size="sm" variant={isCompleted ? 'outline' : 'default'}>
          <Link href={`/campaigns/${gig.id}`}>
            {isCompleted ? 'View Results' : 'View Details'}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function GigsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { startTour } = useTour();
  const [openGigs, setOpenGigs] = useState<Gig[]>([]);
  const [myGigs, setMyGigs] = useState<Gig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("browse");

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [minRate, setMinRate] = useState("");

  // 1. Fetch "Browse" Gigs (Open ones)
  useEffect(() => {
    if (!user) {
      if (!authLoading) setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    const browseQuery = query(
      collection(db, "gigs"), 
      where("status", "==", "open"), 
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(browseQuery, (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Gig));
      setOpenGigs(fetched);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching open gigs:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user, authLoading]);

  // 2. Fetch "My Gigs"
  useEffect(() => {
    if (!user) return;

    const results = {
      participating: [] as Gig[],
      managing: [] as Gig[],
      secured: [] as Gig[]
    };

    const updateCombinedGigs = () => {
      const combined = new Map<string, Gig>();
      results.participating.forEach(g => combined.set(g.id, g));
      results.managing.forEach(g => combined.set(g.id, g));
      results.secured.forEach(g => combined.set(g.id, g));
      
      const sorted = Array.from(combined.values()).sort((a, b) => 
        (b.createdAt as any)?.toMillis() - (a.createdAt as any)?.toMillis()
      );
      setMyGigs(sorted);
    };

    const isAgencyTeam = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';

    const unsubParticipating = onSnapshot(query(
      collection(db, "gigs"),
      where("acceptedCreatorIds", "array-contains", user.uid)
    ), (snap) => {
      results.participating = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Gig));
      updateCombinedGigs();
    });

    let unsubManaging = () => {};
    if (user.primaryAgencyId && isAgencyTeam) {
      unsubManaging = onSnapshot(query(
        collection(db, "gigs"),
        where("brandId", "==", user.primaryAgencyId)
      ), (snap) => {
        results.managing = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Gig));
        updateCombinedGigs();
      });
    }

    let unsubSecured = () => {};
    if (isAgencyTeam) {
      unsubSecured = onSnapshot(query(
        collection(db, "gigs"),
        where("agentIds", "array-contains", user.uid)
      ), (snap) => {
        results.secured = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Gig));
        updateCombinedGigs();
      });
    }

    return () => {
      unsubParticipating();
      unsubManaging();
      unsubSecured();
    };
  }, [user]);

  const applyFilters = (gigs: Gig[]) => {
    return gigs.filter(gig => {
      const matchesSearch = searchTerm === "" || 
        gig.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        gig.brandName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        gig.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesPlatform = platformFilter === "all" || gig.platforms?.includes(platformFilter as any);
      
      const rateLimit = parseFloat(minRate);
      const matchesRate = isNaN(rateLimit) || (gig.ratePerCreator || 0) >= rateLimit;

      return matchesSearch && matchesPlatform && matchesRate;
    });
  };

  const filteredOpenGigs = useMemo(() => applyFilters(openGigs), [openGigs, searchTerm, platformFilter, minRate]);
  const filteredMyGigs = useMemo(() => applyFilters(myGigs), [myGigs, searchTerm, platformFilter, minRate]);

  const clearFilters = () => {
    setSearchTerm("");
    setPlatformFilter("all");
    setMinRate("");
  };

  const canPostGig = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Discover campaigns or manage your active campaigns."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => startTour(marketplaceTour)}>
              <LifeBuoy className="mr-2 h-4 w-4" /> Take a Tour
            </Button>
            {canPostGig && (
              <Button asChild>
                <Link href="/campaigns/post">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Launch Campaign
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-6 min-w-0">
          {/* Filter Bar */}
          <Card id="marketplace-filters" className="p-4 shadow-sm border-primary/10">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Search className="h-3 w-3" /> Search</Label>
                <Input 
                  placeholder="Search campaigns or brands..." 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Smartphone className="h-3 w-3" /> Platform</Label>
                <Select value={platformFilter} onValueChange={setPlatformFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Platforms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Platforms</SelectItem>
                    {platforms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><DollarSign className="h-3 w-3" /> Min. Rate</Label>
                <Input 
                  type="number" 
                  placeholder="Any amount" 
                  value={minRate} 
                  onChange={e => setMinRate(e.target.value)}
                />
              </div>
              <Button variant="ghost" onClick={clearFilters} className="text-muted-foreground">
                <X className="mr-2 h-4 w-4" /> Clear Filters
              </Button>
            </div>
          </Card>

          <Tabs defaultValue="browse" value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
            <TabsList className="grid w-full grid-cols-2 max-w-[450px]">
              <TabsTrigger value="browse">Browse Campaigns ({filteredOpenGigs.length})</TabsTrigger>
              <TabsTrigger value="my-gigs">My Campaigns ({filteredMyGigs.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="browse" className="space-y-6">
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
                </div>
              ) : filteredOpenGigs.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredOpenGigs.map(gig => <GigCard key={gig.id} gig={gig} currentUserId={user?.uid} />)}
                </div>
              ) : (
                <div className="text-center py-16 border-2 border-dashed rounded-lg bg-muted/5">
                  <Filter className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold">No Campaigns Found</h3>
                  <p className="text-muted-foreground mt-2">Try adjusting your filters or search terms.</p>
                  <Button variant="outline" className="mt-4" onClick={clearFilters}>Reset Filters</Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="my-gigs" className="space-y-6">
              {filteredMyGigs.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredMyGigs.map(gig => (
                    <GigCard 
                      key={gig.id} 
                      gig={gig} 
                      showRole 
                      currentUserId={user?.uid} 
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 border-2 border-dashed rounded-lg bg-muted/5">
                  <h3 className="text-xl font-semibold">{myGigs.length === 0 ? "No Active Campaigns" : "No Matching Campaigns"}</h3>
                  <p className="text-muted-foreground mt-2">
                    {myGigs.length === 0
                      ? "Campaigns you've secured or launched will appear here."
                      : "None of your active campaigns match the current filters."}
                  </p>
                  {myGigs.length > 0 && <Button variant="outline" className="mt-4" onClick={clearFilters}>Reset Filters</Button>}
                  {myGigs.length === 0 && (
                    <Button variant="outline" className="mt-4" onClick={() => setActiveTab("browse")}>
                      Explore Opportunities
                    </Button>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="lg:col-span-1">
          <MarketplaceCoPilot context="browse" className="sticky top-8" />
        </div>
      </div>
    </>
  );
}

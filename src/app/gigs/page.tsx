"use client";

import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PlusCircle, Loader2, Briefcase, User, Search, Filter, Smartphone, DollarSign, X, LifeBuoy, CheckCircle2 } from 'lucide-react';
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

const platforms = ['TikTok', 'Instagram', 'YouTube', 'Facebook'];

function GigCard({ gig, showRole = false, currentUserId }: { gig: Gig; showRole?: boolean; currentUserId?: string }) {
  // Defensive check for acceptedCreatorIds array
  const isAccepted = currentUserId ? gig.acceptedCreatorIds?.includes(currentUserId) : false;
  const isCompleted = gig.status === 'completed';

  return (
    <Card className={`flex flex-col min-h-[340px] hover:shadow-md transition-shadow ${isCompleted ? 'opacity-80' : ''}`}>
      <CardHeader>
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1">
            <CardTitle className="text-lg line-clamp-1">{gig.title}</CardTitle>
            <CardDescription className="flex items-center gap-1 mt-1">
              <Briefcase className="h-3 w-3" /> {gig.brandName}
            </CardDescription>
          </div>
          <Badge variant={gig.status === 'open' ? 'default' : (isCompleted ? 'secondary' : 'secondary')} className={gig.status === 'open' ? 'bg-green-500' : (isCompleted ? 'bg-blue-500/10 text-blue-600 border-blue-200' : '')}>
            {isCompleted && <CheckCircle2 className="mr-1 h-3 w-3 inline" />}
            {gig.status?.replace('_', ' ') || 'unknown'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">{gig.description.replace(/<[^>]*>?/gm, '')}</p>
        <div className="flex flex-wrap gap-2">
          {/* Defensive check for platforms array */}
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
        <div className="text-xl font-bold text-primary">${(gig.ratePerCreator || 0).toLocaleString()}</div>
        <Button asChild size="sm" variant={isCompleted ? 'outline' : 'default'}>
          <Link href={`/gigs/${gig.id}`}>
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

    const participatingQuery = query(
      collection(db, "gigs"),
      where("acceptedCreatorIds", "array-contains", user.uid)
    );

    const managingQuery = user.primaryAgencyId ? query(
      collection(db, "gigs"),
      where("brandId", "==", user.primaryAgencyId)
    ) : null;

    const unsubParticipating = onSnapshot(participatingQuery, (snapshot) => {
      const participatingGigs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Gig));
      
      if (managingQuery) {
        onSnapshot(managingQuery, (brandSnapshot) => {
          const managingGigs = brandSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Gig));
          
          const combined = new Map<string, Gig>();
          participatingGigs.forEach(g => combined.set(g.id, g));
          managingGigs.forEach(g => combined.set(g.id, g));
          
          const sorted = Array.from(combined.values()).sort((a, b) => 
            (b.createdAt as any)?.toMillis() - (a.createdAt as any)?.toMillis()
          );
          setMyGigs(sorted);
        });
      } else {
        setMyGigs(participatingGigs.sort((a, b) => (b.createdAt as any)?.toMillis() - (a.createdAt as any)?.toMillis()));
      }
    });

    return () => {
      unsubParticipating();
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
        title="Marketplace"
        description="Discover paid opportunities or manage your active campaigns."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => startTour(marketplaceTour)}>
              <LifeBuoy className="mr-2 h-4 w-4" /> Take a Tour
            </Button>
            {canPostGig && (
              <Button asChild>
                <Link href="/gigs/post">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Post a New Gig
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-6">
          {/* Filter Bar */}
          <Card id="marketplace-filters" className="p-4 shadow-sm border-primary/10">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Search className="h-3 w-3" /> Search</Label>
                <Input 
                  placeholder="Search gigs or brands..." 
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
            <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
              <TabsTrigger value="browse">Browse Gigs ({filteredOpenGigs.length})</TabsTrigger>
              <TabsTrigger value="my-gigs">My Gigs ({filteredMyGigs.length})</TabsTrigger>
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
                  <h3 className="text-xl font-semibold">No Gigs Found</h3>
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
                  <h3 className="text-xl font-semibold">{myGigs.length === 0 ? "No Active Gigs" : "No Matching Gigs"}</h3>
                  <p className="text-muted-foreground mt-2">
                    {myGigs.length === 0 
                      ? "Gigs you've accepted or posted will appear here." 
                      : "None of your active gigs match the current filters."}
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


"use client";

import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import Link from 'next/link';
import { PlusCircle, Loader2, Briefcase, User, Calendar } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Gig } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

function GigCard({ gig, showRole = false, currentUserId }: { gig: Gig; showRole?: boolean; currentUserId?: string }) {
  const spotsLeft = gig.creatorsNeeded - gig.acceptedCreatorIds.length;
  const isBrand = gig.brandId === currentUserId || false; // Simple check, might be more complex with agency
  const isAccepted = currentUserId ? gig.acceptedCreatorIds.includes(currentUserId) : false;

  return (
    <Card className="flex flex-col h-full hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1">
            <CardTitle className="text-lg line-clamp-1">{gig.title}</CardTitle>
            <CardDescription className="flex items-center gap-1 mt-1">
              <Briefcase className="h-3 w-3" /> {gig.brandName}
            </CardDescription>
          </div>
          <Badge variant={gig.status === 'open' ? 'default' : 'secondary'} className={gig.status === 'open' ? 'bg-green-500' : ''}>
            {gig.status.replace('_', ' ')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <p className="text-sm text-muted-foreground line-clamp-2">{gig.description}</p>
        <div className="flex flex-wrap gap-2">
          {gig.platforms.map(platform => (
            <Badge key={platform} variant="outline" className="text-[10px] uppercase font-bold tracking-wider">
              {platform}
            </Badge>
          ))}
        </div>
        {showRole && (
          <div className="flex items-center gap-2 pt-2 border-t">
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
        <div className="text-xl font-bold text-primary">${gig.ratePerCreator.toLocaleString()}</div>
        <Button asChild size="sm">
          <Link href={`/gigs/${gig.id}`}>
            View Details
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

export default function GigsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [openGigs, setOpenGigs] = useState<Gig[]>([]);
  const [myGigs, setMyGigs] = useState<Gig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("browse");

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

  // 2. Fetch "My Gigs" (Gigs I'm in or managing)
  useEffect(() => {
    if (!user) return;

    // We need to fetch gigs where I'm a creator OR where I'm the brand team
    // Since we can't do OR in Firestore easily across these fields, we run two listeners or merge.
    // For simplicity and real-time feel, we'll merge them.
    
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
          
          // Merge and Deduplicate
          const combined = new Map<string, Gig>();
          participatingGigs.forEach(g => combined.set(gigId(g), g));
          managingGigs.forEach(g => combined.set(gigId(g), g));
          
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

  const gigId = (g: Gig) => g.id;

  const canPostGig = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';

  return (
    <>
      <PageHeader
        title="Gig Board"
        description="Discover paid opportunities or manage your active campaigns."
        actions={canPostGig ? (
          <Button asChild>
            <Link href="/gigs/post">
              <PlusCircle className="mr-2 h-4 w-4" />
              Post a New Gig
            </Link>
          </Button>
        ) : undefined}
      />

      <Tabs defaultValue="browse" value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="browse">Browse Gigs</TabsTrigger>
          <TabsTrigger value="my-gigs">My Gigs</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-6">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
            </div>
          ) : openGigs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {openGigs.map(gig => <GigCard key={gig.id} gig={gig} currentUserId={user?.uid} />)}
            </div>
          ) : (
            <div className="text-center py-16 border-2 border-dashed rounded-lg bg-muted/5">
              <h3 className="text-xl font-semibold">No Gigs Available</h3>
              <p className="text-muted-foreground mt-2">Check back later for new opportunities!</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="my-gigs" className="space-y-6">
          {myGigs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myGigs.map(gig => (
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
              <h3 className="text-xl font-semibold">No Active Gigs</h3>
              <p className="text-muted-foreground mt-2">Gigs you've accepted or posted will appear here.</p>
              <Button variant="outline" className="mt-4" onClick={() => setActiveTab("browse")}>
                Explore Opportunities
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

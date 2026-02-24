"use client";

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import Link from 'next/link';
import { PlusCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Gig } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';

function GigCard({ gig }: { gig: Gig }) {
  const spotsLeft = gig.creatorsNeeded - gig.acceptedCreatorIds.length;

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <CardTitle>{gig.title}</CardTitle>
        <CardDescription>by {gig.brandName}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow space-y-4">
        <p className="text-sm text-muted-foreground line-clamp-3">{gig.description}</p>
        <div className="flex flex-wrap gap-2">
          {gig.platforms.map(platform => <Badge key={platform} variant="secondary">{platform}</Badge>)}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <div className="text-lg font-bold text-primary">${gig.ratePerCreator}</div>
        <Button asChild>
          <Link href={`/gigs/${gig.id}`}>
            View Gig ({spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left)
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

export default function GigsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      if (!authLoading) setIsLoading(false);
      return;
    }
    const gigsQuery = query(collection(db, "gigs"), where("status", "==", "open"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(gigsQuery, (snapshot) => {
      const fetchedGigs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Gig));
      setGigs(fetchedGigs);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user, authLoading]);

  const canPostGig = user?.role === 'agency_owner'; // Or maybe brand role later

  return (
    <>
      <PageHeader
        title="Gig Board"
        description="Discover paid opportunities from brands."
        actions={canPostGig ? (
          <Button asChild>
            <Link href="/gigs/post">
              <PlusCircle className="mr-2 h-4 w-4" />
              Post a New Gig
            </Link>
          </Button>
        ) : undefined}
      />
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : gigs.length > 0 ? (
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {gigs.map(gig => <GigCard key={gig.id} gig={gig} />)}
        </div>
      ) : (
        <div className="text-center py-16 border-2 border-dashed rounded-lg">
          <h3 className="text-xl font-semibold">No Gigs Available</h3>
          <p className="text-muted-foreground mt-2">Check back later for new opportunities!</p>
        </div>
      )}
    </>
  );
}

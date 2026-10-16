
"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, FileStack, ExternalLink, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Gig } from '@/types';
import { onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface AgencyGigsCardProps {
  agencyId: string;
  isBrandAccount?: boolean;
}

export function AgencyGigsCard({ agencyId, isBrandAccount }: AgencyGigsCardProps) {
  const { toast } = useToast();
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [isLoadingGigs, setIsLoadingGigs] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(localStorage.getItem('verza.agency.gigsOpen') === '1');
  }, []);

  useEffect(() => {
    if (!agencyId) return;
    setIsLoadingGigs(true);
    const gigsQuery = query(
        collection(db, "gigs"), 
        where("brandId", "==", agencyId),
        orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(gigsQuery, (snapshot) => {
        const history = snapshot.docs.map(doc => ({...doc.data(), id: doc.id} as Gig));
        setGigs(history);
        setIsLoadingGigs(false);
    }, (error) => {
        console.error("Error fetching agency gigs:", error);
        toast({ title: "Campaigns Error", description: "Could not fetch your agency's campaigns.", variant: "destructive" });
        setIsLoadingGigs(false);
    });

    return () => unsubscribe();
  }, [agencyId, toast]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        localStorage.setItem('verza.agency.gigsOpen', next ? '1' : '0');
      }}
    >
    <Card id="agency-gigs-card">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-3 rounded-lg p-6 text-left hover:bg-muted/40 [&[data-state=open]>svg.chevron]:rotate-180"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <CardTitle className="flex items-center gap-2"><FileStack className="text-primary"/> Active Campaigns</CardTitle>
            <CardDescription>
              {isLoadingGigs
                ? `A history of all campaigns launched by your ${isBrandAccount ? 'brand' : 'agency'}.`
                : `${gigs.length} campaign${gigs.length === 1 ? '' : 's'} launched by your ${isBrandAccount ? 'brand' : 'agency'}.`}
            </CardDescription>
          </div>
          <ChevronDown className="chevron mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
      <CardContent>
        {isLoadingGigs ? <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin"/></div>
         : gigs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Creators</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gigs.map(gig => (
                <TableRow key={gig.id}>
                  <TableCell className="font-medium">{gig.title}</TableCell>
                  <TableCell>
                    <Badge variant={gig.status === 'open' ? 'default' : 'secondary'} className={`capitalize ${gig.status === 'open' ? 'bg-green-500' : ''}`}>
                      {gig.status === 'open' ? 'Capital Available' : gig.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{gig.acceptedCreatorIds.length} / {gig.creatorsNeeded}</TableCell>
                  <TableCell className="text-right font-mono">${gig.ratePerCreator.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                        <Link href={`/campaigns/${gig.id}`}>
                            View <ExternalLink className="ml-2 h-3 w-3" />
                        </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
         ) : <p className="text-center text-muted-foreground py-6">Your agency has not launched any campaigns yet.</p>}
      </CardContent>
      </CollapsibleContent>
    </Card>
    </Collapsible>
  );
}

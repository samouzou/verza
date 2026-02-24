
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, getDoc, collection, query, where, documentId, arrayUnion } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import type { Gig } from '@/types';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, ArrowLeft, CheckCircle, Users, Edit, Wand2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { generateUgcContract } from '@/ai/flows/generate-ugc-contract-flow';
import { UploadContractDialog } from '@/components/contracts/upload-contract-dialog';

export default function GigDetailPage() {
  const params = useParams();
  const gigId = params.id as string;
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [gig, setGig] = useState<Gig | null>(null);
  const [acceptedCreators, setAcceptedCreators] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  
  const [isContractDialogOpen, setIsContractDialogOpen] = useState(false);
  const [contractGenData, setContractGenData] = useState<{ sfdt: string; talent: UserProfile } | null>(null);


  useEffect(() => {
    if (!gigId) {
      setIsLoading(false);
      return;
    }

    const gigDocRef = doc(db, 'gigs', gigId);
    const unsubscribe = onSnapshot(gigDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setGig({ id: docSnap.id, ...docSnap.data() } as Gig);
      } else {
        setGig(null);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching gig:", error);
      toast({ title: "Error", description: "Could not fetch gig details.", variant: "destructive" });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [gigId, toast]);

  useEffect(() => {
    if (gig && gig.acceptedCreatorIds.length > 0) {
      const creatorsQuery = query(collection(db, 'users'), where(documentId(), 'in', gig.acceptedCreatorIds));
      const unsubscribe = onSnapshot(creatorsQuery, (snapshot) => {
        const creatorsData = snapshot.docs.map(d => d.data() as UserProfile);
        setAcceptedCreators(creatorsData);
      });
      return () => unsubscribe();
    } else {
      setAcceptedCreators([]);
    }
  }, [gig]);

  const handleAcceptGig = async () => {
    if (!user || !gig) return;

    setIsAccepting(true);
    const gigDocRef = doc(db, 'gigs', gig.id);
    const userDocRef = doc(db, 'users', user.uid);

    try {
      // Re-fetch to ensure we have the latest data before updating
      const currentGigSnap = await getDoc(gigDocRef);
      if (!currentGigSnap.exists()) throw new Error("Gig no longer exists.");

      const currentGigData = currentGigSnap.data() as Gig;

      if (currentGigData.acceptedCreatorIds.length >= currentGigData.creatorsNeeded) {
        throw new Error("Sorry, all spots for this gig have been filled.");
      }
      if (currentGigData.acceptedCreatorIds.includes(user.uid)) {
        throw new Error("You have already accepted this gig.");
      }

      const newAcceptedIds = [...currentGigData.acceptedCreatorIds, user.uid];
      
      const updates: Partial<Gig> = {
        acceptedCreatorIds: newAcceptedIds
      };

      if (newAcceptedIds.length === currentGigData.creatorsNeeded) {
        updates.status = 'in-progress';
      }

      await updateDoc(gigDocRef, updates);
      await updateDoc(userDocRef, {
          giggingForAgencies: arrayUnion(currentGigData.brandId)
      });
      
      toast({ title: "Gig Accepted!", description: "You have successfully accepted this gig." });
      
    } catch (error: any) {
      console.error("Error accepting gig:", error);
      toast({ title: "Failed to Accept Gig", description: error.message || "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleGenerateAgreement = async (creator: UserProfile) => {
    if (!gig) return;
    setIsGenerating(creator.uid);
    toast({ title: "Generating Agreement...", description: "The AI is drafting the UGC agreement. This may take a moment." });
    try {
      const { contractSfdt } = await generateUgcContract({
        brandName: gig.brandName,
        creatorName: creator.displayName || 'The Creator',
        gigDescription: gig.description,
        rate: gig.ratePerCreator,
      });

      if (contractSfdt) {
        setContractGenData({ sfdt: contractSfdt, talent: creator });
        setIsContractDialogOpen(true); // Open the dialog
        toast({ title: "Agreement Drafted!", description: "Review and save the AI-generated contract." });
      } else {
        throw new Error("AI did not return contract data.");
      }
    } catch (error: any) {
      console.error("Error generating UGC agreement:", error);
      toast({ title: "Generation Failed", description: error.message || "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsGenerating(null);
    }
  };


  if (isLoading || authLoading) {
    return <div className="flex justify-center items-center h-96"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (!gig) {
    return (
      <div className="text-center py-10">
        <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
        <h3 className="mt-4 text-lg font-medium">Gig Not Found</h3>
        <p className="mt-1 text-sm text-muted-foreground">The gig you are looking for does not exist or has been removed.</p>
        <Button asChild variant="outline" className="mt-4">
            <Link href="/gigs"><ArrowLeft className="mr-2 h-4 w-4"/> Back to Gig Board</Link>
        </Button>
      </div>
    );
  }

  const spotsLeft = gig.creatorsNeeded - gig.acceptedCreatorIds.length;
  const hasAccepted = user ? gig.acceptedCreatorIds.includes(user.uid) : false;
  const canManageGig = user ? gig.brandId === user.primaryAgencyId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId) : false;


  return (
    <>
      <PageHeader
        title={gig.title}
        description={`Posted by ${gig.brandName}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/gigs"><ArrowLeft className="mr-2 h-4 w-4"/> Back to Gig Board</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle>Project Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {gig.brandLogoUrl && <Image src={gig.brandLogoUrl} alt={`${gig.brandName} logo`} width={80} height={80} className="rounded-md" data-ai-hint="logo" />}
                    <p className="text-muted-foreground whitespace-pre-wrap">{gig.description}</p>
                    <div>
                        <h4 className="font-semibold mb-2">Platforms</h4>
                        <div className="flex flex-wrap gap-2">
                            {gig.platforms.map(platform => <Badge key={platform} variant="secondary">{platform}</Badge>)}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {canManageGig && (
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Users className="text-primary"/> Accepted Creators</CardTitle>
                        <CardDescription>This roster is only visible to you.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {acceptedCreators.length > 0 ? (
                           <div className="space-y-3">
                                {acceptedCreators.map(creator => (
                                    <div key={creator.uid} className="flex items-center justify-between p-2 rounded-md transition-colors hover:bg-accent">
                                        <Link href={`/creator/${creator.uid}`} className="flex items-center gap-3 group">
                                            <Avatar>
                                                <AvatarImage src={creator.avatarUrl || ''} alt={creator.displayName || ''} data-ai-hint="person" />
                                                <AvatarFallback>{creator.displayName?.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-medium group-hover:underline">{creator.displayName}</p>
                                                <p className="text-xs text-muted-foreground">{creator.email}</p>
                                            </div>
                                        </Link>
                                        <Button 
                                            size="sm" 
                                            variant="outline"
                                            onClick={() => handleGenerateAgreement(creator)}
                                            disabled={isGenerating === creator.uid}
                                        >
                                            {isGenerating === creator.uid ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                                            Generate Agreement
                                        </Button>
                                    </div>
                                ))}
                           </div>
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">No creators have accepted this gig yet.</p>
                        )}
                    </CardContent>
                 </Card>
            )}

        </div>
        <div className="lg:col-span-1 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Gig Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Rate per Creator</span>
                        <span className="font-bold text-2xl text-primary">${gig.ratePerCreator.toLocaleString()}</span>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Spots Remaining</span>
                        <span className="font-bold">{spotsLeft} / {gig.creatorsNeeded}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant={gig.status === 'open' ? 'default' : 'secondary'} className={`capitalize ${gig.status === 'open' ? 'bg-green-500' : ''}`}>{gig.status}</Badge>
                    </div>

                    {user && !canManageGig && (
                         hasAccepted ? (
                            <Button className="w-full" disabled>
                                <CheckCircle className="mr-2 h-4 w-4" /> You've Accepted this Gig
                            </Button>
                         ) : spotsLeft > 0 ? (
                            <Button className="w-full" onClick={handleAcceptGig} disabled={isAccepting}>
                                {isAccepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Accept Gig
                            </Button>
                         ) : (
                             <Button className="w-full" disabled>
                                Gig Full
                             </Button>
                         )
                    )}

                    {canManageGig && (
                        <Button asChild className="w-full" variant="outline">
                            <Link href={`/gigs/${gig.id}/edit`}>
                                <Edit className="mr-2 h-4 w-4" /> Edit Gig
                            </Link>
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
      </div>
      {contractGenData && (
        <UploadContractDialog
          isOpen={isContractDialogOpen}
          onOpenChange={setIsContractDialogOpen}
          initialSFDT={contractGenData.sfdt}
          initialSelectedOwner={contractGenData.talent.uid}
          initialFileName={`UGC Agreement - ${gig.title} - ${contractGenData.talent.displayName}.docx`}
        />
      )}
    </>
  );
}

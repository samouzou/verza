
"use client";

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useRouter, useParams } from 'next/navigation';
import { Loader2, AlertTriangle, ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Gig } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';

const platforms = ['TikTok', 'Instagram', 'YouTube', 'Facebook'];

export default function EditGigPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const gigId = params.id as string;
  const { toast } = useToast();

  const [gig, setGig] = useState<Gig | null>(null);
  const [isLoadingGig, setIsLoadingGig] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [ratePerCreator, setRatePerCreator] = useState('');
  const [creatorsNeeded, setCreatorsNeeded] = useState('');
  const [videosPerCreator, setVideosPerCreator] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  useEffect(() => {
    if (!gigId) return;

    const fetchGig = async () => {
        setIsLoadingGig(true);
        const gigDocRef = doc(db, 'gigs', gigId);
        const docSnap = await getDoc(gigDocRef);

        if (docSnap.exists()) {
            const gigData = { id: docSnap.id, ...docSnap.data() } as Gig;
            setGig(gigData);
            // Pre-fill form state
            setTitle(gigData.title);
            setDescription(gigData.description);
            setSelectedPlatforms(gigData.platforms);
            setRatePerCreator(String(gigData.ratePerCreator));
            setCreatorsNeeded(String(gigData.creatorsNeeded));
            setVideosPerCreator(String(gigData.videosPerCreator || '1'));
        } else {
            toast({ title: 'Gig not found', variant: 'destructive' });
            router.push('/gigs');
        }
        setIsLoadingGig(false);
    }
    fetchGig();
  }, [gigId, router, toast]);

  const handlePlatformChange = (platform: string) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform) 
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !gig) return;

    const rateNum = parseFloat(ratePerCreator);
    const creatorsNum = parseInt(creatorsNeeded, 10);
    const videosNum = parseInt(videosPerCreator, 10);
    
    if (!title.trim() || !description.trim() || selectedPlatforms.length === 0 || isNaN(rateNum) || rateNum <= 0 || isNaN(creatorsNum) || creatorsNum <= 0 || isNaN(videosNum) || videosNum <= 0) {
      toast({ title: 'All fields are required', description: 'Please fill out the form completely.', variant: 'destructive' });
      return;
    }
    
    setIsSubmitting(true);
    try {
        const gigDocRef = doc(db, 'gigs', gigId);
        const updates: Partial<Gig> = {
            title: title.trim(),
            description: description.trim(),
            platforms: selectedPlatforms,
            ratePerCreator: rateNum,
            creatorsNeeded: creatorsNum,
            videosPerCreator: videosNum,
        };
      
        await updateDoc(gigDocRef, updates);
      
        toast({ title: 'Gig Updated!', description: 'Your changes have been saved.' });
        router.push(`/gigs/${gigId}`);

    } catch (error: any) {
        console.error("Error updating gig:", error);
        toast({ title: 'Update Failed', description: error.message || 'Could not save your changes.', variant: 'destructive' });
    } finally {
        setIsSubmitting(false);
    }
  };

  const canManageGig = user && gig && (user.primaryAgencyId === gig.brandId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId));

  if (authLoading || isLoadingGig) {
    return (
        <>
            <PageHeader title="Edit Gig" description="Loading gig details..." />
            <Card className="max-w-3xl mx-auto">
                <CardHeader>
                    <Skeleton className="h-8 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                </CardHeader>
                <CardContent className="space-y-6">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-10 w-full" />
                </CardContent>
            </Card>
        </>
    );
  }
  
  if (!user || !canManageGig) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">You do not have permission to edit this gig.</p>
        <Button variant="outline" asChild className="mt-4"><Link href="/gigs"><ArrowLeft className="mr-2 h-4 w-4"/> Back to Gigs</Link></Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Edit Gig"
        description={`Editing "${gig?.title || 'gig'}"`}
        actions={
            <Button variant="outline" asChild>
                <Link href={`/gigs/${gigId}`}><ArrowLeft className="mr-2 h-4 w-4"/> Cancel</Link>
            </Button>
        }
      />
      <Card className="max-w-3xl mx-auto">
        <CardHeader>
            <CardTitle>Gig Details</CardTitle>
            <CardDescription>Update the details for your user-generated content (UGC) campaign.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="title">Gig Title</Label>
                <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="description">Project Description</Label>
                <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} rows={5} required disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label>Platforms</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                {platforms.map(platform => (
                  <div key={platform} className="flex items-center space-x-2">
                    <Checkbox
                      id={`platform-${platform}`}
                      checked={selectedPlatforms.includes(platform)}
                      onCheckedChange={() => handlePlatformChange(platform)}
                      disabled={isSubmitting}
                    />
                    <Label htmlFor={`platform-${platform}`} className="font-normal">{platform}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="rate">Rate per Creator ($)</Label>
                    <Input id="rate" type="number" value={ratePerCreator} onChange={e => setRatePerCreator(e.target.value)} required min="1" disabled={isSubmitting}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="creators">Creators Needed</Label>
                    <Input id="creators" type="number" value={creatorsNeeded} onChange={e => setCreatorsNeeded(e.target.value)} required min="1" disabled={isSubmitting}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="videos">Videos per Creator</Label>
                    <Input id="videos" type="number" value={videosPerCreator} onChange={e => setVideosPerCreator(e.target.value)} required min="1" disabled={isSubmitting}/>
                </div>
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

"use client";

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { useRouter, useParams } from 'next/navigation';
import { Loader2, AlertTriangle, ArrowLeft, Save, ShieldAlert, Info, Scale } from 'lucide-react';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Gig } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import dynamic from 'next/dynamic';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

const platforms = ['TikTok', 'Instagram', 'YouTube', 'Facebook'];

const quillModules = {
  toolbar: [
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    ['link'],
    ['clean']
  ],
};

export default function EditGigPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const gigId = params.id as string;
  const { toast } = useToast();

  const [gig, setGig] = useState<Gig | null>(null);
  const [isLoadingGig, setIsLoadingGig] = useState(true);

  const [campaignType, setCampaignType] = useState<'standard_sponsorship' | 'production_grant'>('standard_sponsorship');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [ratePerCreator, setRatePerCreator] = useState('');
  const [creatorsNeeded, setCreatorsNeeded] = useState('');
  const [videosPerCreator, setVideosPerCreator] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Legal Fields
  const [usageRights, setUsageRights] = useState<'none' | '30_days' | '1_year' | 'perpetuity'>('1_year');
  const [allowWhitelisting, setAllowWhitelisting] = useState(false);
  
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
            setCampaignType(gigData.campaignType || 'standard_sponsorship');
            setTitle(gigData.title);
            setDescription(gigData.description);
            setSelectedPlatforms(gigData.platforms);
            setRatePerCreator(String(gigData.ratePerCreator));
            setCreatorsNeeded(String(gigData.creatorsNeeded));
            setVideosPerCreator(String(gigData.videosPerCreator || '1'));
            setUsageRights(gigData.usageRights || '1_year');
            setAllowWhitelisting(!!gigData.allowWhitelisting);
        } else {
            toast({ title: 'Gig not found', variant: 'destructive' });
            router.push('/gigs');
        }
        setIsLoadingGig(false);
    }
    fetchGig();
  }, [gigId, router, toast]);

  // Adjust defaults based on campaign type
  useEffect(() => {
    if (campaignType === 'production_grant') {
      setUsageRights('none');
      setAllowWhitelisting(false);
    }
  }, [campaignType]);

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
            campaignType,
            title: title.trim(),
            description: description.trim(),
            platforms: selectedPlatforms as ("TikTok" | "Instagram" | "YouTube" | "Facebook")[],
            ratePerCreator: rateNum,
            creatorsNeeded: creatorsNum,
            videosPerCreator: videosNum,
            usageRights,
            allowWhitelisting,
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
  const isFunded = Boolean(gig && gig.status !== 'pending_payment');

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
      <div className="max-w-3xl mx-auto space-y-6">
        {isFunded && (
          <Alert variant="default" className="bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Scope Locked</AlertTitle>
            <AlertDescription>
              This gig has already been funded. Financial details and creator counts are locked to ensure consistency for creators. You can still update the title, description, and platforms.
            </AlertDescription>
          </Alert>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>1. Campaign Selection</CardTitle>
              <CardDescription>Update the type of engagement for this campaign.</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup value={campaignType} onValueChange={(val) => setCampaignType(val as any)} className="space-y-4" disabled={isFunded || isSubmitting}>
                <div className={cn(
                  "flex items-start space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer",
                  campaignType === 'standard_sponsorship' ? "border-primary bg-primary/5" : "border-muted hover:border-primary/30"
                )}>
                  <RadioGroupItem value="standard_sponsorship" id="standard" className="mt-1" />
                  <Label htmlFor="standard" className="flex-1 cursor-pointer">
                    <p className="font-bold text-base">Standard Sponsorship</p>
                    <p className="text-sm text-muted-foreground mt-1">Includes ad-reads, usage rights, and whitelisting options.</p>
                  </Label>
                </div>
                <div className={cn(
                  "flex items-start space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer",
                  campaignType === 'production_grant' ? "border-primary bg-primary/5" : "border-muted hover:border-primary/30"
                )}>
                  <RadioGroupItem value="production_grant" id="grant" className="mt-1" />
                  <Label htmlFor="grant" className="flex-1 cursor-pointer">
                    <p className="font-bold text-base">Production Grant / Editorial Funding</p>
                    <p className="text-sm text-muted-foreground mt-1">No ad-read required. Funds used to support independent creator content.</p>
                  </Label>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
                <CardTitle>2. Gig Details</CardTitle>
                <CardDescription>Update the details for your user-generated content (UGC) campaign.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                  <Label htmlFor="title">Gig Title</Label>
                  <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required disabled={isSubmitting} />
              </div>
              <div className="space-y-2">
                  <Label htmlFor="description">Project Description</Label>
                  <div className="min-h-[200px] rounded-md border border-input bg-background">
                    <ReactQuill
                      theme="snow"
                      value={description}
                      onChange={setDescription}
                      placeholder="Update your project description..."
                      readOnly={isSubmitting}
                      modules={quillModules}
                    />
                  </div>
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
                      <Input id="rate" type="number" value={ratePerCreator} onChange={e => setRatePerCreator(e.target.value)} required min="1" disabled={isSubmitting || isFunded}/>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="creators">Creators Needed</Label>
                      <Input id="creators" type="number" value={creatorsNeeded} onChange={e => setCreatorsNeeded(e.target.value)} required min="1" disabled={isSubmitting || isFunded}/>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="videos">Videos per Creator</Label>
                      <Input id="videos" type="number" value={videosPerCreator} onChange={e => setVideosPerCreator(e.target.value)} required min="1" disabled={isSubmitting || isFunded}/>
                  </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> 3. Usage Rights & Legal</CardTitle>
              <CardDescription>Update how you plan to use the content.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Usage Rights Duration</Label>
                <RadioGroup value={usageRights} onValueChange={(val) => setUsageRights(val as any)} className="flex flex-col sm:flex-row flex-wrap gap-4" disabled={isFunded || isSubmitting}>
                  {campaignType === 'production_grant' && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="none" id="none" />
                      <Label htmlFor="none" className="font-normal flex items-center gap-1.5 cursor-pointer">
                        None (Editorial Support Only)
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[250px]">
                              <p>The brand claims no commercial usage rights over the final video. The creator retains full ownership and 100% of their standard sponsor inventory.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="30_days" id="30days" />
                    <Label htmlFor="30days" className="font-normal">30 Days</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="1_year" id="1year" />
                    <Label htmlFor="1year" className="font-normal">1 Year</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="perpetuity" id="perpetuity" />
                    <Label htmlFor="perpetuity" className="font-normal">In Perpetuity</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                <div className="space-y-0.5">
                  <Label htmlFor="whitelisting">Paid Whitelisting Allowed?</Label>
                  <p className="text-xs text-muted-foreground">Allows your brand to run ads directly from the creator's profile.</p>
                </div>
                <Checkbox 
                  id="whitelisting" 
                  checked={allowWhitelisting} 
                  onCheckedChange={(val) => setAllowWhitelisting(val as boolean)}
                  disabled={isFunded || isSubmitting || campaignType === 'production_grant'}
                />
              </div>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full h-12 text-lg font-bold" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
            Save All Changes
          </Button>
        </form>
      </div>
    </>
  );
}
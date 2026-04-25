
"use client";

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { useRouter, useParams } from 'next/navigation';
import { 
  Loader2, 
  AlertTriangle, 
  ArrowLeft, 
  Save, 
  ShieldAlert, 
  Info, 
  Scale, 
  DollarSign, 
  Link2, 
  MousePointer2, 
  Target, 
  Zap 
} from 'lucide-react';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
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

const platforms = ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'Twitch', 'LinkedIn'];

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
  
  // Base Rate
  const [isBaseRateEnabled, setIsBaseRateEnabled] = useState(true);
  const [ratePerCreator, setRatePerCreator] = useState('');
  
  const [creatorsNeeded, setCreatorsNeeded] = useState('');
  const [videosPerCreator, setVideosPerCreator] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Legal Fields
  const [usageRights, setUsageRights] = useState<'none' | '30_days' | '1_year' | 'perpetuity'>('1_year');
  const [allowWhitelisting, setAllowWhitelisting] = useState(false);

  // Performance Rewards
  const [isAffiliateEnabled, setIsAffiliateEnabled] = useState(false);
  const [rewardType, setRewardType] = useState<'cpc' | 'cpa'>('cpa');
  const [rewardAmount, setRewardAmount] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  
  const [trackingMethod, setTrackingMethod] = useState<'link_only' | 'promo_code_only' | 'both'>('link_only');
  const [promoCodeDiscountValue, setPromoCodeDiscountValue] = useState('');
  const [promoCodePrefix, setPromoCodePrefix] = useState('');

  // Quality Control
  const [requireVerzaScore, setRequireVerzaScore] = useState(true);
  const [verzaScoreThreshold, setVerzaScoreThreshold] = useState('65');
  
  useEffect(() => {
    if (!gigId) return;

    const fetchGig = async () => {
        setIsLoadingGig(true);
        try {
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
              
              const baseRate = gigData.ratePerCreator || 0;
              setIsBaseRateEnabled(baseRate > 0);
              setRatePerCreator(String(baseRate));
              
              setCreatorsNeeded(String(gigData.creatorsNeeded));
              setVideosPerCreator(String(gigData.videosPerCreator || '1'));
              setUsageRights(gigData.usageRights || '1_year');
              setAllowWhitelisting(!!gigData.allowWhitelisting);

              // Affiliate / Performance
              setIsAffiliateEnabled(!!gigData.affiliateSettings?.isEnabled);
              setRewardType(gigData.affiliateSettings?.rewardType || 'cpa');
              setRewardAmount(String(gigData.affiliateSettings?.rewardAmount || ''));
              setDestinationUrl(gigData.affiliateSettings?.destinationUrl || '');
              setTrackingMethod(gigData.affiliateSettings?.trackingMethod || 'link_only');
              setPromoCodeDiscountValue(gigData.affiliateSettings?.promoCodeDiscountValue || '');
              setPromoCodePrefix(gigData.affiliateSettings?.promoCodePrefix || '');

              setRequireVerzaScore(gigData.requireVerzaScore ?? true);
              setVerzaScoreThreshold(String(gigData.verzaScoreThreshold ?? 65));
          } else {
              toast({ title: 'Campaign not found', variant: 'destructive' });
              router.push('/campaigns');
          }
        } catch (error) {
          console.error("Error fetching gig:", error);
          toast({ title: 'Error', description: 'Could not load campaign details.', variant: 'destructive' });
        } finally {
          setIsLoadingGig(false);
        }
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

    const rateNum = isBaseRateEnabled ? parseFloat(ratePerCreator) : 0;
    const creatorsNum = parseInt(creatorsNeeded, 10);
    const videosNum = parseInt(videosPerCreator, 10);
    
    if (!title.trim() || !description.trim() || selectedPlatforms.length === 0 || isNaN(creatorsNum) || creatorsNum <= 0 || isNaN(videosNum) || videosNum <= 0) {
      toast({ title: 'Missing details', description: 'Please fill out the basic campaign details.', variant: 'destructive' });
      return;
    }

    if (isAffiliateEnabled) {
      if (!destinationUrl.trim() || !rewardAmount || parseFloat(rewardAmount) <= 0) {
        toast({ title: 'Performance Details Missing', description: 'Please provide a destination URL and valid reward amount.', variant: 'destructive' });
        return;
      }
      if ((trackingMethod === 'promo_code_only' || trackingMethod === 'both') && !promoCodePrefix.trim()) {
        toast({ title: 'Promo Code Prefix Missing', description: 'Please provide a prefix for the promo codes.', variant: 'destructive' });
        return;
      }
    }
    
    setIsSubmitting(true);
    try {
        const gigDocRef = doc(db, 'gigs', gigId);
        const updates: Partial<Gig> = {
            campaignType,
            title: title.trim(),
            description: description.trim(),
            platforms: selectedPlatforms as ("TikTok" | "Instagram" | "YouTube" | "Facebook" | "Twitch" | "LinkedIn")[],
            ratePerCreator: rateNum,
            creatorsNeeded: creatorsNum,
            videosPerCreator: videosNum,
            usageRights,
            allowWhitelisting: allowWhitelisting ?? false,
            requireVerzaScore,
            verzaScoreThreshold: requireVerzaScore ? parseInt(verzaScoreThreshold, 10) || 65 : 65,
        };

        if (isAffiliateEnabled) {
          updates.affiliateSettings = {
            isEnabled: true,
            rewardType,
            rewardAmount: parseFloat(rewardAmount) || 0,
            destinationUrl: destinationUrl.trim(),
            trackingMethod,
            promoCodeDiscountValue: promoCodeDiscountValue.trim(),
            promoCodePrefix: promoCodePrefix.trim().toUpperCase()
          };
        } else {
          updates.affiliateSettings = {
            isEnabled: false,
            rewardType: 'cpa',
            rewardAmount: 0,
            destinationUrl: '',
          };
        }
      
        await updateDoc(gigDocRef, updates);
      
        toast({ title: 'Campaign Updated!', description: 'Your changes have been saved.' });
        router.push(`/campaigns/${gigId}`);

    } catch (error: any) {
        console.error("Error updating gig:", error);
        toast({ title: 'Update Failed', description: error.message || 'Could not save your changes.', variant: 'destructive' });
    } finally {
        setIsSubmitting(false);
    }
  };

  const canManageGig = user && gig && (user.primaryAgencyId === gig.brandId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId));
  const isFunded = Boolean(gig && gig.status !== 'pending_payment');
  const hasAcceptedCreators = (gig?.acceptedCreatorIds?.length || 0) > 0;
  const isLocked = isFunded || hasAcceptedCreators;

  if (authLoading || isLoadingGig) {
    return (
        <>
            <PageHeader title="Edit Campaign" description="Loading details..." />
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
        <p className="text-muted-foreground">You do not have permission to edit this campaign.</p>
        <Button variant="outline" asChild className="mt-4"><Link href="/campaigns"><ArrowLeft className="mr-2 h-4 w-4"/> Back to Campaigns</Link></Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Edit Campaign"
        description={`Editing "${gig?.title || 'campaign'}"`}
        actions={
            <Button variant="outline" asChild>
                <Link href={`/campaigns/${gigId}`}><ArrowLeft className="mr-2 h-4 w-4"/> Cancel</Link>
            </Button>
        }
      />
      <div className="max-w-3xl mx-auto space-y-6">
        {isLocked && (
          <Alert variant="default" className="bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Scope Locked</AlertTitle>
            <AlertDescription>
              {isFunded
                ? "This campaign has already been funded."
                : "Creators have already secured positions in this campaign."}
              Financial details, performance rewards, and creator counts are locked to ensure consistency. You can still update the title, brief, and platforms.
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
              <RadioGroup value={campaignType} onValueChange={(val) => setCampaignType(val as any)} className="space-y-4" disabled={isLocked || isSubmitting}>
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
                <CardTitle>2. Campaign Details</CardTitle>
                <CardDescription>Update the details for your campaign.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                  <Label htmlFor="title">Campaign Title</Label>
                  <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required disabled={isSubmitting} />
              </div>
              <div className="space-y-2">
                  <Label htmlFor="description">Campaign Brief</Label>
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
                      <Label htmlFor="creators">Creators Needed</Label>
                      <Input id="creators" type="number" value={creatorsNeeded} onChange={e => setCreatorsNeeded(e.target.value)} required min="1" disabled={isSubmitting || isLocked}/>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="videos">Videos per Creator</Label>
                      <Input id="videos" type="number" value={videosPerCreator} onChange={e => setVideosPerCreator(e.target.value)} required min="1" disabled={isSubmitting || isLocked}/>
                  </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-primary" /> 3. Fixed Base Rate</CardTitle>
                  <CardDescription>A guaranteed one-time payment for every creator who completes the brief.</CardDescription>
                </div>
                <Switch checked={isBaseRateEnabled ?? false} onCheckedChange={setIsBaseRateEnabled} disabled={isLocked || isSubmitting} />
              </div>
            </CardHeader>
            {isBaseRateEnabled && (
              <CardContent className="animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="space-y-2">
                  <Label htmlFor="rate">Base Rate per Creator ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="rate" type="number" value={ratePerCreator} onChange={e => setRatePerCreator(e.target.value)} placeholder="2500" className="pl-9" required min="1" disabled={isSubmitting || isLocked}/>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          <Card className="border-blue-500/20 bg-blue-50/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-blue-500" /> 4. Performance Rewards</CardTitle>
                  <CardDescription>Enable affiliate tracking and performance-based bonuses.</CardDescription>
                </div>
                <Switch checked={isAffiliateEnabled ?? false} onCheckedChange={setIsAffiliateEnabled} disabled={isLocked || isSubmitting} />
              </div>
            </CardHeader>
            {isAffiliateEnabled && (
              <CardContent className="space-y-6 pt-0 animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="rewardType">Reward Logic</Label>
                    <RadioGroup value={rewardType} onValueChange={(val) => setRewardType(val as any)} className="flex gap-4 mt-1" disabled={isLocked || isSubmitting}>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="cpc" id="cpc" />
                        <Label htmlFor="cpc" className="font-normal flex items-center gap-1"><MousePointer2 className="h-3 w-3" /> Per Click</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="cpa" id="cpa" />
                        <Label htmlFor="cpa" className="font-normal flex items-center gap-1"><Target className="h-3 w-3" /> Per Conversion</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rewardAmount">Reward Amount ($)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input id="rewardAmount" type="number" value={rewardAmount} onChange={e => setRewardAmount(e.target.value)} placeholder={rewardType === 'cpc' ? "0.10" : "25.00"} className="pl-9" disabled={isLocked || isSubmitting} />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="destinationUrl">Destination Link</Label>
                  <Input id="destinationUrl" value={destinationUrl} onChange={e => setDestinationUrl(e.target.value)} placeholder="https://yourbrand.com/shop" disabled={isLocked || isSubmitting} />
                </div>
                
                <div className="space-y-4 pt-4 border-t border-blue-500/10">
                  <Label className="text-base font-semibold">Tracking Method</Label>
                  <RadioGroup value={trackingMethod} onValueChange={(val) => setTrackingMethod(val as any)} className="flex flex-col gap-3" disabled={isLocked || isSubmitting}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="link_only" id="link_only" />
                      <Label htmlFor="link_only" className="font-normal cursor-pointer">Affiliate Link Only</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="promo_code_only" id="promo_code_only" />
                      <Label htmlFor="promo_code_only" className="font-normal cursor-pointer">Promo Codes Only</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="both" id="both" />
                      <Label htmlFor="both" className="font-normal cursor-pointer">Both Links and Promo Codes</Label>
                    </div>
                  </RadioGroup>
                </div>

                {(trackingMethod === 'promo_code_only' || trackingMethod === 'both') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-blue-500/10">
                    <div className="space-y-2">
                      <Label htmlFor="promoCodePrefix">Promo Code Prefix <span className="text-destructive">*</span></Label>
                      <Input id="promoCodePrefix" value={promoCodePrefix} onChange={e => setPromoCodePrefix(e.target.value.toUpperCase())} placeholder="e.g. SUMMER" disabled={isLocked || isSubmitting} required={isAffiliateEnabled} />
                      <p className="text-[10px] text-muted-foreground">Used to generate unique codes per creator (e.g. SUMMER-JULIA30).</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="promoCodeDiscountValue">Discount Value presented to audience</Label>
                      <Input id="promoCodeDiscountValue" value={promoCodeDiscountValue} onChange={e => setPromoCodeDiscountValue(e.target.value)} placeholder="e.g. 15% Off or $20 Off" disabled={isLocked || isSubmitting} />
                      <p className="text-[10px] text-muted-foreground">Let the creator know what discount they are pitching.</p>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          <Card className="border-orange-500/20 bg-orange-50/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-orange-500" /> 5. Quality Control (Verza Score)</CardTitle>
                  <CardDescription>Require a minimum predicted engagement score for created videos.</CardDescription>
                </div>
                <Switch checked={requireVerzaScore} onCheckedChange={setRequireVerzaScore} disabled={isLocked || isSubmitting} />
              </div>
            </CardHeader>
            {requireVerzaScore && (
              <CardContent className="space-y-4 pt-0 animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="threshold">Target Threshold (%)</Label>
                    <span className="text-sm font-bold text-orange-600">{verzaScoreThreshold}%</span>
                  </div>
                  <Input 
                    id="threshold" 
                    type="range" 
                    min="1" 
                    max="100" 
                    value={verzaScoreThreshold} 
                    onChange={e => setVerzaScoreThreshold(e.target.value)} 
                    disabled={isLocked || isSubmitting}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1% (Lenient)</span>
                    <span>100% (Strict)</span>
                  </div>
                  <p className="text-xs text-muted-foreground pt-2">
                    Videos must score at least <strong>{verzaScoreThreshold}%</strong> to be automatically approved. 
                    Setting this too high may result in fewer approved submissions. Default is 65%.
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> 6. Usage Rights & Legal</CardTitle>
              <CardDescription>Update how you plan to use the content.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Usage Rights Duration</Label>
                <RadioGroup value={usageRights} onValueChange={(val) => setUsageRights(val as any)} className="flex flex-col sm:flex-row flex-wrap gap-4" disabled={isLocked || isSubmitting}>
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
                  disabled={isLocked || isSubmitting || campaignType === 'production_grant'}
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

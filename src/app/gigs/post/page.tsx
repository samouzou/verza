"use client";

import { useState, useMemo, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { 
  Loader2, 
  AlertTriangle, 
  ArrowLeft, 
  DollarSign, 
  Building, 
  Sparkles, 
  ExternalLink, 
  ShieldCheck, 
  Scale, 
  Info,
  FileText 
} from 'lucide-react';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions, db, doc, onSnapshot } from '@/lib/firebase';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MarketplaceCoPilot } from '@/components/marketplace/marketplace-copilot';
import { trackEvent } from '@/lib/analytics';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
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

export default function PostGigPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [campaignType, setCampaignType] = useState<'standard_sponsorship' | 'production_grant'>('standard_sponsorship');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [ratePerCreator, setRatePerCreator] = useState('');
  const [creatorsNeeded, setCreatorsNeeded] = useState('');
  const [videosPerCreator, setVideosPerCreator] = useState('1');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Legal Fields
  const [usageRights, setUsageRights] = useState<'none' | '30_days' | '1_year' | 'perpetuity'>('1_year');
  const [allowWhitelisting, setAllowWhitelisting] = useState(false);

  const [agencyOwner, setAgencyOwner] = useState<UserProfile | null>(null);
  const [isLoadingSubscriptionCheck, setIsLoadingSubscriptionCheck] = useState(true);

  useEffect(() => {
    if (!user || authLoading) {
      if (!authLoading) setIsLoadingSubscriptionCheck(false);
      return;
    }
    
    if (user.isAgencyOwner) {
      setAgencyOwner(user);
      setIsLoadingSubscriptionCheck(false);
      return;
    }

    const isTeamMember = (user.role === 'agency_admin' || user.role === 'agency_member') && user.primaryAgencyId;
    if (!isTeamMember) {
        setIsLoadingSubscriptionCheck(false);
        return;
    }

    // Inherit subscription from agency owner
    setIsLoadingSubscriptionCheck(true);
    let unsubAgency: (() => void) | undefined;
    let unsubOwner: (() => void) | undefined;

    const agencyRef = doc(db, 'agencies', user.primaryAgencyId!);
    unsubAgency = onSnapshot(agencyRef, (agencySnap) => {
        if (agencySnap.exists()) {
            const agencyData = agencySnap.data();
            const ownerDocRef = doc(db, 'users', agencyData.ownerId);
            
            if (unsubOwner) unsubOwner();
            unsubOwner = onSnapshot(ownerDocRef, (ownerDocSnap) => {
                if (ownerDocSnap.exists()) {
                    setAgencyOwner(ownerDocSnap.data() as UserProfile);
                } else {
                    setAgencyOwner(null);
                }
                setIsLoadingSubscriptionCheck(false);
            });
        } else {
            setIsLoadingSubscriptionCheck(false);
        }
    });

    return () => {
        if (unsubAgency) unsubAgency();
        if (unsubOwner) unsubOwner();
    };
  }, [user, authLoading]);

  // Adjust defaults based on campaign type
  useEffect(() => {
    if (campaignType === 'production_grant') {
      setUsageRights('none');
      setAllowWhitelisting(false);
    } else {
      setUsageRights('1_year');
    }
  }, [campaignType]);

  const totalAmount = useMemo(() => {
    const rate = parseFloat(ratePerCreator);
    const needed = parseInt(creatorsNeeded, 10);
    if (!isNaN(rate) && !isNaN(needed) && rate > 0 && needed > 0) {
        return rate * needed;
    }
    return 0;
  }, [ratePerCreator, creatorsNeeded]);

  const handlePlatformChange = (platform: string) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform) 
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.primaryAgencyId) {
        toast({ 
          title: 'Authentication or Agency Error', 
          description: "You must be associated with an agency to post a gig.", 
          variant: 'destructive' 
        });
        return;
    }
    
    const rateNum = parseFloat(ratePerCreator);
    const creatorsNum = parseInt(creatorsNeeded, 10);
    const videosNum = parseInt(videosPerCreator, 10);
    
    if (
      !title.trim() || 
      !description.trim() || 
      selectedPlatforms.length === 0 || 
      isNaN(rateNum) || rateNum <= 0 || 
      isNaN(creatorsNum) || creatorsNum <= 0 || 
      isNaN(videosNum) || videosNum <= 0
    ) {
      toast({ title: 'All fields are required', description: 'Please fill out the form completely.', variant: 'destructive' });
      return;
    }
    
    setIsSubmitting(true);
    toast({ title: "Redirecting to Payment", description: "Please complete the payment to post your gig." });
    
    try {
      trackEvent({ action: 'fund_gig_start', category: 'marketplace', label: title });
      const createCheckout = httpsCallable(functions, 'createGigFundingCheckoutSession');
      const result = await createCheckout({
        title: title.trim(),
        description: description.trim(),
        platforms: selectedPlatforms,
        ratePerCreator: rateNum,
        creatorsNeeded: creatorsNum,
        videosPerCreator: videosNum,
        campaignType,
        usageRights,
        allowWhitelisting,
      });
      const data = result.data as { url?: string };
      if (data.url) {
          window.location.href = data.url;
      } else {
          throw new Error("Failed to get payment URL.");
      }
    } catch (error: any) {
        console.error("Error initiating gig funding:", error);
        toast({ 
          title: 'Funding Failed', 
          description: error.message || 'Could not initiate the funding process.', 
          variant: 'destructive' 
        });
        setIsSubmitting(false);
    }
  };

  if (authLoading || isLoadingSubscriptionCheck) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }
  
  const canPostGigRole = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';

  if (!user || !canPostGigRole) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Only agency team members can post new gigs.</p>
      </div>
    );
  }

  const nowTime = Date.now();
  const isSubscribed = agencyOwner?.subscriptionStatus === 'active' || 
                      (agencyOwner?.subscriptionStatus === 'trialing' && 
                       agencyOwner?.trialEndsAt && 
                       agencyOwner.trialEndsAt.toMillis() > nowTime);
  const hasAgencyPlan = agencyOwner?.subscriptionPlanId?.startsWith('agency_');
  const canPost = isSubscribed && hasAgencyPlan;

  if (!canPost) {
    return (
      <>
        <PageHeader title="Post a New Gig" description="Find creators for your next campaign." />
        <Card className="max-w-2xl mx-auto shadow-lg border-primary/20">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary font-semibold">
              <Building className="h-5 w-5" />
              Agency Requirement
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert variant="default" className="border-primary/50 bg-primary/5 text-primary-foreground [&>svg]:text-primary">
              <Sparkles className="h-5 w-5" />
              <AlertTitle className="font-semibold text-primary">Agency Subscription Required</AlertTitle>
              <AlertDescription className="text-primary/90">
                {user.isAgencyOwner 
                  ? "You need an active Agency subscription to post gigs to the marketplace. This plan covers talent management and payout fees."
                  : "Your agency needs an active Agency subscription to post gigs. Please contact your agency owner to upgrade the account plan."}
              </AlertDescription>
              {user.isAgencyOwner && (
                <div className="mt-4">
                  <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Link href="/settings">
                      Upgrade to Agency Plan <ExternalLink className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              )}
            </Alert>
            <Button variant="outline" asChild className="w-full">
              <Link href="/gigs">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Gigs
              </Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Post a New Gig"
        description="Describe your project, set your rate, and find creators."
        actions={
            <Button variant="outline" asChild>
                <Link href="/gigs"><ArrowLeft className="mr-2 h-4 w-4"/> Cancel</Link>
            </Button>
        }
      />
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3">
          <form onSubmit={handleSubmit} className="space-y-8">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>1. Campaign Selection</CardTitle>
                <CardDescription>Choose the type of engagement for this campaign.</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup value={campaignType} onValueChange={(val) => setCampaignType(val as any)} className="space-y-4">
                  <div className={cn(
                    "flex items-start space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer",
                    campaignType === 'standard_sponsorship' ? "border-primary bg-primary/5" : "border-muted hover:border-primary/30"
                  )}>
                    <RadioGroupItem value="standard_sponsorship" id="standard" className="mt-1" />
                    <Label htmlFor="standard" className="flex-1 cursor-pointer">
                      <p className="font-bold text-base">Standard Sponsorship</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Includes ad-reads, usage rights, and whitelisting options. Standard commercial requirements apply.
                      </p>
                    </Label>
                  </div>
                  <div className={cn(
                    "flex items-start space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer",
                    campaignType === 'production_grant' ? "border-primary bg-primary/5" : "border-muted hover:border-primary/30"
                  )}>
                    <RadioGroupItem value="production_grant" id="grant" className="mt-1" />
                    <Label htmlFor="grant" className="flex-1 cursor-pointer">
                      <p className="font-bold text-base">Production Grant / Editorial Funding</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        No ad-read required. Funds are used to support independent creator content. Brand receives editorial credit.
                      </p>
                    </Label>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                  <CardTitle>2. Project Details</CardTitle>
                  <CardDescription>
                    Describe your {campaignType === 'production_grant' ? 'grant scope' : 'user-generated content (UGC) campaign'}.
                  </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="title">Gig Title</Label>
                    <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Unboxing Video for Skincare Product" required disabled={isSubmitting} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="description">Project Description</Label>
                    <div className="min-h-[200px] rounded-md border border-input bg-background">
                      <ReactQuill
                        theme="snow"
                        value={description}
                        onChange={setDescription}
                        placeholder="Describe the content you need, key talking points, and any do's or don'ts."
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
                        <Input id="rate" type="number" value={ratePerCreator} onChange={e => setRatePerCreator(e.target.value)} placeholder="2500" required min="1" disabled={isSubmitting}/>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="creators">Creators Needed</Label>
                        <Input id="creators" type="number" value={creatorsNeeded} onChange={e => setCreatorsNeeded(e.target.value)} placeholder="25" required min="1" disabled={isSubmitting}/>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="videos">Videos per Creator</Label>
                        <Input id="videos" type="number" value={videosPerCreator} onChange={e => setVideosPerCreator(e.target.value)} placeholder="1" required min="1" disabled={isSubmitting}/>
                    </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-primary/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> 3. Usage Rights & Legal</CardTitle>
                <CardDescription>Define how you plan to use the content created for this gig.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Label>Usage Rights Duration</Label>
                  <RadioGroup value={usageRights} onValueChange={(val) => setUsageRights(val as any)} className="flex flex-col sm:flex-row flex-wrap gap-4">
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
                                <p>
                                  The brand claims no commercial usage rights over the final video. 
                                  The creator retains full ownership and 100% of their standard sponsor inventory.
                                </p>
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
                    disabled={campaignType === 'production_grant'}
                  />
                </div>

                <div className="p-4 border border-primary/20 rounded-lg bg-primary/5 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">Verza Standard Agreement</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    By funding this campaign, you agree to Verza's 
                    <Dialog>
                      <DialogTrigger asChild>
                        <button type="button" className="text-primary hover:underline font-medium mx-1">
                          Terms of Service
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-primary" />
                            Terms of Service
                          </DialogTitle>
                          <DialogDescription>
                            General terms and conditions for using the Verza platform.
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="flex-1 mt-4 pr-4 border rounded-md p-4 bg-muted/10">
                          <div className="space-y-4 text-sm leading-relaxed">
                            <p className="font-bold">1. ACCEPTANCE</p>
                            <p>
                              By accessing or using the Verza platform, you agree to be bound by these Terms of Service. 
                              If you are using the platform on behalf of an agency or brand, you represent that you 
                              have the authority to bind that entity to these terms.
                            </p>
                            <p className="font-bold">2. MARKETPLACE ROLE</p>
                            <p>
                              Verza provides a marketplace for brands and creators to collaborate. Verza is not a 
                              party to the specific creative agreements except as specified in the Escrow and 
                              Payment sections.
                            </p>
                            <p className="font-bold">3. ACCOUNT SECURITY</p>
                            <p>
                              You are responsible for maintaining the confidentiality of your account credentials 
                              and for all activities that occur under your account.
                            </p>
                          </div>
                        </ScrollArea>
                        <DialogFooter className="mt-4">
                          <DialogClose asChild>
                            <Button variant="outline">Close</Button>
                          </DialogClose>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    and 
                    <Dialog>
                      <DialogTrigger asChild>
                        <button type="button" className="text-primary hover:underline font-medium mx-1">
                          Escrow Agreement
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-primary" />
                            Escrow & Payment Agreement
                          </DialogTitle>
                          <DialogDescription>
                            Rules governing campaign funding and secure creator payouts.
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="flex-1 mt-4 pr-4 border rounded-md p-4 bg-muted/10">
                          <div className="space-y-4 text-sm leading-relaxed">
                            <p className="font-bold">1. CAMPAIGN VAULT</p>
                            <p>
                              When you post a gig, you are required to pre-fund the total campaign cost. 
                              These funds are held by Verza in a secure Campaign Vault (Escrow).
                            </p>
                            <p className="font-bold">2. VERIFICATION & RELEASE</p>
                            <p>
                              Funds are only released to a creator once they have submitted their work and 
                              you have manually approved the verified submission in your dashboard. 
                              Once approved, the release is final and non-refundable.
                            </p>
                            <p className="font-bold">3. DISPUTE RESOLUTION</p>
                            <p>
                              In the event of a non-responsive creator or failed quality score, funds remain 
                              in the vault. Brands may request a refund for unspent escrow funds after 30 
                              days of campaign inactivity.
                            </p>
                          </div>
                        </ScrollArea>
                        <DialogFooter className="mt-4">
                          <DialogClose asChild>
                            <Button variant="outline">Close</Button>
                          </DialogClose>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    . Verza will hold all payments securely until verified submission approval and will generate a 
                    binding clickwrap agreement with the selected creators based on these campaign terms.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {totalAmount > 0 && (
                <div className="p-6 border rounded-lg bg-primary/5 text-center shadow-inner">
                  <p className="text-sm text-muted-foreground font-medium">Total Project Funding Required</p>
                  <p className="text-4xl font-black text-primary mt-1">${totalAmount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-2">({creatorsNeeded} creators x ${ratePerCreator} rate)</p>
                </div>
              )}

              <Button type="submit" className="w-full h-12 text-lg font-bold" disabled={isSubmitting || totalAmount <= 0}>
                {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <DollarSign className="mr-2 h-5 w-5" />}
                Fund & Post Campaign
              </Button>
            </div>
          </form>
        </div>

        <div className="lg:col-span-1">
          <MarketplaceCoPilot context="post" className="sticky top-8" />
        </div>
      </div>
    </>
  );
}

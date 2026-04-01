
'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { doc, onSnapshot, updateDoc, getDoc, collection, query, where, documentId, addDoc, serverTimestamp, deleteDoc, arrayUnion } from 'firebase/firestore';
import { functions, db, storage, ref as storageRef, uploadBytes, getDownloadURL } from '@/lib/firebase';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import type { Gig, GigSubmission, Notification, Agency, AffiliateLink } from '@/types';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, CheckCircle, Ticket, Users, Edit, DollarSign, UploadCloud, Download, Flame, Star, Video, Wallet, ArrowLeft, Trash2, PartyPopper, Scale, ShieldCheck, Info, FileText, Link2, Copy, Check, MousePointer2, Target, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { httpsCallable } from 'firebase/functions';
import { runVerzaScore } from '@/ai/flows/gauntlet-flow';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MarketplaceCoPilot } from '@/components/marketplace/marketplace-copilot';
import { trackEvent } from '@/lib/analytics';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import confetti from 'canvas-confetti';
import { cn } from '@/lib/utils';

function GigDetailContent() {
  const params = useParams();
  const gigId = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading, refreshAuthUser } = useAuth();
  const { toast } = useToast();

  const [gig, setGig] = useState<Gig | null>(null);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [acceptedCreators, setAcceptedCreators] = useState<UserProfile[]>([]);
  const [submissions, setSubmissions] = useState<GigSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isPaying, setIsPaying] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResumingFunding, setIsResumingFunding] = useState(false);
  const [isWalletFunding, setIsWalletFunding] = useState(false);

  const [isUploading, setIsUploading] = useState<number | null>(null);
  const [isRunningVerzaScore, setIsRunningVerzaScore] = useState<string | null>(null);

  // Affiliate State
  const [affiliateLinks, setAffiliateLinks] = useState<Record<string, AffiliateLink>>({});
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Acceptance State
  const [hasAgreedToLegal, setHasAgreedToLegal] = useState(false);
  const [userAgencies, setUserAgencies] = useState<Agency[]>([]);
  const [selectedTalentId, setSelectedTalentId] = useState<string | null>(null);
  const [isAgencyAcceptance, setIsAgencyAcceptance] = useState(false);

  const payoutCreatorForGigCallable = httpsCallable(functions, 'payoutCreatorForGig');
  const createGigFundingCheckoutSessionCallable = httpsCallable(functions, 'createGigFundingCheckoutSession');
  const fundGigFromWalletCallable = httpsCallable(functions, 'fundGigFromWallet');

  useEffect(() => {
    if (searchParams.get('funding_success') === 'true' && gig) {
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

      const totalValue = (gig.ratePerCreator || 0) * (gig.creatorsNeeded || 0);

      trackEvent({
        action: 'deployment_funding_success',
        category: 'revenue',
        label: gig.title,
        value: totalValue
      });

      router.replace(`/deployments/${gigId}`, { scroll: false });
    }
  }, [searchParams, gig, gigId, router]);

  useEffect(() => {
    if (!gigId) {
      setIsLoading(false);
      return;
    }

    const gigDocRef = doc(db, 'gigs', gigId);
    const unsubscribeGig = onSnapshot(gigDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() } as Gig;
          setGig(data);

          // Fetch agency data if viewer can manage
          const isAgencyTeam = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';
          const isAssignedAgent = Object.values(data.assignments || {}).some(a => a.agentId === user?.uid);
          const canManage = user && (isAgencyTeam && (data.brandId === user.primaryAgencyId || user.agencyMemberships?.some(m => m.agencyId === data.brandId)) || isAssignedAgent);
          
          if (canManage) {
            onSnapshot(doc(db, 'agencies', data.brandId), (snap) => {
              if (snap.exists()) setAgency({ id: snap.id, ...snap.data() } as Agency);
            });
          }
        } else {
          setGig(null);
        }
        setIsLoading(false);
      },
      async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: gigDocRef.path,
          operation: 'get',
        } satisfies SecurityRuleContext);
        errorEmitter.emit('permission-error', permissionError);
        setIsLoading(false);
      }
    );

    return () => unsubscribeGig();
  }, [gigId, user]);

  useEffect(() => {
    if (!user) return;

    // Fetch agencies where user is owner or admin/member
    const agenciesQuery = query(collection(db, 'agencies'), where('ownerId', '==', user.uid));
    const unsubscribeAgencies = onSnapshot(agenciesQuery, (snap) => {
      const agencies = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Agency));
      setUserAgencies(agencies);
    });

    return () => unsubscribeAgencies();
  }, [user]);

  const activeTalent = useMemo(() => {
    if (userAgencies.length === 0) return [];
    // Flatten all talent from all managed agencies
    const allTalent = userAgencies.flatMap(a => a.talent || []).filter(t => t.status === 'active');
    // De-duplicate by userId
    const uniqueTalent = Array.from(new Map(allTalent.map(t => [t.userId, t])).values());
    return uniqueTalent;
  }, [userAgencies]);

  useEffect(() => {
    if (!gig || !user) return;

    const isBrandTeam = gig.brandId === user.primaryAgencyId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId);
    const isAssignedAgent = Object.values(gig.assignments || {}).some(a => a.agentId === user.uid);
    const hasAccepted = gig.acceptedCreatorIds?.includes(user.uid);

    if (!isBrandTeam && !hasAccepted && !isAssignedAgent) return;

    // Brands and managing agents can see all submissions for context
    const submissionsQuery = isBrandTeam
      ? query(collection(db, 'submissions'), where('gigId', '==', gigId), where('brandId', '==', gig.brandId))
      : isAssignedAgent
        ? query(collection(db, 'submissions'), where('gigId', '==', gigId))
        : query(collection(db, 'submissions'), where('gigId', '==', gigId), where('creatorId', '==', user.uid));

    const unsubscribeSubmissions = onSnapshot(submissionsQuery,
      (snapshot) => {
        const subs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GigSubmission));
        setSubmissions(subs);
      },
      async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: 'submissions',
          operation: 'list',
        } satisfies SecurityRuleContext);
        errorEmitter.emit('permission-error', permissionError);
      }
    );

    // Fetch affiliate links
    const linksQuery = (isBrandTeam || isAssignedAgent)
      ? query(collection(db, 'affiliateLinks'), where('gigId', '==', gigId))
      : query(collection(db, 'affiliateLinks'), where('gigId', '==', gigId), where('creatorId', '==', user.uid));

    const unsubscribeLinks = onSnapshot(linksQuery, (snap) => {
      const linksMap: Record<string, AffiliateLink> = {};
      snap.docs.forEach(d => {
        const link = { id: d.id, ...d.data() } as AffiliateLink;
        linksMap[link.creatorId] = link;
      });
      setAffiliateLinks(linksMap);
    });

    return () => {
      unsubscribeSubmissions();
      unsubscribeLinks();
    };
  }, [gig, user, gigId]);

  useEffect(() => {
    if (gig && gig.acceptedCreatorIds && gig.acceptedCreatorIds.length > 0) {
      const creatorsQuery = query(collection(db, 'users'), where(documentId(), 'in', gig.acceptedCreatorIds));
      const unsubscribe = onSnapshot(creatorsQuery,
        (snapshot) => {
          const creatorsData = snapshot.docs.map(d => d.data() as UserProfile);
          setAcceptedCreators(creatorsData);
        },
        async (serverError) => {
          const permissionError = new FirestorePermissionError({
            path: 'users',
            operation: 'list',
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        }
      );
      return () => unsubscribe();
    } else {
      setAcceptedCreators([]);
    }
  }, [gig]);

  const handleAcceptGig = async () => {
    if (!user || !gig) return;

    if (!hasAgreedToLegal) {
      toast({ title: "Legal Agreement Required", description: "Please agree to the terms before securing the deployment.", variant: "destructive" });
      return;
    }

    if (!user.stripeAccountId || !user.stripePayoutsEnabled) {
      toast({
        title: "Bank Account Required",
        description: "You must connect your bank account before you can secure paid deployments. Head to Settings to get set up securely.",
        variant: "destructive",
        action: (
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings">Settings</Link>
          </Button>
        ),
      });
      return;
    }

    if (!user.showInMarketplace) {
      toast({
        title: "Public Profile Required",
        description: "Your profile must be set to 'Public' in the network before you can secure deployments. Head to your profile settings to enable this.",
        variant: "destructive",
        action: (
          <Button variant="outline" size="sm" asChild>
            <Link href="/profile">Profile Settings</Link>
          </Button>
        ),
      });
      return;
    }

    setIsAccepting(true);
    const gigDocRef = doc(db, 'gigs', gig.id);
    const targetUserId = isAgencyAcceptance && selectedTalentId ? selectedTalentId : user.uid;

    try {
      const currentGigSnap = await getDoc(gigDocRef);
      if (!currentGigSnap.exists()) throw new Error("Deployment no longer exists.");
      const currentGigData = currentGigSnap.data() as Gig;
      const acceptedIds = currentGigData.acceptedCreatorIds || [];

      if (acceptedIds.length >= (currentGigData.creatorsNeeded || 0)) throw new Error("Deployment is full.");
      if (acceptedIds.includes(targetUserId)) throw new Error(`${isAgencyAcceptance ? 'This talent' : 'You'} already secured this.`);

      const newAcceptedIds = [...acceptedIds, targetUserId];
      const gigUpdates: any = { 
        acceptedCreatorIds: newAcceptedIds,
        updatedAt: serverTimestamp()
      };
      if (newAcceptedIds.length === (currentGigData.creatorsNeeded || 0)) gigUpdates.status = 'in-progress';

      // Handle agency assignment metadata
      if (isAgencyAcceptance && selectedTalentId) {
        const talentDoc = activeTalent.find(t => t.userId === selectedTalentId);
        const agencyDoc = userAgencies.find(a => a.talent.some(t => t.userId === selectedTalentId));
        
        if (talentDoc && agencyDoc) {
          gigUpdates[`assignments.${selectedTalentId}`] = {
            agencyId: agencyDoc.id,
            agencyName: agencyDoc.name,
            agentId: user.uid,
            commissionRate: talentDoc.commissionRate ?? 15,
            assignedAt: serverTimestamp()
          };
          gigUpdates.agentIds = arrayUnion(user.uid);
        }
      }

      await updateDoc(gigDocRef, gigUpdates);

      // Create affiliate link if enabled
      if (currentGigData.affiliateSettings?.isEnabled) {
        let generatedPromoCode = undefined;
        let creatorName = user.displayName;

        if (isAgencyAcceptance && selectedTalentId) {
          const talentDoc = activeTalent.find(t => t.userId === selectedTalentId);
          if (talentDoc) creatorName = talentDoc.displayName;
        }

        const trackingMethod = currentGigData.affiliateSettings.trackingMethod || 'link_only';

        if (trackingMethod === 'promo_code_only' || trackingMethod === 'both') {
          const prefix = currentGigData.affiliateSettings.promoCodePrefix || '';
          const namePart = (creatorName || 'CREATOR').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          generatedPromoCode = `${prefix}${namePart}`;
        }

        await addDoc(collection(db, 'affiliateLinks'), {
          gigId: gig.id,
          creatorId: targetUserId,
          brandId: gig.brandId,
          destinationUrl: currentGigData.affiliateSettings.destinationUrl,
          ...(generatedPromoCode && { promoCode: generatedPromoCode }),
          clicks: 0,
          conversions: 0,
          earnedRewards: 0,
          createdAt: serverTimestamp(),
        });
      }

      trackEvent({ action: 'accept_deployment', category: 'marketplace', label: gig.title });

      // Notify the brand
      const brandAgencySnap = await getDoc(doc(db, 'agencies', currentGigData.brandId));
      if (brandAgencySnap.exists()) {
        const brandAgencyData = brandAgencySnap.data();
        await addDoc(collection(db, 'notifications'), {
          userId: brandAgencyData.ownerId,
          title: isAgencyAcceptance ? "Agency assigned talent!" : "New creator joined!",
          message: isAgencyAcceptance 
            ? `${user.displayName || 'An agency'} has assigned ${activeTalent.find(t => t.userId === selectedTalentId)?.displayName || 'talent'} to your deployment "${gig.title}".`
            : `${user.displayName || 'A creator'} has secured your deployment "${gig.title}".`,
          type: 'gig_accepted',
          read: false,
          link: `/deployments/${gig.id}`,
          createdAt: serverTimestamp(),
        });
      }

      // Notify the talent if they were assigned by an agency
      if (isAgencyAcceptance && selectedTalentId) {
        await addDoc(collection(db, 'notifications'), {
          userId: selectedTalentId,
          title: "New Deployment Assigned!",
          message: `Your agency ${userAgencies.find(a => a.talent.some(t => t.userId === selectedTalentId))?.name || ''} has secured a spot for you on the "${gig.title}" deployment.`,
          type: 'system',
          read: false,
          link: `/deployments/${gig.id}`,
          createdAt: serverTimestamp(),
        });
      }

      // Update the creator's profile to track who they are working for
      const userUpdates = { giggingForAgencies: arrayUnion(currentGigData.brandId) };
      await updateDoc(doc(db, 'users', targetUserId), userUpdates);

      toast({ title: "Deployment Secured!" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleGenerateAffiliateLink = async () => {
    if (!user || !gig || !gig.affiliateSettings) return;
    
    setIsAccepting(true);
    try {
      let creatorName = user.displayName;
      let promoCode = undefined;
      
      if (gig.affiliateSettings.trackingMethod !== 'link_only') {
        const prefix = gig.affiliateSettings.promoCodePrefix || '';
        promoCode = `${prefix}${creatorName?.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
      }
      
      await addDoc(collection(db, 'affiliateLinks'), {
        gigId: gig.id,
        creatorId: user.uid,
        brandId: gig.brandId,
        destinationUrl: gig.affiliateSettings.destinationUrl,
        ...(promoCode && { promoCode }),
        clicks: 0,
        conversions: 0,
        earnedRewards: 0,
        createdAt: serverTimestamp(),
      });
      toast({ title: "Link Generated!", description: "Your performance tracking is now active." });
    } catch (e: any) {
      console.error(e);
      toast({ title: "Generation Failed", description: "Could not create link. Try again or contact support.", variant: "destructive" });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleCopyAffiliateLink = (linkId?: string) => {
    if (!linkId) return;
    const url = `${window.location.origin}/l/${linkId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast({ title: "Link Copied!", description: "Share this unique link to track performance." });
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>, slotIndex: number) => {
    const file = e.target.files?.[0];
    if (!file || !user || !gig) return;
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: "File too large", description: "Videos must be under 100MB.", variant: "destructive" });
      return;
    }
    setIsUploading(slotIndex);
    try {
      const path = `submissions/${gig.id}/${user.uid}/${slotIndex}_${Date.now()}_${file.name}`;
      const fileRef = storageRef(storage, path);
      const uploadResult = await uploadBytes(fileRef, file);
      const videoUrl = await getDownloadURL(uploadResult.ref);

      const isVerzaRequired = gig.requireVerzaScore ?? true;
      const subData: Omit<GigSubmission, 'id'> = {
        gigId: gig.id,
        brandId: gig.brandId,
        creatorId: user.uid,
        creatorName: user.displayName || 'Creator',
        creatorAvatarUrl: user.avatarUrl || null,
        videoUrl,
        verzaScore: 0,
        verzaFeedback: "",
        status: isVerzaRequired ? 'pending_verza_score' : 'submitted',
        createdAt: serverTimestamp() as any,
      };

      const existingAtSlot = mySubmissions[slotIndex];
      if (existingAtSlot) {
        await updateDoc(doc(db, 'submissions', existingAtSlot.id), subData);
      } else {
        await addDoc(collection(db, 'submissions'), subData);
      }
      trackEvent({ action: 'video_upload', category: 'marketplace', label: `slot_${slotIndex}` });

      if (!isVerzaRequired) {
        const agencySnap = await getDoc(doc(db, 'agencies', gig.brandId));
        if (agencySnap.exists()) {
          const agencyData = agencySnap.data();
          await addDoc(collection(db, 'notifications'), {
            userId: agencyData.ownerId,
            title: "New submission received",
            message: `${user?.displayName || 'A creator'} submitted a video for "${gig.title}".`,
            type: 'submission_received',
            read: false,
            link: `/deployments/${gig.id}`,
            createdAt: serverTimestamp(),
          } as Omit<Notification, 'id'>);
        }
        toast({ title: `Video ${slotIndex + 1} uploaded!`, description: "Your submission has been sent to the brand." });
      } else {
        toast({ title: `Video ${slotIndex + 1} uploaded!`, description: "Calculate your Verza Score to verify your work." });
      }
    } catch (error: any) {
      console.error(error);
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setIsUploading(null);
    }
  };

  const handleRunVerzaScore = async (submission: GigSubmission) => {
    if (!gig) return;
    setIsRunningVerzaScore(submission.id);
    toast({ title: "Calculating Verza Score...", description: "AI is analyzing engagement potential..." });
    try {
      trackEvent({ action: 'verza_score_start', category: 'ai_tool', label: gig.title });
      const result = await runVerzaScore({ videoUrl: submission.videoUrl });
      const subRef = doc(db, 'submissions', submission.id);

      const threshold = gig.verzaScoreThreshold ?? 65;
      const updates: Partial<GigSubmission> = {
        verzaScore: result.score,
        verzaFeedback: result.feedback,
        status: result.score >= threshold ? 'submitted' : 'rejected'
      };

      await updateDoc(subRef, updates);

      if (result.score >= threshold) {
        trackEvent({ action: 'verza_score_pass', category: 'ai_tool', label: gig.title, value: result.score });
        const agencySnap = await getDoc(doc(db, 'agencies', gig.brandId));
        if (agencySnap.exists()) {
          const agencyData = agencySnap.data();
          await addDoc(collection(db, 'notifications'), {
            userId: agencyData.ownerId,
            title: "New submission received",
            message: `${user?.displayName || 'A creator'} submitted a video for "${gig.title}".`,
            type: 'submission_received',
            read: false,
            link: `/deployments/${gig.id}`,
            createdAt: serverTimestamp(),
          } as Omit<Notification, 'id'>);
        }
        toast({ title: "VERZA SCORE PASSED!", description: `Score: ${result.score}%. Your work is now with the brand.` });
      } else {
        trackEvent({ action: 'verza_score_fail', category: 'ai_tool', label: gig.title, value: result.score });
        toast({ title: "VERZA SCORE LOW", description: `Score: ${result.score}%. Check the feedback and try again.`, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Analysis Error", description: error.message, variant: "destructive" });
    } finally {
      setIsRunningVerzaScore(null);
    }
  };

  const handlePayout = async (creator: UserProfile) => {
    if (!user || !gig) return;
    setIsPaying(creator.uid);
    try {
      await payoutCreatorForGigCallable({ gigId: gig.id, creatorId: creator.uid });

      const batch = submissions.filter(s => s.creatorId === creator.uid && (s.status === 'submitted' || s.status === 'rejected'));
      for (const sub of batch) {
        await updateDoc(doc(db, 'submissions', sub.id), { status: 'approved' });
      }

      await addDoc(collection(db, 'notifications'), {
        userId: creator.uid,
        title: "Payout Received!",
        message: `Your work for "${gig.title}" has been approved and paid.`,
        type: 'payout_received',
        read: false,
        link: '/wallet',
        createdAt: serverTimestamp(),
      } as Omit<Notification, 'id'>);

      trackEvent({ action: 'deployment_payout', category: 'marketplace', label: gig.title, value: gig.ratePerCreator });
      toast({ title: "Payout Processing!", description: "The creator has been paid successfully." });
    } catch (error: any) {
      toast({ title: "Payout Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsPaying(null);
    }
  };

  const handleDeleteGig = async () => {
    if (!gig) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'gigs', gig.id));
      toast({ title: "Deployment Deleted", description: "The deployment has been removed." });
      router.push('/deployments');
    } catch (error: any) {
      console.error(error);
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResumeFunding = async () => {
    if (!gig) return;
    setIsResumingFunding(true);
    trackEvent({
      action: 'deployment_funding_checkout_start',
      category: 'revenue',
      label: gig.title
    });

    try {
      const result = await createGigFundingCheckoutSessionCallable({
        id: gig.id,
        title: gig.title,
        description: gig.description,
        platforms: gig.platforms,
        ratePerCreator: gig.ratePerCreator,
        creatorsNeeded: gig.creatorsNeeded,
        videosPerCreator: gig.videosPerCreator,
        campaignType: gig.campaignType || 'standard_sponsorship',
        usageRights: gig.usageRights || '1_year',
        allowWhitelisting: !!gig.allowWhitelisting,
        affiliateSettings: gig.affiliateSettings,
      });
      const data = result.data as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("Failed to get payment URL.");
      }
    } catch (error: any) {
      console.error(error);
      toast({ title: "Funding Error", description: error.message, variant: "destructive" });
    } finally {
      setIsResumingFunding(false);
    }
  };

  const handleWalletFunding = async () => {
    if (!gig || !agency) return;
    setIsWalletFunding(true);
    try {
      await fundGigFromWalletCallable({ gigId: gig.id });

      const totalValue = (gig.ratePerCreator || 0) * (gig.creatorsNeeded || 0);
      trackEvent({
        action: 'deployment_funding_success',
        category: 'revenue',
        label: gig.title,
        value: totalValue
      });

      toast({ title: "Deployment Funded!", description: "Funds have been moved from your wallet to this campaign." });
    } catch (error: any) {
      toast({ title: "Funding Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsWalletFunding(false);
    }
  };

  const mySubmissions = useMemo(() => user ? submissions.filter(s => s.creatorId === user.uid).sort((a, b) => (a.createdAt as any)?.toMillis() - (b.createdAt as any)?.toMillis()) : [], [submissions, user]);

  const getStatusLabel = (status: string) => {
    if (status === 'open') {
      return (gig?.ratePerCreator || 0) > 0 ? 'Capital Available' : 'Performance Only';
    }
    if (status === 'pending_payment') return 'Funding Pending';
    if (status === 'in-progress') return 'In Progress';
    if (status === 'completed') return 'Deployment Complete';
    return status?.replace(/_/g, ' ') || 'unknown';
  };

  if (isLoading || authLoading) return <div className="flex justify-center items-center h-96"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  if (!gig) return <div className="text-center py-10"><AlertTriangle className="mx-auto h-12 w-12 text-destructive" /><h3 className="mt-4">Deployment Not Found</h3></div>;

  const acceptedIds = gig.acceptedCreatorIds || [];
  const spotsLeft = (gig.creatorsNeeded || 0) - acceptedIds.length;
  const hasAccepted = user ? acceptedIds.includes(user.uid) : false;
  const isAgencyTeam = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';
  const isBrandTeam = user && gig && isAgencyTeam && (gig.brandId === user.primaryAgencyId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId));
  const isAssignedAgent = user && gig && Object.values(gig.assignments || {}).some(a => a.agentId === user.uid);
  const canManageGig = isBrandTeam || isAssignedAgent;
  const isStripeSetup = user?.stripeAccountId && user?.stripePayoutsEnabled;
  const canDeleteGig = isBrandTeam && (gig.status === 'pending_payment' || (gig.status === 'open' && acceptedIds.length === 0));
  const isCompleted = gig.status === 'completed';

  const usageRightsLabel = gig.usageRights === 'none' ? 'Editorial Support Only' : (gig.usageRights === 'perpetuity' ? 'In Perpetuity' : (gig.usageRights === '30_days' ? '30 Days' : '1 Year'));
  const campaignTypeLabel = gig.campaignType === 'production_grant' ? 'Production Grant / Editorial Funding' : 'Standard Sponsorship';

  const totalCost = gig.ratePerCreator * gig.creatorsNeeded;
  const canAffordWithWallet = agency && (agency.availableBalance || 0) >= totalCost;

  const myLink = user ? affiliateLinks[user.uid] : null;

  return (
    <>
      <div className="flex flex-col gap-8 pb-20">
        <PageHeader
          title={gig.title}
          description={`Campaign by ${gig.brandName}`}
          actions={<Button asChild variant="outline"><Link href="/deployments"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        />

        {isCompleted && (
          <Alert className="bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800 text-green-800 dark:text-green-300">
            <PartyPopper className="h-5 w-5" />
            <AlertTitle className="font-bold">Deployment Complete!</AlertTitle>
            <AlertDescription>
              {canManageGig
                ? `All ${gig.creatorsNeeded} creators have finished and been paid for their work.`
                : `This campaign is officially complete. Your submission has been approved and your payout processed.`}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-8 min-w-0">
            {hasAccepted && gig.affiliateSettings?.isEnabled && (
              <Card className="border-blue-500/30 bg-blue-50/10 shadow-lg animate-in zoom-in-95 duration-300">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-blue-600"><Link2 className="h-5 w-5" /> Performance Tracking</CardTitle>
                  <CardDescription>Share your unique tracking hook to track performance and earn bonuses.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(!gig.affiliateSettings?.trackingMethod || gig.affiliateSettings.trackingMethod === 'link_only' || gig.affiliateSettings.trackingMethod === 'both') && (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Your Tracking Link</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 p-3 bg-background border rounded-md font-mono text-sm break-all">
                          {myLink ? (
                            `${window.location.origin}/l/${myLink.id}`
                          ) : (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground italic">Link not yet generated</span>
                              <Button 
                                size="sm" 
                                variant="secondary" 
                                className="h-7 text-[10px]"
                                onClick={handleGenerateAffiliateLink}
                                disabled={isAccepting}
                              >
                                {isAccepting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                                Generate My Link
                              </Button>
                            </div>
                          )}
                        </div>
                        <Button size="icon" onClick={() => handleCopyAffiliateLink(myLink?.id)} disabled={!myLink}>
                          {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  )}

                  {myLink?.promoCode && (gig.affiliateSettings?.trackingMethod === 'promo_code_only' || gig.affiliateSettings?.trackingMethod === 'both') && (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Your Promo Code</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 p-3 bg-background border rounded-md font-mono text-sm font-bold text-center tracking-wider text-xl">
                          {myLink.promoCode}
                        </div>
                        <Button size="icon" onClick={() => {
                          navigator.clipboard.writeText(myLink.promoCode || '');
                          toast({ title: "Promo Code Copied!" });
                        }}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      {gig.affiliateSettings?.promoCodeDiscountValue && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Pitch this code to your audience for <strong>{gig.affiliateSettings?.promoCodeDiscountValue}</strong> down!
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4 pt-2">
                    <div className="p-3 border rounded-lg bg-background text-center">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Total Clicks</p>
                      <p className="text-xl font-bold">{myLink?.clicks || 0}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-background text-center">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Conversions</p>
                      <p className="text-xl font-bold">{myLink?.conversions || 0}</p>
                    </div>
                    <div className="p-3 border rounded-lg bg-blue-500 text-white text-center">
                      <p className="text-[10px] uppercase font-bold opacity-80">Bonus Earned</p>
                      <p className="text-xl font-bold">
                        ${(Math.max(
                          myLink?.earnedRewards || 0,
                          gig.affiliateSettings?.rewardType === 'cpc'
                            ? (myLink?.clicks || 0) * (gig.affiliateSettings?.rewardAmount || 0)
                            : (myLink?.conversions || 0) * (gig.affiliateSettings?.rewardAmount || 0)
                        )).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle>Campaign Objective</CardTitle>
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                    {campaignTypeLabel}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {gig.brandLogoUrl && <Image src={gig.brandLogoUrl} alt="Logo" width={80} height={80} className="rounded-md" />}
                <div className="prose dark:prose-invert max-w-none prose-slate prose-sm sm:prose-base break-words overflow-hidden text-foreground">
                  <div dangerouslySetInnerHTML={{ __html: gig.description }} />
                </div>

                <Separator />

                <div>
                  <h4 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-3">Target Platforms</h4>
                  <div className="flex flex-wrap gap-2">
                    {gig.platforms?.map(p => <Badge key={p} variant="secondary">{p}</Badge>)}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/10 bg-muted/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" /> Legal Summary</CardTitle>
                <CardDescription>Standard terms for this UGC agreement.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Campaign Type</p>
                  <p className="text-sm font-medium">{campaignTypeLabel}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    Usage Rights
                    {gig.usageRights === 'none' && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[250px]">
                            <p>The brand claims no commercial usage rights over the final video. The creator retains full ownership and 100% of their standard sponsor inventory.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </p>
                  <p className="text-sm font-medium">{usageRightsLabel}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Paid Whitelisting</p>
                  <p className="text-sm font-medium">{gig.allowWhitelisting ? 'Allowed' : 'Not Allowed'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    Verza Score
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[250px]">
                          <p>The AI-driven predictive engagement score required for your video to be approved.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </p>
                  <p className="text-sm font-medium">
                    {(gig.requireVerzaScore ?? true) ? `Required (${gig.verzaScoreThreshold ?? 65}%+)` : 'Not Required'}
                  </p>
                </div>
                <div className="md:col-span-2 p-3 bg-background rounded border text-[10px] text-muted-foreground italic">
                  By clicking "Secure Deployment", you enter into a binding agreement with {gig.brandName}. Verza holds your payment in trust and releases it only upon verified submission approval. {(gig.requireVerzaScore ?? true) && `Every video must pass the minimum Verza Score threshold of ${gig.verzaScoreThreshold ?? 65}% prior to submission approval. `}You retain ownership of your content, granting {gig.brandName} a non-exclusive license for the duration specified.
                </div>
              </CardContent>
            </Card>

            {hasAccepted && !canManageGig && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> {isCompleted ? 'Your Submissions' : 'Submit Your Work'}</CardTitle>
                  <CardDescription>
                    {isCompleted
                      ? 'Review the work you submitted for this complete deployment.'
                      : (gig.requireVerzaScore ?? true)
                        ? `Upload ${gig.videosPerCreator} video${gig.videosPerCreator > 1 ? 's' : ''} and calculate your Verza Score for each.`
                        : `Upload ${gig.videosPerCreator} video${gig.videosPerCreator > 1 ? 's' : ''} to complete your deployment.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  {Array.from({ length: gig.videosPerCreator || 1 }).map((_, i) => {
                    const submission = mySubmissions[i];
                    const slotLoading = isUploading === i;
                    const scoreRunning = submission && isRunningVerzaScore === submission.id;

                    return (
                      <div key={i} className="p-6 border rounded-xl bg-muted/20 space-y-4">
                        <div className="flex justify-between items-center">
                          <h4 className="font-bold text-lg flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs">{i + 1}</span>
                            Video Slot {i + 1}
                          </h4>
                          {submission && (
                            <Badge variant={submission.status === 'submitted' || submission.status === 'approved' ? 'default' : 'secondary'} className={submission.status === 'submitted' || submission.status === 'approved' ? 'bg-green-500' : ''}>
                              {submission.status.replace(/_/g, ' ')}
                            </Badge>
                          )}
                        </div>

                        {submission ? (
                          <div className="space-y-4">
                            <div className="aspect-video bg-black rounded-lg overflow-hidden relative group">
                              <video src={submission.videoUrl} controls className="w-full h-full" />
                              <div className="absolute top-2 right-2 flex gap-2">
                                <Button size="icon" variant="secondary" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" asChild>
                                  <a href={submission.videoUrl} download target="_blank" rel="noopener noreferrer">
                                    <Download className="h-3 w-3" />
                                  </a>
                                </Button>
                              </div>
                            </div>

                            {(submission.status === 'pending_verza_score' || submission.status === 'rejected') && (gig.requireVerzaScore ?? true) ? (
                              <div className="p-4 border rounded-lg bg-background space-y-4 shadow-sm">
                                <div className="flex justify-between items-center">
                                  <h5 className="font-semibold text-sm">Verza Score Analysis</h5>
                                  {submission.verzaScore > 0 && <Badge variant={submission.status === 'rejected' ? 'destructive' : 'default'}>{submission.verzaScore}%</Badge>}
                                </div>
                                {submission.verzaFeedback && (
                                  <div className="p-3 bg-muted/50 rounded border border-orange-500/20">
                                    <p className="text-sm italic text-muted-foreground">"{submission.verzaFeedback}"</p>
                                  </div>
                                )}
                                {!isCompleted && (
                                  <Button className="w-full" onClick={() => handleRunVerzaScore(submission)} disabled={!!isRunningVerzaScore}>
                                    {scoreRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Flame className="mr-2 h-4 w-4 text-orange-500" />}
                                    {submission.status === 'rejected' ? 'Retry Verza Score' : 'Calculate Verza Score'}
                                  </Button>
                                )}
                              </div>
                            ) : submission.status !== 'pending_verza_score' && submission.status !== 'rejected' && (
                              <div className="p-4 border rounded-lg bg-green-50/10 text-green-700 flex items-center gap-3">
                                <CheckCircle className="h-5 w-5" />
                                <p className="text-sm font-medium">Verified & {submission.status === 'approved' ? 'Approved' : 'Submitted'}! {(gig.requireVerzaScore ?? true) && submission.verzaScore > 0 ? ` Verza Score: ${submission.verzaScore}%` : ''}</p>
                              </div>
                            )}

                            {!isCompleted && submission.status !== 'approved' && (
                              <div className="pt-2 flex justify-center">
                                <Label htmlFor={`video-replace-${i}`} className="cursor-pointer text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                                  <Edit className="h-3 w-3" /> Replace Video
                                </Label>
                                <input id={`video-replace-${i}`} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => handleVideoUpload(e, i)} disabled={!!isUploading || !!isRunningVerzaScore} />
                              </div>
                            )}
                          </div>
                        ) : (
                          !isCompleted ? (
                            <div className="flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg bg-background hover:bg-muted/30 transition-colors">
                              <input id={`video-upload-${i}`} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => handleVideoUpload(e, i)} disabled={!!isUploading} />
                              <label htmlFor={`video-upload-${i}`} className="cursor-pointer flex flex-col items-center gap-3">
                                <div className="p-4 bg-muted rounded-full">
                                  {slotLoading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <UploadCloud className="h-8 w-8 text-primary" />}
                                </div>
                                <div className="text-center">
                                  <p className="font-medium">{slotLoading ? 'Uploading...' : 'Upload Video'}</p>
                                  <p className="text-sm text-muted-foreground">MP4 or MOV, max 100MB</p>
                                </div>
                              </label>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg bg-background">
                              <p className="text-muted-foreground text-sm italic">Slot empty. This campaign is completed.</p>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {canManageGig && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Users className="text-primary" /> {isCompleted ? 'Final Creator Roster' : 'Creator Roster & Submissions'}</CardTitle>
                  <CardDescription>
                    {isCompleted
                      ? `All ${gig.creatorsNeeded} creators have finished and been paid for their work.`
                      : `Manage secured creators and review their ${gig.videosPerCreator} requested video${gig.videosPerCreator > 1 ? 's' : ''}.`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {acceptedCreators.length > 0 ? (
                    <div className="space-y-6">
                      {acceptedCreators.map(creator => {
                        const isPaid = gig.paidCreatorIds?.includes(creator.uid);
                        const creatorSubmissions = submissions.filter(s => s.creatorId === creator.uid);
                        const allVideosSubmitted = creatorSubmissions.length === (gig.videosPerCreator || 1) && creatorSubmissions.every(s => s.status === 'submitted' || s.status === 'approved');
                        const creatorLink = affiliateLinks[creator.uid];

                        return (
                          <Card key={creator.uid} className="border bg-muted/30">
                            <CardContent className="p-4">
                              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-4 border-b">
                                <div className="flex items-center gap-3">
                                  <Link href={`/creator/${creator.uid}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                                    <Avatar>
                                      <AvatarImage src={creator.avatarUrl || ''} />
                                      <AvatarFallback>{creator.displayName?.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="font-semibold hover:underline">{creator.displayName}</p>
                                        {gig.assignments?.[creator.uid] && (
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] h-4 px-1.5 flex items-center gap-1">
                                                  <ShieldCheck className="h-2.5 w-2.5" /> Managed
                                                </Badge>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p className="text-[10px] font-medium">Secured by {gig.assignments[creator.uid].agencyName || 'Agency'}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground">{creator.email}</p>
                                    </div>
                                  </Link>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {isPaid ? (
                                    <Badge variant="default" className="bg-green-500">Paid</Badge>
                                  ) : (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                      {isBrandTeam && (
                                        <Button 
                                          size="sm" 
                                          disabled={isPaying === creator.uid || !allVideosSubmitted}
                                        >
                                          {isPaying === creator.uid ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4 mr-1" />} Approve & Pay
                                        </Button>
                                      )}
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Approve Submission & Release Payment?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            You are about to release <span className="font-bold text-foreground">${(gig.ratePerCreator || 0).toLocaleString()}</span> to <span className="font-bold text-foreground">{creator.displayName}</span>.
                                            This action confirms the work is complete and releases the funds from escrow. This cannot be undone.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handlePayout(creator)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                                            Confirm & Pay
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                </div>
                              </div>

                              {gig.affiliateSettings?.isEnabled && creatorLink && (
                                <div className="py-3 flex flex-wrap gap-6 border-b">
                                  {creatorLink.promoCode && (
                                    <div className="flex flex-col">
                                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Promo Code</span>
                                      <span className="text-sm font-bold flex items-center gap-1.5 text-orange-600"><Ticket className="h-3 w-3 text-orange-500" /> {creatorLink.promoCode}</span>
                                    </div>
                                  )}
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Affiliate Clicks</span>
                                    <span className="text-sm font-bold flex items-center gap-1.5"><MousePointer2 className="h-3 w-3 text-blue-500" /> {creatorLink.clicks}</span>
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Conversions</span>
                                    <span className="text-sm font-bold flex items-center gap-1.5"><Target className="h-3 w-3 text-green-500" /> {creatorLink.conversions}</span>
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Est. Bonus</span>
                                    <span className="text-sm font-bold text-blue-600">
                                      ${(Math.max(
                                        creatorLink.earnedRewards || 0,
                                        gig.affiliateSettings?.rewardType === 'cpc'
                                          ? (creatorLink.clicks || 0) * (gig.affiliateSettings?.rewardAmount || 0)
                                          : (creatorLink.conversions || 0) * (gig.affiliateSettings?.rewardAmount || 0)
                                      )).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              )}

                              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Array.from({ length: gig.videosPerCreator || 1 }).map((_, idx) => {
                                  const sub = creatorSubmissions[idx];
                                  return (
                                    <div key={idx} className="p-3 bg-background rounded-md border space-y-3">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Video {idx + 1}</span>
                                        {sub && (
                                          <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-[10px] py-0 h-5 gap-1"><Star className="h-2 w-2 text-yellow-500" /> Score: {sub.verzaScore}%</Badge>
                                            <Button size="icon" variant="ghost" className="h-6 w-6" asChild>
                                              <a href={sub.videoUrl} download target="_blank" rel="noopener noreferrer">
                                                <Download className="h-3 w-3" />
                                              </a>
                                            </Button>
                                          </div>
                                        )}
                                      </div>

                                      {sub ? (
                                        <>
                                          <video src={sub.videoUrl} controls className="w-full rounded-md max-h-40 bg-black" />
                                          {sub.verzaFeedback && (
                                            <p className="text-[10px] text-muted-foreground italic line-clamp-2">"{sub.verzaFeedback}"</p>
                                          )}
                                        </>
                                      ) : (
                                        <div className="py-10 text-center border-2 border-dashed rounded-md flex flex-col items-center justify-center bg-muted/10">
                                          <Loader2 className="h-4 w-4 animate-pulse text-muted-foreground mb-2" />
                                          <p className="text-[10px] text-muted-foreground">Pending upload...</p>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </CardContent>
                          </Card>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No creators have secured this deployment yet.</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
          <div className="lg:col-span-1 space-y-6 min-w-0">
            <Card>
              <CardHeader><CardTitle>Deployment Overview</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Base Rate per Creator</span>
                    {(gig.ratePerCreator || 0) > 0 ? (
                      <span className="font-bold text-2xl text-primary">
                        ${(gig.ratePerCreator || 0).toLocaleString()}
                      </span>
                    ) : (
                      <Badge variant="secondary" className="border-blue-500/30 bg-blue-500/5 text-blue-600 font-bold px-2 py-0.5 uppercase text-[10px] tracking-tight animate-pulse">
                        <Zap className="h-3.5 w-3.5 mr-1 fill-blue-600" /> Performance Only
                      </Badge>
                    )}
                  </div>
                  {!canManageGig && (gig.ratePerCreator || 0) > 0 && (
                    <div className="flex justify-between items-center pt-1 border-t border-dashed mt-1">
                      <span className="text-xs text-muted-foreground">Est. Net Payout (15% fee)</span>
                      <span className="text-xs font-semibold">${((gig.ratePerCreator || 0) * 0.85).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                {gig.affiliateSettings?.isEnabled && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-blue-600 uppercase flex items-center gap-1">
                        <Zap className="h-3 w-3" /> Performance Pay
                      </span>
                      <Badge variant="secondary" className="bg-blue-500 text-white hover:bg-blue-600 text-[10px] h-5">
                        {gig.affiliateSettings?.rewardType === 'cpc' ? 'Per Click' : 'Per Sale'}
                      </Badge>
                    </div>
                    <p className="text-xl font-black text-blue-700">${gig.affiliateSettings?.rewardAmount?.toLocaleString()}</p>
                    <p className="text-[10px] text-blue-600/80 leading-tight">Paid automatically for every verified {gig.affiliateSettings?.rewardType === 'cpc' ? 'click' : 'conversion'}.</p>
                  </div>
                )}

                <div className="flex justify-between items-center"><span className="text-muted-foreground flex items-center gap-1"><Video className="h-4 w-4" /> Videos Requested</span><span className="font-bold">{gig.videosPerCreator || 1}</span></div>
                {!isCompleted && (
                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Spots Remaining</span><span className="font-bold">{spotsLeft} / {gig.creatorsNeeded || 0}</span></div>
                )}
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Status</span><Badge variant={gig.status === 'open' ? 'default' : (isCompleted ? 'default' : 'secondary')} className={gig.status === 'open' ? 'bg-green-500' : (isCompleted ? 'bg-blue-500' : '')}>{getStatusLabel(gig.status)}</Badge></div>

                {user && !canManageGig && !isCompleted && (
                  hasAccepted ? (
                    <div className="space-y-4 pt-4 border-t">
                      <Button className="w-full bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/20" disabled>
                        <CheckCircle className="mr-2 h-4 w-4" /> Deployment Secured
                      </Button>
                      
                      
                    </div>
                  ) : spotsLeft > 0 && gig.status === 'open' ? (
                    <div className="space-y-4 border-t pt-4">
                      <div className="flex items-start space-x-2">
                        <Checkbox
                          id="legal-agreement"
                          checked={hasAgreedToLegal}
                          onCheckedChange={(val) => setHasAgreedToLegal(val as boolean)}
                          className="mt-1"
                        />
                        <div className="text-xs leading-relaxed text-muted-foreground">
                          <Label htmlFor="legal-agreement" className="cursor-pointer">
                            I agree to the
                          </Label>
                          <Dialog>
                            <DialogTrigger asChild>
                              <button className="text-primary hover:underline font-medium ml-1 inline-flex items-center">
                                Verza Standard Creator Agreement
                              </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                  <FileText className="h-5 w-5 text-primary" />
                                  Standard Creator Agreement
                                </DialogTitle>
                                <DialogDescription>
                                  The base terms for all Verza network collaborations.
                                </DialogDescription>
                              </DialogHeader>
                              <ScrollArea className="flex-1 mt-4 pr-4 border rounded-md p-4 bg-muted/10">
                                <div className="space-y-4 text-sm leading-relaxed">
                                  <p className="font-bold">1. PARTIES & SCOPE</p>
                                  <p>This Standard Creator Agreement ('Agreement') governs the relationship between the Brand ('Client') and the Content Creator ('Creator') for the specific campaign ('Deployment') defined in this brief.</p>

                                  <p className="font-bold">2. SERVICES & DELIVERABLES</p>
                                  <p>Creator agrees to produce content ('Deliverables') according to the requirements specified in the deployment brief. {gig.requireVerzaScore ? `Deliverables must pass the Verza Quality Score threshold of ${gig.verzaScoreThreshold}% to be eligible for payout.` : "Deliverables must meet the brand's quality standards to be eligible for payout."}</p>

                                  <p className="font-bold">3. PAYMENT & ESCROW</p>
                                  {(gig.ratePerCreator || 0) > 0 ? (
                                    <p>The Client has pre-funded the base rate for this deployment ($ {gig.ratePerCreator?.toLocaleString()}). Funds are held in the Verza Campaign Vault. Verza will release the payment to the Creator's wallet immediately upon Client approval of verified submissions. Payouts are subject to a 15% platform service fee.</p>
                                  ) : (
                                    <p>This is a performance-based deployment. No base rate is guaranteed. Rewards are earned based on the performance metrics (conversions or clicks) defined in this brief. Verza will deposit earned rewards into the Creator's wallet following verification. All payouts are subject to a 15% platform service fee.</p>
                                  )}

                                  <p className="font-bold">4. INTELLECTUAL PROPERTY & USAGE</p>
                                  <p>Unless the deployment is explicitly marked as a 'Production Grant' with 'None' usage rights, the Creator grants the Client a non-exclusive, worldwide, transferable license to use the Deliverables for the duration specified in the brief. Creator retains original ownership of the underlying content.</p>

                                  <p className="font-bold">5. INDEPENDENT CONTRACTOR</p>
                                  <p>Creator is an independent contractor. Nothing in this Agreement creates an employer-employee relationship or partnership.</p>

                                  <p className="font-bold">6. CONFIDENTIALITY</p>
                                  <p>Both parties agree to keep the terms of this deployment and any proprietary brand information confidential.</p>
                                </div>
                              </ScrollArea>

                              {activeTalent.length > 0 && (
                                <div className="mt-4 p-4 rounded-lg border-2 border-primary/10 bg-primary/5 space-y-4">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <Label className="text-sm font-bold flex items-center gap-2">
                                        <Users className="h-4 w-4 text-primary" /> Management Mode
                                      </Label>
                                      <p className="text-[10px] text-muted-foreground">Claim this deployment on behalf of your talent.</p>
                                    </div>
                                    <Checkbox 
                                      id="agency-mode" 
                                      checked={isAgencyAcceptance} 
                                      onCheckedChange={(checked) => setIsAgencyAcceptance(!!checked)}
                                    />
                                  </div>

                                  {isAgencyAcceptance && (
                                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Select Recipient Talent</Label>
                                      <Select value={selectedTalentId || ""} onValueChange={setSelectedTalentId}>
                                        <SelectTrigger className="w-full bg-white dark:bg-zinc-950 border-primary/20">
                                          <SelectValue placeholder="Choose a creator..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {activeTalent.map((t) => (
                                            <SelectItem key={t.userId} value={t.userId}>
                                              <div className="flex items-center gap-2">
                                                <Avatar className="h-5 w-5">
                                                  <AvatarFallback className="text-[8px]">{t.displayName?.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <span>{t.displayName} <span className="text-[10px] text-muted-foreground ml-1">({t.commissionRate || 15}% Commission)</span></span>
                                              </div>
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <div className="p-2 bg-blue-500/10 rounded-md border border-blue-500/20 text-[10px] text-blue-700 leading-tight">
                                        <Info className="h-3 w-3 inline mr-1 -mt-0.5" />
                                        Payouts for this creator will be split automatically with your agency.
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              <DialogFooter className="mt-4">
                                <Button onClick={() => { }} variant="outline">Close</Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                          <span className="ml-1">and the usage terms defined in this brief.</span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {!isStripeSetup && (
                          <Alert variant="destructive" className="py-2 px-3 text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            <AlertDescription>
                              Bank account connection required to receive payouts.
                            </AlertDescription>
                          </Alert>
                        )}
                        {!user.showInMarketplace && (
                          <Alert variant="destructive" className="py-2 px-3 text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            <AlertDescription>
                              Public profile required to secure deployments.
                            </AlertDescription>
                          </Alert>
                        )}
                        <Button
                          className="w-full"
                          onClick={handleAcceptGig}
                          disabled={isAccepting || !hasAgreedToLegal || (isAgencyAcceptance && !selectedTalentId)}
                        >
                          {isAccepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Secure Deployment
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button className="w-full" disabled>{gig.status === 'pending_payment' ? 'Funding Pending' : 'Deployment Full'}</Button>
                  )
                )}

                {isBrandTeam && (
                  <div className="space-y-2">
                    {gig.status === 'pending_payment' && (
                      <div className="flex flex-col gap-2 p-4 border rounded-lg bg-muted/30">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 text-center">Deployment Funding: ${totalCost.toLocaleString()}</p>
                        <Button className="w-full" onClick={handleResumeFunding} disabled={isResumingFunding || isWalletFunding}>
                          {isResumingFunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}
                          Fund via Secure Payment
                        </Button>
                        <div className="flex items-center my-1">
                          <div className="flex-grow border-t"></div>
                          <span className="px-2 text-[10px] text-muted-foreground font-bold">OR</span>
                          <div className="flex-grow border-t"></div>
                        </div>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="w-full">
                                <Button
                                  className="w-full"
                                  variant="secondary"
                                  onClick={handleWalletFunding}
                                  disabled={isResumingFunding || isWalletFunding || !canAffordWithWallet}
                                >
                                  {isWalletFunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
                                  Fund from Wallet
                                </Button>
                              </div>
                            </TooltipTrigger>
                            {!canAffordWithWallet && (
                              <TooltipContent className="bg-destructive text-destructive-foreground">
                                <p>Insufficient wallet balance (${agency?.availableBalance?.toLocaleString()}).</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    )}
                    {isBrandTeam && (
                      <div className="space-y-2">
                        {!isCompleted && (
                          <Button asChild className="w-full" variant="outline">
                            <Link href={`/deployments/${gig.id}/edit`}>
                              <Edit className="mr-2 h-4 w-4" /> Edit Deployment
                            </Link>
                          </Button>
                        )}
                        {canDeleteGig && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button className="w-full" variant="destructive">
                                <Trash2 className="mr-2 h-4 w-4" /> Delete Deployment
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this deployment?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently remove the deployment listing. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDeleteGig} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                                  {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {!isCompleted && (
              <MarketplaceCoPilot
                context={canManageGig ? 'details_brand' : (hasAccepted ? 'details_creator' : 'browse')}
                className="hidden lg:block"
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function GigDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center h-96"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
      <GigDetailContent />
    </Suspense>
  );
}

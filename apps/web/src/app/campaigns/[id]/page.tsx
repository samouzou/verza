
'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { doc, onSnapshot, updateDoc, getDoc, collection, query, where, documentId, addDoc, serverTimestamp, deleteDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { functions, db, storage, ref as storageRef, uploadBytes, getDownloadURL } from '@/lib/firebase';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import type { Gig, GigSubmission, Notification, Agency, AffiliateLink, BrandKit } from '@/types';
import { CAMPAIGN_REJECT_REASONS } from '@/types';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, AlertTriangle, CheckCircle, Ticket, Users, Edit, DollarSign, UploadCloud, Download, Flame, Star, Video, Wallet, ArrowLeft, Trash2, PartyPopper, Scale, ShieldCheck, Info, FileText, Link2, Copy, Check, MousePointer2, Target, Zap, Heart, Handshake, Maximize2, Infinity as InfinityIcon, CalendarDays, Megaphone, Settings2, type LucideIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { httpsCallable } from 'firebase/functions';
import { runVerzaScore } from '@/ai/flows/gauntlet-flow';
import { fetchYouTubeStatsForUrl } from '@/lib/submissions/youtube-stats';
import { SubmissionVideoPreview, submissionPreviewProps } from '@/components/marketplace/submission-video-preview';
import { VerzaScoreBadge, VerzaScoreFeedback } from '@/components/marketplace/verza-score-feedback';
import { SubmissionMetaAd } from '@/components/marketplace/submission-meta-ad';
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
import { clearPostAuthRedirect } from '@/lib/post-auth-redirect';
import { clearInviteCreatorId, peekInviteCreatorId } from '@/lib/campaign-invite';
import { campaignSlug } from '@/lib/public-campaigns';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BrandDeckPreview } from '@/components/agency/brand-deck-preview';
import { InviteKnownCreatorsButton } from '@/components/campaigns/invite-known-creators';
import confetti from 'canvas-confetti';
import { cn } from '@/lib/utils';
import { isBarterCampaignType, isCauseCampaignType } from '@/lib/campaign-type';
import { gigStatusBadgeLabel } from '@/lib/gig-status-label';
import {
  canStartCampaignBudget,
  centsToDollars,
  formatGigPlatformFeeLabel,
  gigHasCreatorCap,
  gigPlatformFeeFraction,
  isPoolBudgetGig,
  maxCreatorPayoutCents,
  poolDrawForCreatorAmount,
  poolRemainingCents,
} from '@/types';

function kickoffDate(gig: Gig): Date | null {
  const raw = gig.kickoff?.startsAt as { toDate?: () => Date } | string | Date | undefined;
  if (!raw) return null;
  if (typeof raw === 'object' && 'toDate' in raw && typeof raw.toDate === 'function') return raw.toDate();
  const d = new Date(raw as string | Date);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatKickoffWhen(gig: Gig): string {
  const date = kickoffDate(gig);
  if (!date) return '';
  const tz = gig.kickoff?.timezone || undefined;
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

type BrandCampaignSection = 'people' | 'brief' | 'budget' | 'setup';

const BRAND_CAMPAIGN_SECTIONS: { id: BrandCampaignSection; label: string; icon: LucideIcon }[] = [
  { id: 'people', label: 'People', icon: Users },
  { id: 'brief', label: 'Brief', icon: FileText },
  { id: 'budget', label: 'Budget', icon: DollarSign },
  { id: 'setup', label: 'Setup', icon: Settings2 },
];

function isBrandCampaignSection(value: string | null): value is BrandCampaignSection {
  return value === 'people' || value === 'brief' || value === 'budget' || value === 'setup';
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  const [appliedCreators, setAppliedCreators] = useState<UserProfile[]>([]);
  const [invitedCreators, setInvitedCreators] = useState<UserProfile[]>([]);
  const [pendingInviteProfile, setPendingInviteProfile] = useState<UserProfile | null>(null);
  const [pendingInviteOffer, setPendingInviteOffer] = useState('');
  const [isSendingPendingInvite, setIsSendingPendingInvite] = useState(false);
  const [submissions, setSubmissions] = useState<GigSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isPaying, setIsPaying] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResumingFunding, setIsResumingFunding] = useState(false);
  const [isWalletFunding, setIsWalletFunding] = useState(false);
  const [approvingApplicant, setApprovingApplicant] = useState<UserProfile | null>(null);
  const [offerAmount, setOfferAmount] = useState('');
  const [payingCreator, setPayingCreator] = useState<UserProfile | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [isClosingBudget, setIsClosingBudget] = useState(false);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isToppingUp, setIsToppingUp] = useState(false);

  const [isUploading, setIsUploading] = useState<number | null>(null);
  const [isRunningVerzaScore, setIsRunningVerzaScore] = useState<string | null>(null);
  
  const [linkInputs, setLinkInputs] = useState<Record<number, string>>({});
  const [isSubmittingLink, setIsSubmittingLink] = useState<number | null>(null);

  // Affiliate State
  const [affiliateLinks, setAffiliateLinks] = useState<Record<string, AffiliateLink>>({});
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Acceptance State
  const [hasAgreedToLegal, setHasAgreedToLegal] = useState(false);
  const [userAgencies, setUserAgencies] = useState<Agency[]>([]);
  const [selectedTalentId, setSelectedTalentId] = useState<string | null>(null);
  const [isAgencyAcceptance, setIsAgencyAcceptance] = useState(false);

  // Deadline extension state
  const [extendingCreatorId, setExtendingCreatorId] = useState<string | null>(null);
  const [extensionDate, setExtensionDate] = useState('');
  const [isExtending, setIsExtending] = useState(false);
  const [isDeckOpen, setIsDeckOpen] = useState(false);
  const [rejectingApplicant, setRejectingApplicant] = useState<UserProfile | null>(null);
  const [rejectReasonId, setRejectReasonId] = useState<string>(CAMPAIGN_REJECT_REASONS[0].id);
  const [rejectNote, setRejectNote] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [kickoffLocal, setKickoffLocal] = useState('');
  const [kickoffUrl, setKickoffUrl] = useState('');
  const [kickoffNote, setKickoffNote] = useState('');
  const [isSavingKickoff, setIsSavingKickoff] = useState(false);
  const [isRsvping, setIsRsvping] = useState(false);
  const [highlightApply, setHighlightApply] = useState(false);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const applyFocusHandled = useRef(false);
  const [brandSection, setBrandSection] = useState<BrandCampaignSection>('people');
  const brandSectionInit = useRef(false);

  const payoutCreatorForGigCallable = httpsCallable(functions, 'payoutCreatorForGig');
  const createGigFundingCheckoutSessionCallable = httpsCallable(functions, 'createGigFundingCheckoutSession');
  const fundGigFromWalletCallable = httpsCallable(functions, 'fundGigFromWallet');
  const addCampaignBudgetFromWalletCallable = httpsCallable(functions, 'addCampaignBudgetFromWallet');
  const createCampaignBudgetTopUpCheckoutCallable = httpsCallable(functions, 'createCampaignBudgetTopUpCheckout');
  const releaseUnspentCampaignBudgetCallable = httpsCallable(functions, 'releaseUnspentCampaignBudget');
  const extendCreatorDeadlineCallable = httpsCallable(functions, 'extendCreatorDeadline');
  const notifyBrandVideoSubmittedCallable = httpsCallable(functions, 'notifyBrandVideoSubmitted');
  const notifyBrandCampaignApplicantCallable = httpsCallable(functions, 'notifyBrandCampaignApplicant');
  const inviteCreatorToCampaignCallable = httpsCallable(functions, 'inviteCreatorToCampaign');
  const declineCampaignInviteCallable = httpsCallable(functions, 'declineCampaignInvite');

  useEffect(() => {
    if (searchParams.get('funding_success') === 'true' && gig) {
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

      const totalValue = isPoolBudgetGig(gig) ? (gig.campaignBudget || gig.fundedAmount || 0) : (gig.ratePerCreator || 0) * (gig.creatorsNeeded || 0);

      trackEvent({
        action: 'deployment_funding_success',
        category: 'revenue',
        label: gig.title,
        value: totalValue
      });

      router.replace(`/campaigns/${gigId}`, { scroll: false });
    }
  }, [searchParams, gig, gigId, router]);

  useEffect(() => {
    if (!gig || brandSectionInit.current) return;
    brandSectionInit.current = true;
    const requested = searchParams.get('section');
    if (isBrandCampaignSection(requested)) {
      setBrandSection(requested);
      return;
    }
    if (gig.status === 'pending_payment') setBrandSection('budget');
  }, [gig, searchParams]);

  useEffect(() => {
    if (!gig || !user) return;
    const fromQuery = searchParams.get('inviteCreator');
    const stored = peekInviteCreatorId(gigId);
    const creatorId = fromQuery || stored;
    if (!creatorId) {
      setPendingInviteProfile(null);
      return;
    }
    if ((gig.invitedCreatorIds || []).includes(creatorId) ||
        (gig.acceptedCreatorIds || []).includes(creatorId) ||
        (gig.appliedCreatorIds || []).includes(creatorId)) {
      clearInviteCreatorId(gigId);
      setPendingInviteProfile(null);
      if (fromQuery) router.replace(`/campaigns/${gigId}`, { scroll: false });
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'users', creatorId)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      setPendingInviteProfile({ uid: snap.id, ...(snap.data() as UserProfile) });
    });
    return () => { cancelled = true; };
  }, [gig, user, gigId, searchParams, router]);

  useEffect(() => {
    if (searchParams.get('addBudget') !== '1' || !gig) return;
    if (canStartCampaignBudget(gig) || isPoolBudgetGig(gig)) setIsTopUpOpen(true);
    router.replace(`/campaigns/${gigId}`, { scroll: false });
  }, [searchParams, gig, gigId, router]);

  const kitUnlocked = !!(gig && user && (
    gig.acceptedCreatorIds?.includes(user.uid) ||
    Object.values(gig.assignments || {}).some(a => a.agentId === user.uid) ||
    gig.brandId === user.primaryAgencyId ||
    user.agencyMemberships?.some(m => m.agencyId === gig.brandId)
  ));
  const gigBrandId = gig?.brandId;
  const viewerUid = user?.uid;
  useEffect(() => {
    if (!kitUnlocked || !gigBrandId || !viewerUid) {
      setBrandKit(null);
      return;
    }
    const kitRef = doc(db, 'agencies', gigBrandId, 'private', 'brandKit');
    let unsubKit: (() => void) | null = null;
    const listenToKit = () => {
      unsubKit?.();
      unsubKit = onSnapshot(kitRef, (s) => setBrandKit(s.exists() ? (s.data() as BrandKit) : null), () => {});
    };
    // Accepted creators can read the kit once Cloud Functions writes their access record.
    const unsubAccess = onSnapshot(
      doc(db, 'agencies', gigBrandId, 'brandKitAccess', viewerUid),
      (s) => { if (s.exists()) listenToKit(); },
      () => {},
    );
    listenToKit();
    return () => {
      unsubAccess();
      unsubKit?.();
    };
  }, [kitUnlocked, gigBrandId, viewerUid]);

  const hasGig = !!gig;
  useEffect(() => {
    if (searchParams.get('apply') !== '1' || !hasGig || applyFocusHandled.current) return;
    applyFocusHandled.current = true;
    clearPostAuthRedirect();
    window.setTimeout(() => {
      document.getElementById('apply-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightApply(true);
      window.setTimeout(() => setHighlightApply(false), 4000);
    }, 300);
  }, [searchParams, hasGig]);

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
          // Fetch agency data (Brand identity) for all viewers to show the Brand Kit
          onSnapshot(doc(db, 'agencies', data.brandId), (snap) => {
            if (snap.exists()) setAgency({ id: snap.id, ...snap.data() } as Agency);
          });
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

  useEffect(() => {
    if (gig && gig.appliedCreatorIds && gig.appliedCreatorIds.length > 0) {
      const creatorsQuery = query(collection(db, 'users'), where(documentId(), 'in', gig.appliedCreatorIds));
      const unsubscribe = onSnapshot(creatorsQuery,
        (snapshot) => {
          const creatorsData = snapshot.docs.map(d => d.data() as UserProfile);
          setAppliedCreators(creatorsData);
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
      setAppliedCreators([]);
    }
  }, [gig]);

  useEffect(() => {
    if (gig && gig.invitedCreatorIds && gig.invitedCreatorIds.length > 0) {
      const creatorsQuery = query(collection(db, 'users'), where(documentId(), 'in', gig.invitedCreatorIds));
      const unsubscribe = onSnapshot(creatorsQuery,
        (snapshot) => {
          const creatorsData = snapshot.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
          setInvitedCreators(creatorsData);
        },
        async () => {
          const permissionError = new FirestorePermissionError({
            path: 'users',
            operation: 'list',
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        }
      );
      return () => unsubscribe();
    } else {
      setInvitedCreators([]);
    }
  }, [gig]);

  useEffect(() => {
    if (!gig?.kickoff) return;
    const date = kickoffDate(gig);
    if (date) setKickoffLocal(toDatetimeLocalValue(date));
    setKickoffUrl(gig.kickoff.joinUrl || '');
    setKickoffNote(gig.kickoff.note || '');
  }, [gig?.kickoff]);

  const handleApplyGig = async () => {
    if (!user || !gig) return;

    if (!hasAgreedToLegal) {
      toast({ title: "Legal Agreement Required", description: "Please agree to the terms before securing the campaign.", variant: "destructive" });
      return;
    }

    if (!user.showInMarketplace) {
      toast({
        title: "Public Profile Required",
        description: "Your profile must be set to 'Public' in the network before you can secure campaigns. Head to your profile settings to enable this.",
        variant: "destructive",
        action: (
          <Button variant="outline" size="sm" asChild>
            <Link href="/profile">Profile Settings</Link>
          </Button>
        ),
      });
      return;
    }

    const targetUserId = isAgencyAcceptance && selectedTalentId ? selectedTalentId : user.uid;
    let applicantSocial = {
      instagramConnected: user.instagramConnected,
      youtubeConnected: user.youtubeConnected,
      tiktokConnected: user.tiktokConnected,
    };
    if (targetUserId !== user.uid) {
      const talentSnap = await getDoc(doc(db, "users", targetUserId));
      if (!talentSnap.exists()) {
        toast({
          title: "Talent not found",
          description: "Could not load this talent’s profile. Pick another creator or try again.",
          variant: "destructive",
        });
        return;
      }
      const talent = talentSnap.data() as UserProfile;
      applicantSocial = {
        instagramConnected: talent.instagramConnected,
        youtubeConnected: talent.youtubeConnected,
        tiktokConnected: talent.tiktokConnected,
      };
    }
    const hasConnectedSocial = !!(
      applicantSocial.instagramConnected ||
      applicantSocial.youtubeConnected ||
      applicantSocial.tiktokConnected
    );
    if (!hasConnectedSocial) {
      toast({
        title: "Connect a social account",
        description:
          targetUserId === user.uid
            ? "Connect at least one Instagram, YouTube, or TikTok account in Insights before applying — brands need verified reach."
            : "This talent needs at least one connected Instagram, YouTube, or TikTok account in Insights before you can apply for them.",
        variant: "destructive",
        action: (
          <Button variant="outline" size="sm" asChild>
            <Link href="/insights">Open Insights</Link>
          </Button>
        ),
      });
      return;
    }

    setIsAccepting(true);
    const gigDocRef = doc(db, 'gigs', gig.id);

    try {
      const currentGigSnap = await getDoc(gigDocRef);
      if (!currentGigSnap.exists()) throw new Error("Campaign no longer exists.");
      const currentGigData = currentGigSnap.data() as Gig;
      const acceptedIds = currentGigData.acceptedCreatorIds || [];
      const appliedIds = currentGigData.appliedCreatorIds || [];
      const isCauseGig = currentGigData.campaignType === 'cause_campaign';

      if (gigHasCreatorCap(currentGigData) && acceptedIds.length >= (currentGigData.creatorsNeeded || 0)) throw new Error("Campaign is full.");
      if (acceptedIds.includes(targetUserId)) throw new Error(`${isAgencyAcceptance ? 'This talent' : 'You'} already secured this.`);
      if ((currentGigData.rejectedCreatorIds || []).includes(targetUserId)) {
        throw new Error("This campaign declined that application. Browse other open campaigns.");
      }
      const isInvited = (currentGigData.invitedCreatorIds || []).includes(targetUserId);
      if (!isCauseGig && appliedIds.includes(targetUserId) && !isInvited) {
        throw new Error(`${isAgencyAcceptance ? 'This talent' : 'You'} already applied.`);
      }

      const gigUpdates: any = {
        updatedAt: serverTimestamp()
      };

      // Handle agency assignment metadata (we store this even if just applying, so it's ready upon approval)
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

      if (isCauseGig || isInvited) {
        const newAcceptedIds = [...acceptedIds, targetUserId];
        gigUpdates.acceptedCreatorIds = newAcceptedIds;
        gigUpdates[`acceptedAt.${targetUserId}`] = serverTimestamp();
        if (isInvited) gigUpdates.invitedCreatorIds = arrayRemove(targetUserId);
        if (appliedIds.includes(targetUserId)) {
          gigUpdates.appliedCreatorIds = appliedIds.filter((id) => id !== targetUserId);
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
            const suffix = currentGigData.affiliateSettings.promoCodeSuffix || '';
            const firstName = (creatorName || 'CREATOR').split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            generatedPromoCode = `${firstName}${suffix}`;
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
          const creatorName = isAgencyAcceptance
            ? (activeTalent.find(t => t.userId === selectedTalentId)?.displayName || 'talent')
            : (user.displayName || 'A creator');
          await addDoc(collection(db, 'notifications'), {
            userId: brandAgencyData.ownerId,
            agencyId: currentGigData.brandId,
            title: isAgencyAcceptance ? "Agency assigned talent!" : "New creator joined!",
            message: isAgencyAcceptance
              ? `${user.displayName || 'An agency'} has assigned ${creatorName} to your cause campaign "${gig.title}".`
              : `${creatorName} has joined your cause campaign "${gig.title}".`,
            type: 'gig_accepted',
            read: false,
            link: `/campaigns/${gig.id}`,
            createdAt: serverTimestamp(),
          });

          // Send email to brand owner
          const notifyBrandCreatorJoined = httpsCallable(functions, 'notifyBrandCreatorJoined');
          notifyBrandCreatorJoined({
            gigId: gig.id,
            creatorName,
            isAgencyAcceptance,
            fromApplicationApproval: false,
          }).catch(err => {
            console.error('Failed to send brand notification email:', err);
          });
        }

        // Notify the talent if they were assigned by an agency
        if (isAgencyAcceptance && selectedTalentId) {
          await addDoc(collection(db, 'notifications'), {
            userId: selectedTalentId,
            agencyId: userAgencies.find(a => a.talent.some(t => t.userId === selectedTalentId))?.id,
            title: "New Campaign Assigned!",
            message: `Your agency ${userAgencies.find(a => a.talent.some(t => t.userId === selectedTalentId))?.name || ''} has secured a spot for you on the "${gig.title}" cause campaign.`,
            type: 'system',
            read: false,
            link: `/campaigns/${gig.id}`,
            createdAt: serverTimestamp(),
          });
        }

        // Update the creator's profile to track who they are working for
        const userUpdates = { giggingForAgencies: arrayUnion(currentGigData.brandId) };
        await updateDoc(doc(db, 'users', targetUserId), userUpdates);

        toast({ title: isInvited ? "Invite accepted" : "Campaign Claimed!" });
      } else {
        // Regular campaigns use the "Apply" step
        const newAppliedIds = [...appliedIds, targetUserId];
        gigUpdates.appliedCreatorIds = newAppliedIds;
        await updateDoc(gigDocRef, gigUpdates);
        
        // Update the creator's profile to track who they are working for
        const userUpdates = { giggingForAgencies: arrayUnion(currentGigData.brandId) };
        await updateDoc(doc(db, 'users', targetUserId), userUpdates);
        
        trackEvent({ action: 'apply_deployment', category: 'marketplace', label: gig.title });

        // Notify the brand
        const brandAgencySnap = await getDoc(doc(db, 'agencies', currentGigData.brandId));
        if (brandAgencySnap.exists()) {
          const brandAgencyData = brandAgencySnap.data();
          const creatorName = isAgencyAcceptance
            ? (activeTalent.find(t => t.userId === selectedTalentId)?.displayName || 'talent')
            : (user.displayName || 'A creator');
          await addDoc(collection(db, 'notifications'), {
            userId: brandAgencyData.ownerId,
            agencyId: currentGigData.brandId,
            title: "New Campaign Applicant",
            message: isAgencyAcceptance
              ? `An agency has applied on behalf of ${creatorName} for your campaign "${gig.title}".`
              : `${creatorName} has applied to your campaign "${gig.title}".`,
            type: 'creator_applied',
            read: false,
            link: `/campaigns/${gig.id}`,
            createdAt: serverTimestamp(),
          });

          notifyBrandCampaignApplicantCallable({
            gigId: gig.id,
            applicantUserId: targetUserId,
            isAgencyAcceptance,
          }).catch((err) => console.error('Failed to send brand applicant email:', err));
        }
        
        toast({ title: "Application Submitted!", description: "The brand has been notified and will review your application." });
      }

    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDeclineInvite = async () => {
    if (!gig) return;
    setIsAccepting(true);
    try {
      await declineCampaignInviteCallable({ gigId: gig.id });
      toast({ title: "Invite declined", description: "You can still browse other open campaigns." });
    } catch (error: any) {
      toast({ title: "Could not decline", description: error.message, variant: "destructive" });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleSendPendingInvite = async () => {
    if (!gig || !pendingInviteProfile) return;
    if (isPoolBudgetGig(gig) && (!pendingInviteOffer || Number(pendingInviteOffer) < 1)) {
      toast({
        title: "Enter an offer",
        description: "Set what you expect to pay this creator from the campaign budget.",
        variant: "destructive",
      });
      return;
    }
    setIsSendingPendingInvite(true);
    try {
      await inviteCreatorToCampaignCallable({
        gigId: gig.id,
        creatorId: pendingInviteProfile.uid,
        ...(isPoolBudgetGig(gig) ? { offeredPayout: Number(pendingInviteOffer) } : {}),
      });
      clearInviteCreatorId(gig.id);
      setPendingInviteProfile(null);
      toast({
        title: "Invite sent",
        description: `${pendingInviteProfile.displayName || "The creator"} can accept from this campaign.`,
      });
      router.replace(`/campaigns/${gig.id}`, { scroll: false });
    } catch (error: any) {
      toast({ title: "Invite failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSendingPendingInvite(false);
    }
  };

  const handleApproveApplication = async (applicantId: string, offeredAmount?: number) => {
    if (!gig || !user) return;
    setIsAccepting(true); // Using the same loading state for simplicity
    try {
      const gigDocRef = doc(db, 'gigs', gig.id);
      const currentGigSnap = await getDoc(gigDocRef);
      if (!currentGigSnap.exists()) throw new Error("Campaign no longer exists.");
      const currentGigData = currentGigSnap.data() as Gig;
      
      const acceptedIds = currentGigData.acceptedCreatorIds || [];
      const appliedIds = currentGigData.appliedCreatorIds || [];
      
      if (gigHasCreatorCap(currentGigData) && acceptedIds.length >= (currentGigData.creatorsNeeded || 0)) throw new Error("Campaign is full.");
      if (acceptedIds.includes(applicantId)) throw new Error("Already secured this campaign.");
      if (isPoolBudgetGig(currentGigData) && (!offeredAmount || offeredAmount < 1)) {
        throw new Error("Enter the amount you expect to pay this creator.");
      }

      const newAcceptedIds = [...acceptedIds, applicantId];
      const newAppliedIds = appliedIds.filter(id => id !== applicantId);
      
      const gigUpdates: any = {
        acceptedCreatorIds: newAcceptedIds,
        appliedCreatorIds: newAppliedIds,
        invitedCreatorIds: arrayRemove(applicantId),
        [`acceptedAt.${applicantId}`]: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (isPoolBudgetGig(currentGigData) && offeredAmount) {
        gigUpdates[`offeredPayouts.${applicantId}`] = offeredAmount;
      }
      
      if (gigHasCreatorCap(currentGigData) && newAcceptedIds.length === (currentGigData.creatorsNeeded || 0)) gigUpdates.status = 'in-progress';
      
      await updateDoc(gigDocRef, gigUpdates);

      // Create affiliate link if enabled
      if (currentGigData.affiliateSettings?.isEnabled) {
        let generatedPromoCode = undefined;
        let creatorName = appliedCreators.find(c => c.uid === applicantId)?.displayName || 'Creator';

        const trackingMethod = currentGigData.affiliateSettings.trackingMethod || 'link_only';

        if (trackingMethod === 'promo_code_only' || trackingMethod === 'both') {
          const suffix = currentGigData.affiliateSettings.promoCodeSuffix || '';
          const firstName = creatorName.split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          generatedPromoCode = `${firstName}${suffix}`;
        }

        await addDoc(collection(db, 'affiliateLinks'), {
          gigId: gig.id,
          creatorId: applicantId,
          brandId: gig.brandId,
          destinationUrl: currentGigData.affiliateSettings.destinationUrl,
          ...(generatedPromoCode && { promoCode: generatedPromoCode }),
          clicks: 0,
          conversions: 0,
          earnedRewards: 0,
          createdAt: serverTimestamp(),
        });
      }

      // Notify the creator
      await addDoc(collection(db, 'notifications'), {
        userId: applicantId,
        title: "Application Approved!",
        message: `Your application for "${gig.title}" has been approved! You can now access your tracking links and submit deliverables.`,
        type: 'application_approved',
        read: false,
        link: `/campaigns/${gig.id}`,
        createdAt: serverTimestamp(),
      });

      // Track event
      trackEvent({ action: 'approve_application', category: 'marketplace', label: gig.title });

      // Send email
      const creatorName = appliedCreators.find(c => c.uid === applicantId)?.displayName || 'Creator';
      const isAgencyAcceptance = !!currentGigData.assignments?.[applicantId];
      const notifyBrandCreatorJoined = httpsCallable(functions, 'notifyBrandCreatorJoined');
      notifyBrandCreatorJoined({
        gigId: gig.id,
        creatorName,
        isAgencyAcceptance,
        fromApplicationApproval: true,
      }).catch(err => {
        console.error('Failed to send brand notification email:', err);
      });
      if (gig.kickoff?.startsAt) {
        httpsCallable(functions, 'inviteToCampaignKickoff')({
          gigId: gig.id,
          creatorId: applicantId,
        }).catch((err) => console.error('Failed to send kickoff invite:', err));
      }

      setApprovingApplicant(null);
      setOfferAmount('');
      toast({ title: "Application Approved!", description: "The creator has been moved to your active roster." });
    } catch (error: any) {
      toast({ title: "Approval Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleRejectApplication = async () => {
    if (!gig || !rejectingApplicant) return;
    setIsRejecting(true);
    try {
      const reject = httpsCallable(functions, 'rejectCampaignApplicant');
      await reject({
        gigId: gig.id,
        creatorId: rejectingApplicant.uid,
        reasonId: rejectReasonId,
        note: rejectReasonId === 'other' ? rejectNote : '',
      });
      trackEvent({ action: 'reject_application', category: 'marketplace', label: gig.title });
      toast({ title: "Application declined", description: `${rejectingApplicant.displayName} has been notified.` });
      setRejectingApplicant(null);
      setRejectNote('');
      setRejectReasonId(CAMPAIGN_REJECT_REASONS[0].id);
    } catch (error: any) {
      toast({ title: "Could not decline", description: error.message, variant: "destructive" });
    } finally {
      setIsRejecting(false);
    }
  };

  const handleSaveKickoff = async () => {
    if (!gig || !kickoffLocal.trim() || !kickoffUrl.trim()) {
      toast({ title: "Kickoff needs a time and meeting link", variant: "destructive" });
      return;
    }
    setIsSavingKickoff(true);
    try {
      const startsAt = new Date(kickoffLocal).toISOString();
      const setKickoff = httpsCallable(functions, 'setCampaignKickoff');
      const result = await setKickoff({
        gigId: gig.id,
        startsAt,
        joinUrl: kickoffUrl.trim(),
        note: kickoffNote.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const invitedCount = (result.data as { invitedCount?: number }).invitedCount || 0;
      toast({
        title: "Kickoff saved",
        description: invitedCount > 0
          ? `${invitedCount} accepted creator${invitedCount === 1 ? '' : 's'} notified. They can join or skip and work from the brief.`
          : "Accepted creators will get the invite when you approve them.",
      });
    } catch (error: any) {
      toast({ title: "Could not save kickoff", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingKickoff(false);
    }
  };

  const handleKickoffRsvp = async (response: 'yes' | 'no') => {
    if (!gig) return;
    setIsRsvping(true);
    try {
      await httpsCallable(functions, 'rsvpCampaignKickoff')({ gigId: gig.id, response });
      toast({
        title: response === 'yes' ? "You're in" : "Thanks for letting them know",
        description: response === 'yes' ? "Open the meeting link when it's time." : "You can still work from the brief.",
      });
    } catch (error: any) {
      toast({ title: "Could not save RSVP", description: error.message, variant: "destructive" });
    } finally {
      setIsRsvping(false);
    }
  };

  const handleGenerateAffiliateLink = async () => {
    if (!user || !gig || !gig.affiliateSettings) return;
    
    setIsAccepting(true);
    try {
      let creatorName = user.displayName;
      let promoCode = undefined;
      
      if (gig.affiliateSettings.trackingMethod !== 'link_only') {
        const suffix = gig.affiliateSettings.promoCodeSuffix || '';
        const firstName = (creatorName || 'CREATOR').split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        promoCode = `${firstName}${suffix}`;
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
            link: `/campaigns/${gig.id}`,
            createdAt: serverTimestamp(),
          } as Omit<Notification, 'id'>);
          notifyBrandVideoSubmittedCallable({
            gigId: gig.id,
            submissionKind: 'video',
          }).catch((err) => console.error('Failed to send brand submission email:', err));
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

  const handleSubmitLink = async (slotIndex: number) => {
    const url = linkInputs[slotIndex];
    if (!url || !user || !gig) return;
    
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      toast({ title: "Only YouTube links supported", description: "For TikTok or Instagram, please upload the raw video file.", variant: "destructive" });
      return;
    }

    setIsSubmittingLink(slotIndex);
    try {
      const isVerzaRequired = gig.requireVerzaScore ?? true;
      const youtubeStats = await fetchYouTubeStatsForUrl(url);
      const subData: Omit<GigSubmission, 'id'> = {
        gigId: gig.id,
        brandId: gig.brandId,
        creatorId: user.uid,
        creatorName: user.displayName || 'Creator',
        creatorAvatarUrl: user.avatarUrl || null,
        videoUrl: url,
        verzaScore: 0,
        verzaFeedback: "",
        status: isVerzaRequired ? 'pending_verza_score' : 'submitted',
        createdAt: serverTimestamp() as any,
        ...(youtubeStats ? { youtubeStats } : {}),
      };

      const existingAtSlot = mySubmissions[slotIndex];
      if (existingAtSlot) {
        await updateDoc(doc(db, 'submissions', existingAtSlot.id), subData);
      } else {
        await addDoc(collection(db, 'submissions'), subData);
      }
      trackEvent({ action: 'link_upload', category: 'marketplace', label: `slot_${slotIndex}` });

      const statsSuffix = youtubeStats
        ? ""
        : " YouTube view counts could not be loaded — try re-submitting the link later.";

      if (!isVerzaRequired) {
        const agencySnap = await getDoc(doc(db, 'agencies', gig.brandId));
        if (agencySnap.exists()) {
          const agencyData = agencySnap.data();
          await addDoc(collection(db, 'notifications'), {
            userId: agencyData.ownerId,
            title: "New submission received",
            message: `${user?.displayName || 'A creator'} submitted a link for "${gig.title}".`,
            type: 'submission_received',
            read: false,
            link: `/campaigns/${gig.id}`,
            createdAt: serverTimestamp(),
          } as Omit<Notification, 'id'>);
          notifyBrandVideoSubmittedCallable({
            gigId: gig.id,
            submissionKind: 'link',
          }).catch((err) => console.error('Failed to send brand submission email:', err));
        }
        toast({
          title: `Link ${slotIndex + 1} submitted!`,
          description: `Your submission has been sent to the brand.${statsSuffix}`,
        });
      } else {
        toast({
          title: `Link ${slotIndex + 1} submitted!`,
          description: `Calculate your Verza Score to verify your link.${statsSuffix}`,
        });
      }
      setLinkInputs(prev => ({ ...prev, [slotIndex]: '' }));
    } catch (error: any) {
      console.error(error);
      toast({ title: "Submission failed", variant: "destructive" });
    } finally {
      setIsSubmittingLink(null);
    }
  };

  const handleRunVerzaScore = async (submission: GigSubmission) => {
    if (!gig) return;
    setIsRunningVerzaScore(submission.id);
    toast({ title: "Calculating Verza Score...", description: "AI is analyzing engagement potential..." });
    try {
      trackEvent({ action: 'verza_score_start', category: 'ai_tool', label: gig.title });
      const isYouTube = submission.videoUrl.includes('youtube.com') || submission.videoUrl.includes('youtu.be');
      const result = await runVerzaScore({ videoUrl: submission.videoUrl, isYouTube });
      const subRef = doc(db, 'submissions', submission.id);

      const threshold = gig.verzaScoreThreshold ?? 65;
      const updates: Partial<GigSubmission> = {
        verzaScore: result.score,
        verzaFeedback: result.feedback,
        hookScore: result.hookScore,
        pacingScore: result.pacingScore,
        vibeScore: result.vibeScore,
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
            link: `/campaigns/${gig.id}`,
            createdAt: serverTimestamp(),
          } as Omit<Notification, 'id'>);
          notifyBrandVideoSubmittedCallable({
            gigId: gig.id,
            submissionKind: isYouTube ? 'link' : 'video',
          }).catch((err) => console.error('Failed to send brand submission email:', err));
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

  const handlePayout = async (creator: UserProfile, amount?: number) => {
    if (!user || !gig) return;
    setIsPaying(creator.uid);
    try {
      await payoutCreatorForGigCallable({
        gigId: gig.id,
        creatorId: creator.uid,
        ...(isPoolBudgetGig(gig) ? { amount } : {}),
      });

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

      trackEvent({ action: 'deployment_payout', category: 'marketplace', label: gig.title, value: amount || gig.ratePerCreator });
      setPayingCreator(null);
      setPayAmount('');
      toast({ title: "Payout Processing!", description: "The creator has been paid successfully." });
    } catch (error: any) {
      toast({ title: "Payout Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsPaying(null);
    }
  };

  const handleApproveContribution = async (creator: UserProfile) => {
    if (!user || !gig) return;
    setIsPaying(creator.uid);
    try {
      const batch = submissions.filter(s => s.creatorId === creator.uid && s.status !== 'approved');
      for (const sub of batch) {
        await updateDoc(doc(db, 'submissions', sub.id), { status: 'approved' });
      }
      const isBarter = isBarterCampaignType(gig.campaignType);
      await addDoc(collection(db, 'notifications'), {
        userId: creator.uid,
        title: isBarter ? "Deliverable Approved!" : "Contribution Approved!",
        message: isBarter
          ? `Your content for "${gig.title}" has been approved. Any in-kind compensation follows the campaign brief.`
          : `Your content for "${gig.title}" has been approved. Thank you for supporting this cause!`,
        type: 'payout_received',
        read: false,
        link: `/campaigns/${gig.id}`,
        createdAt: serverTimestamp(),
      } as Omit<Notification, 'id'>);
      toast({ title: "Approved!", description: `${creator.displayName}'s contribution has been acknowledged.` });
    } catch (error: any) {
      toast({ title: "Approval Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsPaying(null);
    }
  };

  const handleExtendDeadline = async () => {
    if (!gig || !extendingCreatorId || !extensionDate) return;
    setIsExtending(true);
    try {
      await extendCreatorDeadlineCallable({ gigId: gig.id, creatorId: extendingCreatorId, newDeadline: extensionDate });
      toast({ title: "Deadline Extended", description: "The creator's deadline has been updated." });
      setExtendingCreatorId(null);
      setExtensionDate('');
    } catch (error: any) {
      toast({ title: "Extension Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsExtending(false);
    }
  };

  const handleDeleteGig = async () => {
    if (!gig) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'gigs', gig.id));
      toast({ title: "Campaign Deleted", description: "The campaign has been removed." });
      router.push('/campaigns');
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
        ...(isPoolBudgetGig(gig) ? { budgetMode: 'pool', campaignBudget: gig.campaignBudget || gig.fundedAmount || 0 } : {}),
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

      const totalValue = isPoolBudgetGig(gig) ? (gig.campaignBudget || 0) : (gig.ratePerCreator || 0) * (gig.creatorsNeeded || 0);
      trackEvent({
        action: 'deployment_funding_success',
        category: 'revenue',
        label: gig.title,
        value: totalValue
      });

      toast({ title: "Campaign Funded!", description: "Funds have been moved from your wallet to this campaign." });
    } catch (error: any) {
      toast({ title: "Funding Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsWalletFunding(false);
    }
  };

  const handleAddBudgetFromWallet = async () => {
    if (!gig) return;
    const amountNum = parseFloat(topUpAmount);
    if (!Number.isFinite(amountNum) || amountNum < 1) {
      toast({ title: "Invalid amount", description: "Enter at least $1.", variant: "destructive" });
      return;
    }
    setIsToppingUp(true);
    try {
      await addCampaignBudgetFromWalletCallable({ gigId: gig.id, amount: amountNum });
      toast({ title: "Budget updated", description: `$${amountNum.toLocaleString()} was moved from your wallet into this campaign.` });
      setIsTopUpOpen(false);
      setTopUpAmount('');
    } catch (error: any) {
      toast({ title: "Could not add funds", description: error.message, variant: "destructive" });
    } finally {
      setIsToppingUp(false);
    }
  };

  const handleAddBudgetByCard = async () => {
    if (!gig) return;
    const amountNum = parseFloat(topUpAmount);
    if (!Number.isFinite(amountNum) || amountNum < 1) {
      toast({ title: "Invalid amount", description: "Enter at least $1.", variant: "destructive" });
      return;
    }
    setIsToppingUp(true);
    try {
      const result = await createCampaignBudgetTopUpCheckoutCallable({ gigId: gig.id, amount: amountNum });
      const url = (result.data as { url?: string }).url;
      if (!url) throw new Error("Could not open checkout.");
      window.location.href = url;
    } catch (error: any) {
      toast({ title: "Could not add funds", description: error.message, variant: "destructive" });
      setIsToppingUp(false);
    }
  };

  const handleCloseCampaign = async () => {
    if (!gig) return;
    setIsClosingBudget(true);
    try {
      const result = await releaseUnspentCampaignBudgetCallable({ gigId: gig.id });
      const released = (result.data as { released?: number }).released || 0;
      toast({
        title: "Campaign closed",
        description: released > 0 ? `$${released.toLocaleString()} was returned to your wallet.` : "Nothing was left to return.",
      });
    } catch (error: any) {
      toast({ title: "Could not close campaign", description: error.message, variant: "destructive" });
    } finally {
      setIsClosingBudget(false);
    }
  };

  const mySubmissions = useMemo(() => user ? submissions.filter(s => s.creatorId === user.uid).sort((a, b) => (a.createdAt as any)?.toMillis() - (b.createdAt as any)?.toMillis()) : [], [submissions, user]);

  const getStatusLabel = (status: string) => gigStatusBadgeLabel(gig, status);

  if (isLoading || authLoading) return <div className="flex justify-center items-center h-96"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  if (!gig) return <div className="text-center py-10"><AlertTriangle className="mx-auto h-12 w-12 text-destructive" /><h3 className="mt-4">Campaign Not Found</h3></div>;

  const acceptedIds = gig.acceptedCreatorIds || [];
  const isCauseCampaign = isCauseCampaignType(gig.campaignType);
  const isBarterCampaign = isBarterCampaignType(gig.campaignType);
  const isPool = isPoolBudgetGig(gig);
  const canAddFirstBudget = canStartCampaignBudget(gig) && (gig.status === 'open' || gig.status === 'in-progress');
  const usesContributionApprovalOnly =
    isCauseCampaign || (isBarterCampaign && (gig.ratePerCreator || 0) <= 0 && !isPool);
  const hasCreatorCap = gigHasCreatorCap(gig);
  const spotsLeft = hasCreatorCap ? (gig.creatorsNeeded || 0) - acceptedIds.length : Infinity;
  const hasAccepted = user ? acceptedIds.includes(user.uid) : false;
  const hasApplied = user ? (gig.appliedCreatorIds || []).includes(user.uid) : false;
  const hasRejected = user ? (gig.rejectedCreatorIds || []).includes(user.uid) : false;
  const hasInvited = user ? (gig.invitedCreatorIds || []).includes(user.uid) : false;
  const kickoffWhen = formatKickoffWhen(gig);
  const kickoffUpcoming = (() => {
    const d = kickoffDate(gig);
    return !!d && d.getTime() > Date.now() - 30 * 60 * 1000;
  })();
  const myKickoffRsvp = user ? gig.kickoff?.rsvps?.[user.uid] : undefined;
  const kickoffRsvpEntries = Object.entries(gig.kickoff?.rsvps || {});
  const kickoffYes = kickoffRsvpEntries.filter(([, v]) => v === 'yes').map(([id]) => id);
  const kickoffNo = kickoffRsvpEntries.filter(([, v]) => v === 'no').map(([id]) => id);
  const isAgencyTeam = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';
  const isBrandTeam = user && gig && isAgencyTeam && (gig.brandId === user.primaryAgencyId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId));
  const isAssignedAgent = user && gig && Object.values(gig.assignments || {}).some(a => a.agentId === user.uid);
  const canManageGig = isBrandTeam || isAssignedAgent;
  const isStripeSetup = user?.stripeAccountId && user?.stripePayoutsEnabled;
  const hasConnectedSocial = !!(
    user?.instagramConnected ||
    user?.youtubeConnected ||
    user?.tiktokConnected
  );
  const canDeleteGig = isBrandTeam && (gig.status === 'pending_payment' || (gig.status === 'open' && acceptedIds.length === 0));
  const isCompleted = gig.status === 'completed';

  const usageRightsLabel = gig.usageRights === 'none' ? 'Editorial Support Only' : (gig.usageRights === 'perpetuity' ? 'In Perpetuity' : (gig.usageRights === '30_days' ? '30 Days' : '1 Year'));
  const campaignTypeLabel = gig.campaignType === 'production_grant' ? 'Production Grant / Editorial Funding' : isCauseCampaign ? 'Cause Campaign' : isBarterCampaign ? 'Barter' : 'Standard Sponsorship';

  const totalCost = isPool ? (gig.campaignBudget || gig.fundedAmount || 0) : gig.ratePerCreator * gig.creatorsNeeded;
  const fundedPool = isPool ? (gig.fundedAmount || 0) : 0;
  const poolRemaining = isPool ? Math.max(0, fundedPool - (gig.budgetSpent || 0)) : 0;
  const feeFraction = gigPlatformFeeFraction(gig);
  const feeLabel = formatGigPlatformFeeLabel(gig);
  const maxCreatorPay = isPool ? centsToDollars(maxCreatorPayoutCents(poolRemainingCents({ fundedAmount: fundedPool, budgetSpent: gig.budgetSpent }), feeFraction)) : 0;
  const canAffordWithWallet = agency && (agency.availableBalance || 0) >= totalCost;

  const myLink = user ? affiliateLinks[user.uid] : null;

  const getCreatorDeadline = (creatorId: string): Date | null => {
    const extension = (gig.deliveryExtensions as any)?.[creatorId];
    if (extension?.toDate) return extension.toDate();
    if (extension) return new Date(extension);
    const accepted = (gig.acceptedAt as any)?.[creatorId];
    if (!accepted) return null;
    const acceptedDate = accepted?.toDate ? accepted.toDate() : new Date(accepted);
    return new Date(acceptedDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  };

  const brandDeadlinePast = gig.deliverablesDueDate && new Date(gig.deliverablesDueDate + 'T23:59:59') < new Date();
  const showBrandBrief = !canManageGig || brandSection === 'brief';
  const showBrandPeople = canManageGig && brandSection === 'people';
  const showBrandSetup = canManageGig && brandSection === 'setup';
  const showBrandBudget = !canManageGig || brandSection === 'budget';
  const pendingPeopleCount =
    (gig.appliedCreatorIds || []).length +
    (gig.invitedCreatorIds || []).filter(
      (id) => !(gig.appliedCreatorIds || []).includes(id) && !(gig.acceptedCreatorIds || []).includes(id)
    ).length;

  const selectBrandSection = (section: BrandCampaignSection) => {
    setBrandSection(section);
    const params = new URLSearchParams(searchParams.toString());
    params.set('section', section);
    router.replace(`/campaigns/${gigId}?${params.toString()}`, { scroll: false });
  };

  return (
    <>
      <div className="flex flex-col gap-8 pb-20">
        <PageHeader
          title={gig.title}
          description={`Campaign by ${gig.brandName}`}
          actions={<Button asChild variant="outline"><Link href="/campaigns"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link></Button>}
        />

        {isCompleted && (
          <Alert className="bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800 text-green-800 dark:text-green-300">
            <PartyPopper className="h-5 w-5" />
            <AlertTitle className="font-bold">Campaign Complete!</AlertTitle>
            <AlertDescription>
              {canManageGig
                ? isCauseCampaign
                  ? `All participating creators have finished their work for this cause.`
                  : isBarterCampaign
                    ? `All ${gig.creatorsNeeded} creators have finished their deliverables for this barter campaign.`
                    : `All ${gig.creatorsNeeded} creators have finished and been paid for their work.`
                : `This campaign is officially complete. Your submission has been approved and your payout processed.`}
            </AlertDescription>
          </Alert>
        )}

        {isBrandTeam && pendingInviteProfile && gig.status !== 'pending_payment' && (
          <Alert>
            <Megaphone className="h-5 w-5" />
            <AlertTitle className="font-bold">Finish inviting {pendingInviteProfile.displayName || 'this creator'}</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>You picked them from their public profile. Send the invite for this brief.</p>
              {isPool && (
                <div className="flex items-center gap-2 max-w-xs">
                  <Label htmlFor="pending-invite-offer" className="text-xs whitespace-nowrap">Expected pay ($)</Label>
                  <Input
                    id="pending-invite-offer"
                    type="number"
                    min={1}
                    value={pendingInviteOffer}
                    onChange={(e) => setPendingInviteOffer(e.target.value)}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void handleSendPendingInvite()} disabled={isSendingPendingInvite}>
                  {isSendingPendingInvite ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Send invite
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    clearInviteCreatorId(gig.id);
                    setPendingInviteProfile(null);
                    router.replace(`/campaigns/${gig.id}`, { scroll: false });
                  }}
                >
                  Not now
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {isBrandTeam && brandDeadlinePast && !isCompleted && (
          <Alert variant="destructive">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle className="font-bold">Campaign Deadline Passed</AlertTitle>
            <AlertDescription>
              The campaign deadline of <strong>{new Date(gig.deliverablesDueDate! + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong> has passed. Open People to review outstanding creators and extend deadlines if needed.
            </AlertDescription>
          </Alert>
        )}

        <div
          className={cn(
            "grid grid-cols-1 gap-8 items-start",
            canManageGig ? "lg:grid-cols-[13rem_1fr]" : "lg:grid-cols-4"
          )}
        >
          {canManageGig ? (
            <aside className="lg:sticky lg:top-20">
              <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0 -mx-1 px-1">
                {BRAND_CAMPAIGN_SECTIONS.map((item) => {
                  const Icon = item.icon;
                  const active = brandSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectBrandSection(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                      {item.id === 'people' && pendingPeopleCount > 0 && (
                        <span className="ml-auto text-[10px] font-semibold tabular-nums bg-primary text-primary-foreground rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                          {pendingPeopleCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </aside>
          ) : null}
          {(!canManageGig || brandSection === 'brief' || brandSection === 'people' || brandSection === 'setup') ? (
          <div className={cn("min-w-0 space-y-8", !canManageGig && "lg:col-span-3")}>
            {hasAccepted && !canManageGig && gig.affiliateSettings?.isEnabled && (gig.affiliateSettings?.rewardAmount || 0) > 0 && (
              <Card className="border-blue-500/30 bg-blue-50/10 shadow-lg animate-in zoom-in-95 duration-300">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-blue-600"><Link2 className="h-5 w-5" /> Performance Tracking</CardTitle>
                  <CardDescription>Share your unique tracking hook to track performance and earn bonuses.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Tracking Link Section */}
                  {(!gig.affiliateSettings?.trackingMethod || gig.affiliateSettings.trackingMethod === 'link_only' || gig.affiliateSettings.trackingMethod === 'both') && (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Your Tracking Link</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 p-3 bg-background border rounded-md font-mono text-sm break-all">
                          {myLink ? (
                            `${window.location.origin}/l/${myLink.id}`
                          ) : (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground italic text-xs">Link not yet generated</span>
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

                  {/* Promo Code Section */}
                  {(gig.affiliateSettings?.trackingMethod === 'promo_code_only' || gig.affiliateSettings?.trackingMethod === 'both') && (
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Your Promo Code</Label>
                      <div className="flex items-center gap-2">
                        {myLink ? (
                          <>
                            <div className="flex-1 p-3 bg-background border rounded-md font-mono text-sm font-bold text-center tracking-wider text-xl uppercase">
                              {myLink.promoCode || 'PENDING'}
                            </div>
                            <Button size="icon" onClick={() => {
                              if (!myLink.promoCode) return;
                              navigator.clipboard.writeText(myLink.promoCode);
                              toast({ title: "Promo Code Copied!" });
                            }} disabled={!myLink.promoCode}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          </>
                        ) : gig.affiliateSettings.trackingMethod === 'promo_code_only' ? (
                          <div className="flex-1 p-3 bg-background border rounded-md flex items-center justify-between">
                            <span className="text-muted-foreground italic text-xs">Code not yet generated</span>
                            <Button 
                              size="sm" 
                              variant="secondary" 
                              className="h-7 text-[10px]"
                              onClick={handleGenerateAffiliateLink}
                              disabled={isAccepting}
                            >
                              {isAccepting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                              Generate My Code
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {myLink?.promoCode && gig.affiliateSettings?.promoCodeDiscountValue && (
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

            {showBrandBrief && agency && (agency.hasBrandKit || agency.brandGuide || brandKit?.brandGuide) && (() => {
              const isSecured = hasAccepted || canManageGig;
              const kitGuide = brandKit?.brandGuide ?? agency.brandGuide;
              const kitProducts = brandKit?.products ?? agency.products;
              return (
                <Card className={cn(
                  "overflow-hidden border-primary/20 shadow-lg mb-6 transition-all duration-500",
                  isSecured ? "bg-primary/5 border-primary/20" : "bg-muted/10 border-dashed"
                )}>
                  <CardHeader className={cn(
                    "border-b border-primary/10",
                    isSecured ? "bg-primary/5" : "bg-muted/20"
                  )}>
                    <div className="flex justify-between items-center">
                      <CardTitle className="flex items-center gap-2">
                        {isSecured ? (
                          <Star className="h-5 w-5 text-primary fill-primary" />
                        ) : (
                          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                        )}
                        Brand Identity Kit
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {isSecured && kitGuide && (
                          <Dialog open={isDeckOpen} onOpenChange={setIsDeckOpen}>
                            <DialogTrigger asChild>
                               <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/10">
                                  <Maximize2 className="h-4 w-4 text-primary" />
                               </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-[95vw] w-full h-[90vh] p-0 overflow-hidden border-none shadow-2xl bg-transparent flex flex-col">
                               <DialogTitle className="sr-only">Brand Identity Kit - Full Screen</DialogTitle>
                               <DialogDescription className="sr-only">Full screen interactive brand deck and product lookbook.</DialogDescription>
                               <div className="flex-1 w-full min-h-0 flex flex-col">
                                  <BrandDeckPreview 
                                    guide={kitGuide} 
                                    agencyName={agency.name}
                                    products={kitProducts}
                                    onClose={() => setIsDeckOpen(false)}
                                  />
                               </div>
                            </DialogContent>
                          </Dialog>
                        )}
                        <Badge variant={isSecured ? "outline" : "secondary"} className={cn(
                          isSecured ? "bg-white/50 backdrop-blur-sm" : ""
                        )}>
                          {isSecured ? "Interactive Deck" : "Briefing Locked"}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription>
                      {isSecured 
                        ? "Get to know the brand's DNA before you start filming." 
                        : "Secure your spot on this campaign to unlock the full brand briefing."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 relative h-[500px]">
                    {isSecured && kitGuide ? (
                      <BrandDeckPreview 
                        guide={kitGuide} 
                        agencyName={agency.name}
                        products={kitProducts}
                      />
                    ) : isSecured ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        Unlocking the brand kit…
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center space-y-6 bg-gradient-to-b from-transparent to-background/50">
                         <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center border border-primary/10 animate-pulse">
                            <ShieldCheck className="h-8 w-8 text-primary/40" />
                         </div>
                         <div className="space-y-2 max-w-[280px]">
                            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">The Briefing</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                               Once approved, you'll get instant access to the brand's visual identity, voice guidelines, and product lookbook.
                            </p>
                         </div>
                         {!hasApplied && !hasAccepted && !hasInvited && (
                           <Button variant="outline" className="text-xs h-8 border-primary/20 px-6 rounded-full" onClick={() => {
                              const element = document.getElementById('legal-agreement');
                              element?.scrollIntoView({ behavior: 'smooth' });
                           }}>
                              Apply to Unlock
                           </Button>
                         )}
                         {hasInvited && !hasAccepted && (
                           <Badge variant="secondary" className="px-4 py-1">You&apos;re invited — accept below</Badge>
                         )}
                         {hasApplied && !hasAccepted && (
                           <Badge variant="secondary" className="px-4 py-1">Approval Pending</Badge>
                         )}
                         {hasRejected && !hasAccepted && (
                           <Badge variant="outline" className="px-4 py-1">Not moving forward</Badge>
                         )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {showBrandBrief ? (
            <>
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle>Campaign Objective</CardTitle>
                  <Badge variant="secondary" className={isCauseCampaign ? "bg-rose-500/10 text-rose-600 border-rose-500/20" : isBarterCampaign ? "bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/25" : "bg-primary/10 text-primary border-primary/20"}>
                    {isCauseCampaign && <Heart className="h-3 w-3 mr-1 inline" />}
                    {isBarterCampaign && <Handshake className="h-3 w-3 mr-1 inline" />}
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
                {gig.deliverablesDueDate && (
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Campaign Deadline</p>
                    <p className="text-sm font-medium">
                      {new Date(gig.deliverablesDueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                    {hasAccepted && !canManageGig && (() => {
                      const myDeadline = getCreatorDeadline(user!.uid);
                      return myDeadline ? (
                        <p className="text-xs text-muted-foreground">Your personal deadline: <span className={myDeadline < new Date() ? 'text-destructive font-semibold' : 'font-medium'}>{myDeadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></p>
                      ) : null;
                    })()}
                  </div>
                )}
                <div className="md:col-span-2 p-3 bg-background rounded border text-[10px] text-muted-foreground italic">
                  By clicking "Claim Campaign", you enter into a binding agreement with {gig.brandName}. Verza holds your payment in trust and releases it only upon verified submission approval. {(gig.requireVerzaScore ?? true) && `Every video must pass the minimum Verza Score threshold of ${gig.verzaScoreThreshold ?? 65}% prior to submission approval. `}You retain ownership of your content, granting {gig.brandName} a non-exclusive license for the duration specified.
                </div>
              </CardContent>
            </Card>
            </>
            ) : null}

            {hasAccepted && !canManageGig && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> {isCompleted ? 'Your Submissions' : 'Submit Your Work'}</CardTitle>
                  <CardDescription>
                    {isCompleted
                      ? 'Review the work you submitted for this complete campaign.'
                      : (gig.requireVerzaScore ?? true)
                        ? `Upload ${gig.videosPerCreator} video${gig.videosPerCreator > 1 ? 's' : ''} and calculate your Verza Score for each.`
                        : `Upload ${gig.videosPerCreator} video${gig.videosPerCreator > 1 ? 's' : ''} to complete your campaign.`}
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
                            <SubmissionVideoPreview
                              {...submissionPreviewProps(submission)}
                              showFeedback={false}
                              downloadOnHover
                            />

                            {(submission.status === 'pending_verza_score' || submission.status === 'rejected') && (gig.requireVerzaScore ?? true) ? (
                              <div className="p-4 border rounded-lg bg-background space-y-4 shadow-sm">
                                <div className="flex justify-between items-center">
                                  <h5 className="font-semibold text-sm">Verza Score Analysis</h5>
                                  <VerzaScoreBadge score={submission.verzaScore} failed={submission.status === 'rejected'} />
                                </div>
                                <VerzaScoreFeedback
                                  score={submission.verzaScore}
                                  feedback={submission.verzaFeedback}
                                  hookScore={submission.hookScore}
                                  pacingScore={submission.pacingScore}
                                  vibeScore={submission.vibeScore}
                                  threshold={gig.verzaScoreThreshold ?? 65}
                                  failed={submission.status === 'rejected'}
                                />
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
                              <div className="pt-2 flex flex-col items-center gap-2 mt-2">
                                <div className="flex gap-4 border-t pt-4 w-full">
                                  <div className="flex-1 flex flex-col gap-1 items-center">
                                    <Label htmlFor={`video-replace-${i}`} className="cursor-pointer text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                                      <UploadCloud className="h-3 w-3" /> Upload New File
                                    </Label>
                                    <input id={`video-replace-${i}`} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => handleVideoUpload(e, i)} disabled={!!isUploading || !!isRunningVerzaScore} />
                                  </div>
                                </div>

                                <div className="w-full mt-2">
                                  <div className="flex items-center gap-2">
                                    <Input 
                                      className="h-8 text-sm flex-1" 
                                      placeholder="Replace with YouTube link..." 
                                      value={linkInputs[i] || ''} 
                                      onChange={(e) => setLinkInputs(p => ({...p, [i]: e.target.value}))} 
                                      disabled={isSubmittingLink === i || !!isRunningVerzaScore}
                                    />
                                    <Button size="sm" variant="secondary" onClick={() => handleSubmitLink(i)} disabled={isSubmittingLink === i || !(linkInputs[i]?.trim()) || !!isRunningVerzaScore}>
                                      {isSubmittingLink === i ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Replace'}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          !isCompleted ? (
                            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg bg-background hover:bg-muted/10 transition-colors">
                              <div className="flex flex-col items-center gap-2 mb-6">
                                <div className="p-4 bg-muted rounded-full">
                                  {slotLoading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <UploadCloud className="h-8 w-8 text-primary" />}
                                </div>
                                <div className="text-center">
                                  <p className="font-medium">{slotLoading ? 'Uploading...' : 'Upload Video File'}</p>
                                  <p className="text-xs text-muted-foreground mb-3">MP4/MOV, max 100MB (non-YouTube)</p>
                                  <label htmlFor={`video-upload-${i}`} className="cursor-pointer">
                                    <Button size="sm" variant="secondary" asChild disabled={!!isUploading}><span className="cursor-pointer">Choose File</span></Button>
                                  </label>
                                  <input id={`video-upload-${i}`} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => handleVideoUpload(e, i)} disabled={!!isUploading} />
                                </div>
                              </div>

                              <div className="w-full flex items-center gap-4 mb-4">
                                <div className="flex-1 h-px bg-border"></div>
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">OR</span>
                                <div className="flex-1 h-px bg-border"></div>
                              </div>

                              <div className="w-full space-y-2">
                                <Label className="text-xs">Submit a YouTube Link</Label>
                                <div className="flex items-center gap-2">
                                  <Input 
                                    className="h-8 text-sm" 
                                    placeholder="https://youtube.com/watch?v=..." 
                                    value={linkInputs[i] || ''} 
                                    onChange={(e) => setLinkInputs(p => ({...p, [i]: e.target.value}))} 
                                    disabled={isSubmittingLink === i}
                                  />
                                  <Button size="sm" onClick={() => handleSubmitLink(i)} disabled={isSubmittingLink === i || !(linkInputs[i]?.trim())}>
                                    {isSubmittingLink === i ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
                                  </Button>
                                </div>
                              </div>
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

            {showBrandSetup && !isCompleted && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><CalendarDays className="text-primary h-5 w-5" /> Group kickoff</CardTitle>
                  <CardDescription>
                    Optional. One time for everyone you accept — they can join on your calendar or skip and work from the brief.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {kickoffWhen && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                      <p><span className="font-medium">Scheduled:</span> {kickoffWhen}</p>
                      {gig.kickoff?.joinUrl && (
                        <p className="truncate">
                          <span className="font-medium">Link:</span>{' '}
                          <a href={gig.kickoff.joinUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            {gig.kickoff.joinUrl}
                          </a>
                        </p>
                      )}
                      <p className="text-muted-foreground">
                        {kickoffYes.length} going · {kickoffNo.length} can&apos;t make it
                        {acceptedIds.length > 0 ? ` · ${acceptedIds.length} on roster` : ''}
                      </p>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="kickoff-time">Date and time</Label>
                      <Input id="kickoff-time" type="datetime-local" value={kickoffLocal} onChange={(e) => setKickoffLocal(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="kickoff-url">Meet / Zoom / calendar link</Label>
                      <Input id="kickoff-url" value={kickoffUrl} onChange={(e) => setKickoffUrl(e.target.value)} placeholder="https://meet.google.com/…" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="kickoff-note">Note (optional)</Label>
                    <Textarea id="kickoff-note" value={kickoffNote} onChange={(e) => setKickoffNote(e.target.value)} rows={2} placeholder="15 min, brief + Q&A. Work from the kit if you can't join." />
                  </div>
                  <Button onClick={() => void handleSaveKickoff()} disabled={isSavingKickoff || !kickoffLocal || !kickoffUrl.trim()}>
                    {isSavingKickoff ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
                    {gig.kickoff ? 'Update and notify roster' : 'Save and notify accepted creators'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {showBrandPeople && (
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2"><Users className="text-primary" /> {isCompleted ? 'Final Creator Roster' : 'Creator Roster & Submissions'}</CardTitle>
                    <CardDescription>
                      {isCompleted
                        ? isCauseCampaign
                          ? `All participating creators have finished their work.`
                          : isBarterCampaign
                            ? `All ${gig.creatorsNeeded} creators have finished their deliverables for this barter campaign.`
                            : `All ${gig.creatorsNeeded} creators have finished and been paid for their work.`
                        : `Manage secured creators and review their ${gig.videosPerCreator} requested video${gig.videosPerCreator > 1 ? 's' : ''}.`}
                    </CardDescription>
                  </div>
                  {!isCompleted && <InviteKnownCreatorsButton gig={gig} agency={agency} />}
                </CardHeader>
                <CardContent>
                  {!isCompleted && canManageGig && invitedCreators.filter(c => !(gig.appliedCreatorIds || []).includes(c.uid) && !(gig.acceptedCreatorIds || []).includes(c.uid)).length > 0 && (
                    <div className="mb-8 space-y-4">
                      <h4 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">Invites pending</h4>
                      {invitedCreators
                        .filter(c => !(gig.appliedCreatorIds || []).includes(c.uid) && !(gig.acceptedCreatorIds || []).includes(c.uid))
                        .map(invitee => (
                        <Card key={invitee.uid} className="border bg-muted/10">
                          <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <Link href={`/creator/${invitee.uid}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                              <Avatar>
                                <AvatarImage src={invitee.avatarUrl || ''} />
                                <AvatarFallback>{invitee.displayName?.charAt(0)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-semibold hover:underline">{invitee.displayName}</p>
                                <p className="text-xs text-muted-foreground">Waiting for them to accept</p>
                              </div>
                            </Link>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {!isCompleted && canManageGig && appliedCreators.length > 0 && (
                    <div className="mb-8 space-y-4">
                      <h4 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">Applicants awaiting approval</h4>
                      {appliedCreators.map(applicant => (
                        <Card key={applicant.uid} className="border bg-muted/10">
                          <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <Link href={`/creator/${applicant.uid}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                                <Avatar>
                                  <AvatarImage src={applicant.avatarUrl || ''} />
                                  <AvatarFallback>{applicant.displayName?.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="font-semibold hover:underline">{applicant.displayName}</p>
                                    {gig.assignments?.[applicant.uid] && (
                                      <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] h-4 px-1.5 flex items-center gap-1">
                                        <ShieldCheck className="h-2.5 w-2.5" /> Managed
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground">{applicant.email}</p>
                                </div>
                              </Link>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                            <Button 
                              size="sm" 
                              onClick={() => {
                                if (isPool) {
                                  setApprovingApplicant(applicant);
                                  setOfferAmount('');
                                } else {
                                  handleApproveApplication(applicant.uid);
                                }
                              }}
                              disabled={isAccepting || isRejecting}
                            >
                              Approve Application
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isAccepting || isRejecting}
                              onClick={() => {
                                setRejectingApplicant(applicant);
                                setRejectReasonId(CAMPAIGN_REJECT_REASONS[0].id);
                                setRejectNote('');
                              }}
                            >
                              Decline
                            </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {acceptedCreators.length > 0 ? (
                    <div className="space-y-6">
                      {acceptedCreators.map(creator => {
                        const isPaid = gig.paidCreatorIds?.includes(creator.uid);
                        const creatorSubmissions = submissions.filter(s => s.creatorId === creator.uid);
                        const allVideosSubmitted = creatorSubmissions.length === (gig.videosPerCreator || 1) && creatorSubmissions.every(s => s.status === 'submitted' || s.status === 'approved');
                        const creatorLink = affiliateLinks[creator.uid];
                        const creatorDeadline = getCreatorDeadline(creator.uid);
                        const deadlineOverdue = creatorDeadline && !isPaid && creatorDeadline < new Date();
                        const deadlineSoon = creatorDeadline && !isPaid && !deadlineOverdue && creatorDeadline < new Date(Date.now() + 48 * 60 * 60 * 1000);

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
                                      {gig.kickoff?.rsvps?.[creator.uid] === 'yes' && (
                                        <p className="text-[11px] text-green-700">Kickoff: going</p>
                                      )}
                                      {gig.kickoff?.rsvps?.[creator.uid] === 'no' && (
                                        <p className="text-[11px] text-muted-foreground">Kickoff: can&apos;t make it</p>
                                      )}
                                      {isPool && gig.offeredPayouts?.[creator.uid] ? (
                                        <p className="text-xs font-medium">Offered ${gig.offeredPayouts[creator.uid].toLocaleString()}</p>
                                      ) : null}
                                      {isPool && gig.creatorPayouts?.[creator.uid] ? (
                                        <p className="text-xs font-medium text-green-700">Paid ${gig.creatorPayouts[creator.uid].creatorAmount.toLocaleString()}</p>
                                      ) : null}
                                    </div>
                                  </Link>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {usesContributionApprovalOnly ? (
                                    (() => {
                                      const isApproved = creatorSubmissions.length > 0 && creatorSubmissions.every(s => s.status === 'approved');
                                      return isApproved ? (
                                        <Badge variant="default" className="bg-green-500 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Approved</Badge>
                                      ) : isBrandTeam ? (
                                        <AlertDialog>
                                          <AlertDialogTrigger asChild>
                                            <Button size="sm" variant="outline" disabled={isPaying === creator.uid || !allVideosSubmitted} className={isCauseCampaign ? "border-rose-300 text-rose-600 hover:bg-rose-50 hover:text-rose-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-50" : "border-amber-400 text-amber-800 hover:bg-amber-50 hover:text-amber-950 dark:text-amber-200 dark:hover:bg-amber-950/50 dark:hover:text-amber-50"}>
                                              {isPaying === creator.uid ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : isCauseCampaign ? <Heart className="h-3.5 w-3.5 mr-1" /> : <Handshake className="h-3.5 w-3.5 mr-1" />} Approve
                                            </Button>
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle>{isCauseCampaign ? "Approve this contribution?" : "Approve this deliverable?"}</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                {isCauseCampaign ? (
                                                  <>You&apos;re acknowledging <span className="font-bold text-foreground">{creator.displayName}</span>&apos;s content for your cause. Their work will be marked as approved and they&apos;ll receive a thank-you notification. This cannot be undone.</>
                                                ) : (
                                                  <>You&apos;re acknowledging <span className="font-bold text-foreground">{creator.displayName}</span>&apos;s work for this barter campaign. Their submission will be marked as approved. Any product or in-kind compensation is handled outside Verza per your brief. This cannot be undone.</>
                                                )}
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                              <AlertDialogAction onClick={() => handleApproveContribution(creator)} className={isCauseCampaign ? "bg-rose-500 hover:bg-rose-600 text-white" : "bg-amber-600 hover:bg-amber-700 text-white"}>
                                                {isCauseCampaign ? "Approve Contribution" : "Approve Deliverable"}
                                              </AlertDialogAction>
                                            </AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      ) : null;
                                    })()
                                  ) : isPaid ? (
                                    <Badge variant="default" className="bg-green-500">Paid</Badge>
                                  ) : isPool ? (
                                    isBrandTeam ? (
                                      <Button
                                        size="sm"
                                        disabled={isPaying === creator.uid || !allVideosSubmitted}
                                        onClick={() => {
                                          setPayingCreator(creator);
                                          setPayAmount(gig.offeredPayouts?.[creator.uid] ? String(gig.offeredPayouts[creator.uid]) : '');
                                        }}
                                      >
                                        {isPaying === creator.uid ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4 mr-1" />} Approve & Pay
                                      </Button>
                                    ) : null
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
                                            You are about to approve <span className="font-bold text-foreground">{creator.displayName}</span>'s submission and add <span className="font-bold text-foreground">${(gig.ratePerCreator || 0).toLocaleString()}</span> to their Verza wallet. They can then withdraw funds to their bank account. This cannot be undone.
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

                              {isBrandTeam && creatorDeadline && !isPaid && (
                                <div className={cn(
                                  "mt-3 flex items-center justify-between px-3 py-2 rounded-md text-sm border",
                                  deadlineOverdue ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400" :
                                  deadlineSoon ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400" :
                                  "bg-muted/50 border-border text-muted-foreground"
                                )}>
                                  <span className="flex items-center gap-1.5">
                                    {deadlineOverdue ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                                    <span className="text-xs font-medium">
                                      {deadlineOverdue ? "Deadline passed" : "Deadline"}: {creatorDeadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                  </span>
                                  <Dialog open={extendingCreatorId === creator.uid} onOpenChange={(open) => { if (!open) { setExtendingCreatorId(null); setExtensionDate(''); } }}>
                                    <DialogTrigger asChild>
                                      <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setExtendingCreatorId(creator.uid); setExtensionDate(''); }}>
                                        Extend
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                      <DialogHeader>
                                        <DialogTitle>Extend Deadline for {creator.displayName}</DialogTitle>
                                      </DialogHeader>
                                      <div className="space-y-3 py-2">
                                        <p className="text-sm text-muted-foreground">Current deadline: {creatorDeadline.toLocaleDateString()}</p>
                                        <div className="space-y-1.5">
                                          <Label htmlFor="extension-date">New Deadline</Label>
                                          <Input
                                            id="extension-date"
                                            type="date"
                                            value={extensionDate}
                                            onChange={e => setExtensionDate(e.target.value)}
                                            min={new Date().toISOString().split('T')[0]}
                                          />
                                        </div>
                                      </div>
                                      <DialogFooter>
                                        <Button variant="outline" onClick={() => { setExtendingCreatorId(null); setExtensionDate(''); }}>Cancel</Button>
                                        <Button onClick={handleExtendDeadline} disabled={!extensionDate || isExtending}>
                                          {isExtending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                          Confirm Extension
                                        </Button>
                                      </DialogFooter>
                                    </DialogContent>
                                  </Dialog>
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
                                          <SubmissionVideoPreview
                                            {...submissionPreviewProps(sub)}
                                            compact
                                            showDownload={false}
                                          />
                                          <SubmissionMetaAd submission={sub} gig={gig} />
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
                    <p className="text-sm text-muted-foreground text-center py-4">No creators have secured this campaign yet.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {showBrandPeople && !isCompleted && (
              <MarketplaceCoPilot context="details_brand" className="hidden lg:block" />
            )}

            {showBrandSetup && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary" /> Campaign settings</CardTitle>
                  <CardDescription>Public listing, brief edits, and deleting this campaign.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {gig.status === 'open' && gig.isPublic !== false && (
                    <Button asChild variant="outline" className="w-full sm:w-auto">
                      <a href={`/c/${campaignSlug(gig.title || 'campaign', gig.id)}`} target="_blank" rel="noopener noreferrer">
                        <Link2 className="mr-2 h-4 w-4" /> View public page
                      </a>
                    </Button>
                  )}
                  {!isCompleted && (
                    <Button asChild variant="outline" className="w-full sm:w-auto">
                      <Link href={`/campaigns/${gig.id}/edit`}>
                        <Edit className="mr-2 h-4 w-4" /> Edit Campaign
                      </Link>
                    </Button>
                  )}
                  {canDeleteGig && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="w-full sm:w-auto">
                          <Trash2 className="mr-2 h-4 w-4" /> Delete Campaign
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove the campaign listing. This action cannot be undone.
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
                </CardContent>
              </Card>
            )}
          </div>
          ) : null}
          {showBrandBudget ? (
          <div className={cn("min-w-0 space-y-6", !canManageGig ? "lg:col-span-1" : "max-w-xl")}>
            <Card>
              <CardHeader><CardTitle>Campaign Overview</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">{isPool ? 'Campaign budget' : 'Base Rate per Creator'}</span>
                    {isPool ? (
                      <span className="font-bold text-2xl text-primary">${totalCost.toLocaleString()}</span>
                    ) : (gig.ratePerCreator || 0) > 0 ? (
                      <span className="font-bold text-2xl text-primary">
                        ${(gig.ratePerCreator || 0).toLocaleString()}
                      </span>
                    ) : isCauseCampaign ? (
                      <Badge variant="secondary" className="border-rose-500/30 bg-rose-500/5 text-rose-600 font-bold px-2 py-0.5 uppercase text-[10px] tracking-tight">
                        <Heart className="h-3 w-3 mr-1 fill-rose-500" /> Volunteer
                      </Badge>
                    ) : isBarterCampaign ? (
                      gig.affiliateSettings?.isEnabled && (gig.affiliateSettings?.rewardAmount || 0) > 0 ? (
                        <Badge variant="secondary" className="border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200 font-bold px-2 py-0.5 uppercase text-[10px] tracking-tight">
                          <Handshake className="h-3 w-3 mr-1" /> Barter + performance
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200 font-bold px-2 py-0.5 uppercase text-[10px] tracking-tight">
                          <Handshake className="h-3 w-3 mr-1" /> Barter (in-kind)
                        </Badge>
                      )
                    ) : (
                      <Badge variant="secondary" className="border-blue-500/30 bg-blue-500/5 text-blue-600 font-bold px-2 py-0.5 uppercase text-[10px] tracking-tight animate-pulse">
                        <Zap className="h-3.5 w-3.5 mr-1 fill-blue-600" /> Performance Only
                      </Badge>
                    )}
                  </div>
                  {isPool && (
                    <div className="space-y-1 pt-2 text-sm">
                      {fundedPool > 0 ? (
                        <>
                          <div className="flex justify-between"><span className="text-muted-foreground">Spent</span><span>${(gig.budgetSpent || 0).toLocaleString()}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">Remaining</span><span className="font-semibold">${poolRemaining.toLocaleString()}</span></div>
                          {canManageGig ? (
                            <p className="text-xs text-muted-foreground">Up to ${maxCreatorPay.toLocaleString()} can still be paid to creators. Verza&apos;s {feeLabel} is taken from the budget on top of each payment.</p>
                          ) : null}
                        </>
                      ) : canManageGig ? (
                        <p className="text-xs text-muted-foreground">This amount is locked to this campaign once you fund it. Other campaigns cannot spend it.</p>
                      ) : null}
                      {!canManageGig && user && gig.offeredPayouts?.[user.uid] ? (
                        <p className="text-xs font-medium">Your rate is ${gig.offeredPayouts[user.uid].toLocaleString()}, paid in full when your work is approved.</p>
                      ) : !canManageGig ? (
                        <p className="text-xs text-muted-foreground">Your rate is set when the brand accepts you. You receive that amount in full.</p>
                      ) : null}
                    </div>
                  )}
                </div>

                {gig.affiliateSettings?.isEnabled && (gig.affiliateSettings?.rewardAmount || 0) > 0 && (
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
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Spots Remaining</span>
                    {isCauseCampaign || isPool ? (
                      <span className="font-bold flex items-center gap-1 text-rose-500"><InfinityIcon className="h-4 w-4" /> Unlimited</span>
                    ) : (
                      <span className="font-bold">{spotsLeft} / {gig.creatorsNeeded || 0}</span>
                    )}
                  </div>
                )}
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Status</span><Badge variant={gig.status === 'open' ? 'default' : (isCompleted ? 'default' : 'secondary')} className={gig.status === 'open' ? 'bg-green-500' : (isCompleted ? 'bg-blue-500' : '')}>{getStatusLabel(gig.status)}</Badge></div>

                {user && !canManageGig && !isCompleted && (
                  hasAccepted ? (
                    <div className="space-y-4 pt-4 border-t">
                      <Button className="w-full bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/20" disabled>
                        <CheckCircle className="mr-2 h-4 w-4" /> Campaign Claimed
                      </Button>
                      {gig.kickoff?.joinUrl && kickoffUpcoming && (
                        <div className="rounded-lg border p-3 space-y-2 text-sm">
                          <p className="font-medium flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Optional group kickoff</p>
                          <p className="text-muted-foreground">{kickoffWhen}</p>
                          {gig.kickoff.note && <p className="text-muted-foreground">{gig.kickoff.note}</p>}
                          <p className="text-xs text-muted-foreground">Join if you can. You can still work from the brief.</p>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" asChild>
                              <a
                                href={gig.kickoff.joinUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => {
                                  if (myKickoffRsvp !== 'yes') void handleKickoffRsvp('yes');
                                }}
                              >
                                Join kickoff
                              </a>
                            </Button>
                            <Button size="sm" variant="outline" disabled={isRsvping} onClick={() => void handleKickoffRsvp('no')}>
                              Can&apos;t make it
                            </Button>
                          </div>
                          {myKickoffRsvp === 'yes' && <p className="text-xs text-green-700">You said you&apos;re going.</p>}
                          {myKickoffRsvp === 'no' && <p className="text-xs text-muted-foreground">You said you can&apos;t make it.</p>}
                        </div>
                      )}
                    </div>
                  ) : hasRejected ? (
                    <div className="space-y-2 pt-4 border-t text-sm text-muted-foreground">
                      <p>The brand is not moving forward with this application. You can still start from other open campaigns.</p>
                    </div>
                  ) : hasApplied ? (
                    <div className="space-y-4 pt-4 border-t">
                      <Button className="w-full bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/20" disabled>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Application Submitted - Pending Approval
                      </Button>
                    </div>
                  ) : hasInvited || ((isCauseCampaign || spotsLeft > 0) && gig.status === 'open') ? (
                    <div
                      id="apply-card"
                      className={`space-y-4 border-t pt-4 rounded-lg transition-shadow duration-700 ${highlightApply ? 'ring-2 ring-primary ring-offset-4 ring-offset-background' : ''}`}
                    >
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
                                  <p>This Standard Creator Agreement ('Agreement') governs the relationship between the Brand ('Client') and the Content Creator ('Creator') for the specific campaign defined in this brief.</p>

                                  <p className="font-bold">2. SERVICES & DELIVERABLES</p>
                                  <p>Creator agrees to produce content ('Deliverables') according to the requirements specified in the campaign brief. {gig.requireVerzaScore ? `Deliverables must pass the Verza Quality Score threshold of ${gig.verzaScoreThreshold}% to be eligible for payout.` : "Deliverables must meet the brand's quality standards to be eligible for payout."}</p>

                                  <p className="font-bold">3. PAYMENT & ESCROW</p>
                                  {isPool ? (
                                    <p>The Client has funded a campaign budget of ${totalCost.toLocaleString()}, held in the Verza Campaign Vault. When your work is approved, the Client sets your payment from that budget. You receive that amount in full.</p>
                                  ) : (gig.ratePerCreator || 0) > 0 ? (
                                    <p>The Client has pre-funded the base rate for this campaign ($ {gig.ratePerCreator?.toLocaleString()}). Funds are held in the Verza Campaign Vault. Verza will release the payment to the Creator's wallet immediately upon Client approval of verified submissions.</p>
                                  ) : isBarterCampaign ? (
                                    <p>
                                      This campaign is a <strong>barter</strong> arrangement. Any cash, product, gifting, or other in-kind compensation is described in this brief and agreed between the parties. Verza does not escrow in-kind consideration.
                                      {gig.affiliateSettings?.isEnabled && (gig.affiliateSettings?.rewardAmount || 0) > 0
                                        ? " Optional performance rewards may still be tracked and paid through Verza as defined in this brief."
                                        : ""}
                                    </p>
                                  ) : (
                                    <p>This is a performance-based campaign. No base rate is guaranteed. Rewards are earned based on the performance metrics (conversions or clicks) defined in this brief. Verza will deposit earned rewards into the Creator's wallet following verification.</p>
                                  )}

                                  <p className="font-bold">4. INTELLECTUAL PROPERTY & USAGE</p>
                                  <p>Unless the campaign is explicitly marked as a 'Production Grant' with 'None' usage rights, the Creator grants the Client a non-exclusive, worldwide, transferable license to use the Deliverables for the duration specified in the brief. Creator retains original ownership of the underlying content.</p>

                                  <p className="font-bold">5. INDEPENDENT CONTRACTOR</p>
                                  <p>Creator is an independent contractor. Nothing in this Agreement creates an employer-employee relationship or partnership.</p>

                                  <p className="font-bold">6. CONFIDENTIALITY</p>
                                  <p>Both parties agree to keep the terms of this campaign and any proprietary brand information confidential.</p>
                                </div>
                              </ScrollArea>

                              {activeTalent.length > 0 && (
                                <div className="mt-4 p-4 rounded-lg border-2 border-primary/10 bg-primary/5 space-y-4">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <Label className="text-sm font-bold flex items-center gap-2">
                                        <Users className="h-4 w-4 text-primary" /> Management Mode
                                      </Label>
                                      <p className="text-[10px] text-muted-foreground">Claim this campaign on behalf of your talent.</p>
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
                          <Alert className="py-2 px-3 text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            <AlertDescription>
                              Connect a bank account in Settings to withdraw your earnings after approval.
                            </AlertDescription>
                          </Alert>
                        )}
                        {!user.showInMarketplace && (
                          <Alert variant="destructive" className="py-2 px-3 text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            <AlertDescription>
                              Public profile required to secure campaigns.
                            </AlertDescription>
                          </Alert>
                        )}
                        {!isAgencyAcceptance && !hasConnectedSocial && (
                          <Alert variant="destructive" className="py-2 px-3 text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            <AlertDescription>
                              Connect Instagram, YouTube, or TikTok in{" "}
                              <Link href="/insights" className="underline font-medium">
                                Insights
                              </Link>{" "}
                              before applying.
                            </AlertDescription>
                          </Alert>
                        )}
                        <Button
                          className="w-full"
                          onClick={handleApplyGig}
                          disabled={
                            isAccepting ||
                            !hasAgreedToLegal ||
                            (isAgencyAcceptance && !selectedTalentId) ||
                            (!isAgencyAcceptance && !hasConnectedSocial)
                          }
                        >
                          {isAccepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {hasInvited ? "Accept invite" : isCauseCampaign ? "Claim Campaign" : "Apply for Campaign"}
                        </Button>
                        {hasInvited && (
                          <Button
                            variant="ghost"
                            className="w-full"
                            disabled={isAccepting}
                            onClick={() => void handleDeclineInvite()}
                          >
                            Not interested
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Button className="w-full" disabled>{gig.status === 'pending_payment' ? 'Funding Pending' : 'Campaign Full'}</Button>
                  )
                )}

                {isBrandTeam && (
                  <div className="space-y-2">
                    {gig.status === 'pending_payment' && totalCost > 0 && (
                      <div className="flex flex-col gap-2 p-4 border rounded-lg bg-muted/30">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 text-center">Campaign Funding: ${totalCost.toLocaleString()}</p>
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
                        {isPool && !isCompleted && gig.status !== 'pending_payment' && (
                          <>
                            <Button className="w-full" variant="secondary" onClick={() => setIsTopUpOpen(true)}>
                              <DollarSign className="mr-2 h-4 w-4" /> Add funds
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button className="w-full" variant="outline" disabled={isClosingBudget}>
                                  {isClosingBudget ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  Close campaign
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Close this campaign?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {poolRemaining > 0
                                      ? `$${poolRemaining.toLocaleString()} still in this budget will return to your wallet. Creators who have not been paid will not be paid.`
                                      : 'This marks the campaign complete. There is no budget left to return.'}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Keep open</AlertDialogCancel>
                                  <AlertDialogAction onClick={handleCloseCampaign}>Close and return unused budget</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                        {canAddFirstBudget && (
                          <Button className="w-full" variant="secondary" onClick={() => setIsTopUpOpen(true)}>
                            <DollarSign className="mr-2 h-4 w-4" /> Add a budget
                          </Button>
                        )}
                      </div>
                    )}
                    {isAssignedAgent && !isBrandTeam && (
                      <div className="space-y-2">
                        <Button className="w-full bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/20 cursor-default" disabled>
                          <CheckCircle className="mr-2 h-4 w-4" /> Campaign Claimed
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {!isCompleted && !canManageGig && (
              <MarketplaceCoPilot
                context={hasAccepted ? 'details_creator' : 'browse'}
                className="hidden lg:block"
              />
            )}
          </div>
          ) : null}
        </div>
      </div>

      <Dialog open={!!approvingApplicant} onOpenChange={(open) => { if (!open) { setApprovingApplicant(null); setOfferAmount(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept {approvingApplicant?.displayName}</DialogTitle>
            <DialogDescription>
              This is the amount you expect to pay them. They receive it in full. You can change it when you approve their work.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="offer-amount">Creator pay ($)</Label>
            <Input id="offer-amount" type="number" min="1" value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} />
            {Number(offerAmount) >= 1 && (
              <p className="text-xs text-muted-foreground">
                Paying ${Number(offerAmount).toLocaleString()} later draws ${centsToDollars(poolDrawForCreatorAmount(Number(offerAmount), feeFraction).totalDrawCents).toLocaleString()} from the campaign budget, including Verza&apos;s {feeLabel}.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovingApplicant(null)}>Cancel</Button>
            <Button
              disabled={isAccepting || Number(offerAmount) < 1}
              onClick={() => approvingApplicant && handleApproveApplication(approvingApplicant.uid, Number(offerAmount))}
            >
              {isAccepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Accept creator
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payingCreator} onOpenChange={(open) => { if (!open) { setPayingCreator(null); setPayAmount(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay {payingCreator?.displayName}</DialogTitle>
            <DialogDescription>
              They receive this amount in full. Verza&apos;s {feeLabel} is taken from the campaign budget on top. ${poolRemaining.toLocaleString()} is left in this campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pay-amount">Creator pay ($)</Label>
            <Input id="pay-amount" type="number" min="1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            {Number(payAmount) >= 1 && (
              <p className="text-xs text-muted-foreground">
                Creator receives ${Number(payAmount).toLocaleString()}. Verza fee ${centsToDollars(poolDrawForCreatorAmount(Number(payAmount), feeFraction).platformFeeCents).toLocaleString()}. Total from this campaign ${centsToDollars(poolDrawForCreatorAmount(Number(payAmount), feeFraction).totalDrawCents).toLocaleString()}.
                {poolDrawForCreatorAmount(Number(payAmount), feeFraction).totalDrawCents > poolRemainingCents({ fundedAmount: fundedPool, budgetSpent: gig.budgetSpent })
                  ? ` That is more than the $${poolRemaining.toLocaleString()} remaining. Add funds or pay less.`
                  : ''}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayingCreator(null)}>Cancel</Button>
            <Button
              disabled={!payingCreator || isPaying === payingCreator.uid || Number(payAmount) < 1 || poolDrawForCreatorAmount(Number(payAmount), feeFraction).totalDrawCents > poolRemainingCents({ fundedAmount: fundedPool, budgetSpent: gig.budgetSpent })}
              onClick={() => payingCreator && handlePayout(payingCreator, Number(payAmount))}
            >
              {payingCreator && isPaying === payingCreator.uid ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm & pay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectingApplicant} onOpenChange={(open) => { if (!open) setRejectingApplicant(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline {rejectingApplicant?.displayName}?</DialogTitle>
            <DialogDescription>
              They&apos;ll get a short email and notification with this reason. They cannot re-apply to this campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={rejectReasonId} onValueChange={setRejectReasonId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_REJECT_REASONS.map((reason) => (
                    <SelectItem key={reason.id} value={reason.id}>{reason.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {rejectReasonId === 'other' && (
              <div className="space-y-2">
                <Label htmlFor="reject-note">Note</Label>
                <Textarea id="reject-note" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={3} placeholder="One sentence they can actually use." />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingApplicant(null)}>Cancel</Button>
            <Button variant="destructive" disabled={isRejecting || (rejectReasonId === 'other' && !rejectNote.trim())} onClick={() => void handleRejectApplication()}>
              {isRejecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTopUpOpen} onOpenChange={setIsTopUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{canAddFirstBudget ? 'Add a campaign budget' : 'Add funds to this campaign'}</DialogTitle>
            <DialogDescription>
              {canAddFirstBudget
                ? `This adds a cash budget on top of your performance rewards. You choose what each creator is paid when you approve their work; they receive the full amount and Verza's ${feeLabel} comes out of the budget. Wallet funds move immediately. A bank transfer is added when the payment clears.`
                : "This increases only this campaign's budget. Wallet funds move immediately. A bank transfer is added when the payment clears."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="top-up-budget">Amount ($)</Label>
            <Input id="top-up-budget" type="number" min="1" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsTopUpOpen(false)} disabled={isToppingUp}>Cancel</Button>
            <Button variant="secondary" onClick={handleAddBudgetFromWallet} disabled={isToppingUp}>
              {isToppingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              From wallet
            </Button>
            <Button onClick={handleAddBudgetByCard} disabled={isToppingUp}>Pay by transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, getDoc, collection, query, where, documentId, arrayUnion, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { functions, db, storage, ref as storageRef, uploadBytes, getDownloadURL } from '@/lib/firebase';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import type { Gig, GigSubmission, Notification } from '@/types';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, CheckCircle, Users, Edit, Wand2, DollarSign, UploadCloud, Play, Download, Trophy, Flame, Star, Video, CreditCard, ArrowLeft, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { generateUgcContract } from '@/ai/flows/generate-ugc-contract-flow';
import { UploadContractDialog } from '@/components/contracts/upload-contract-dialog';
import { httpsCallable } from 'firebase/functions';
import { runVerzaScore } from '@/ai/flows/gauntlet-flow';
import { Progress } from '@/components/ui/progress';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { MarketplaceCoPilot } from '@/components/marketplace/marketplace-copilot';
import { trackEvent } from '@/lib/analytics';

export default function GigDetailPage() {
  const params = useParams();
  const gigId = params.id as string;
  const router = useRouter();
  const { user, isLoading: authLoading, getUserIdToken } = useAuth();
  const { toast } = useToast();

  const [gig, setGig] = useState<Gig | null>(null);
  const [acceptedCreators, setAcceptedCreators] = useState<UserProfile[]>([]);
  const [submissions, setSubmissions] = useState<GigSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResumingFunding, setIsResumingFunding] = useState(false);
  
  const [isContractDialogOpen, setIsContractDialogOpen] = useState(false);
  const [contractGenData, setContractGenData] = useState<{ sfdt: string; talent: UserProfile } | null>(null);

  const [isUploading, setIsUploading] = useState<number | null>(null);
  const [isRunningVerzaScore, setIsRunningVerzaScore] = useState<string | null>(null);

  const payoutCreatorForGigCallable = httpsCallable(functions, 'payoutCreatorForGig');
  const createGigFundingCheckoutSessionCallable = httpsCallable(functions, 'createGigFundingCheckoutSession');

  useEffect(() => {
    if (!gigId) {
      setIsLoading(false);
      return;
    }

    const gigDocRef = doc(db, 'gigs', gigId);
    const unsubscribeGig = onSnapshot(gigDocRef, 
      (docSnap) => {
        if (docSnap.exists()) {
          setGig({ id: docSnap.id, ...docSnap.data() } as Gig);
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
  }, [gigId]);

  useEffect(() => {
    if (!gig || !user) return;

    const isBrandTeam = gig.brandId === user.primaryAgencyId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId);
    const hasAccepted = gig.acceptedCreatorIds.includes(user.uid);

    if (!isBrandTeam && !hasAccepted) return;

    const submissionsQuery = isBrandTeam 
      ? query(collection(db, 'submissions'), where('gigId', '==', gigId), where('brandId', '==', gig.brandId))
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

    return () => unsubscribeSubmissions();
  }, [gig, user, gigId]);

  useEffect(() => {
    if (gig && gig.acceptedCreatorIds.length > 0) {
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

    if (!user.stripeAccountId || !user.stripePayoutsEnabled) {
      toast({
        title: "Bank Account Required",
        description: "You must connect your bank account before you can accept paid gigs. Head to Settings to get set up securely.",
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
        description: "Your profile must be set to 'Public' in the marketplace before you can accept gigs. Head to your profile settings to enable this.",
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
    const userDocRef = doc(db, 'users', user.uid);
    try {
      const currentGigSnap = await getDoc(gigDocRef);
      if (!currentGigSnap.exists()) throw new Error("Gig no longer exists.");
      const currentGigData = currentGigSnap.data() as Gig;
      if (currentGigData.acceptedCreatorIds.length >= currentGigData.creatorsNeeded) throw new Error("Gig is full.");
      if (currentGigData.acceptedCreatorIds.includes(user.uid)) throw new Error("Already accepted.");
      
      const newAcceptedIds = [...currentGigData.acceptedCreatorIds, user.uid];
      const gigUpdates: Partial<Gig> = { acceptedCreatorIds: newAcceptedIds };
      if (newAcceptedIds.length === currentGigData.creatorsNeeded) gigUpdates.status = 'in-progress';
      
      await updateDoc(gigDocRef, gigUpdates);

      trackEvent({ action: 'accept_gig', category: 'marketplace', label: gig.title });

      const agencySnap = await getDoc(doc(db, 'agencies', currentGigData.brandId));
      if (agencySnap.exists()) {
        const agencyData = agencySnap.data();
        await addDoc(collection(db, 'notifications'), {
          userId: agencyData.ownerId,
          title: "New creator joined!",
          message: `${user.displayName || 'A creator'} has joined your gig "${gig.title}".`,
          type: 'gig_accepted',
          read: false,
          link: `/gigs/${gig.id}`,
          createdAt: serverTimestamp(),
        } as Omit<Notification, 'id'>);
      }

      const userUpdates = { giggingForAgencies: arrayUnion(currentGigData.brandId) };
      await updateDoc(userDocRef, userUpdates);

      toast({ title: "Gig Accepted!" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>, slotIndex: number) => {
    const file = e.target.files?.[0];
    if (!file || !user || !gig) return;
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Videos must be under 50MB.", variant: "destructive" });
      return;
    }
    setIsUploading(slotIndex);
    try {
      const path = `submissions/${gig.id}/${user.uid}/${slotIndex}_${Date.now()}_${file.name}`;
      const fileRef = storageRef(storage, path);
      const uploadResult = await uploadBytes(fileRef, file);
      const videoUrl = await getDownloadURL(uploadResult.ref);

      const subData: Omit<GigSubmission, 'id'> = {
        gigId: gig.id,
        brandId: gig.brandId,
        creatorId: user.uid,
        creatorName: user.displayName || 'Creator',
        creatorAvatarUrl: user.avatarUrl || null,
        videoUrl,
        verzaScore: 0,
        verzaFeedback: "",
        status: 'pending_verza_score',
        createdAt: serverTimestamp() as any,
      };

      const existingAtSlot = mySubmissions[slotIndex];
      if (existingAtSlot) {
        await updateDoc(doc(db, 'submissions', existingAtSlot.id), subData);
      } else {
        await addDoc(collection(db, 'submissions'), subData);
      }
      trackEvent({ action: 'video_upload', category: 'marketplace', label: `slot_${slotIndex}` });
      toast({ title: `Video ${slotIndex + 1} uploaded!`, description: "Calculate your Verza Score to verify your work." });
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
      
      const updates: Partial<GigSubmission> = {
        verzaScore: result.score,
        verzaFeedback: result.feedback,
        status: result.score >= 65 ? 'submitted' : 'rejected'
      };

      await updateDoc(subRef, updates);

      if (result.score >= 65) {
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
            link: `/gigs/${gig.id}`,
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

  const handleGenerateAgreement = async (creator: UserProfile) => {
    if (!gig) return;
    setIsGenerating(creator.uid);
    try {
      const { contractSfdt } = await generateUgcContract({
        brandName: gig.brandName, creatorName: creator.displayName || 'The Creator', gigDescription: gig.description, rate: gig.ratePerCreator,
      });
      if (contractSfdt) {
        trackEvent({ action: 'generate_ugc_agreement', category: 'ai_tool', label: gig.title });
        setContractGenData({ sfdt: contractSfdt, talent: creator });
        setIsContractDialogOpen(true);
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsGenerating(null);
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

      trackEvent({ action: 'gig_payout', category: 'marketplace', label: gig.title, value: gig.ratePerCreator });
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
      toast({ title: "Gig Deleted", description: "The project has been removed." });
      router.push('/gigs');
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
    try {
      const result = await createGigFundingCheckoutSessionCallable({
        id: gig.id,
        title: gig.title,
        description: gig.description,
        platforms: gig.platforms,
        ratePerCreator: gig.ratePerCreator,
        creatorsNeeded: gig.creatorsNeeded,
        videosPerCreator: gig.videosPerCreator,
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

  const mySubmissions = useMemo(() => user ? submissions.filter(s => s.creatorId === user.uid).sort((a, b) => (a.createdAt as any)?.toMillis() - (b.createdAt as any)?.toMillis()) : [], [submissions, user]);

  if (isLoading || authLoading) return <div className="flex justify-center items-center h-96"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  if (!gig) return <div className="text-center py-10"><AlertTriangle className="mx-auto h-12 w-12 text-destructive" /><h3 className="mt-4">Gig Not Found</h3></div>;

  const spotsLeft = gig.creatorsNeeded - gig.acceptedCreatorIds.length;
  const hasAccepted = user ? gig.acceptedCreatorIds.includes(user.uid) : false;
  const canManageGig = user ? gig.brandId === user.primaryAgencyId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId) : false;
  const isStripeSetup = user?.stripeAccountId && user?.stripePayoutsEnabled;
  const canDeleteGig = canManageGig && (gig.status === 'pending_payment' || (gig.status === 'open' && gig.acceptedCreatorIds.length === 0));

  return (
    <>
      <div className="flex flex-col gap-8 pb-20">
        <PageHeader
          title={gig.title}
          description={`Posted by ${gig.brandName}`}
          actions={<Button asChild variant="outline"><Link href="/gigs"><ArrowLeft className="mr-2 h-4 w-4"/> Back</Link></Button>}
        />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-8">
              <Card>
                  <CardHeader><CardTitle>Project Details</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                      {gig.brandLogoUrl && <Image src={gig.brandLogoUrl} alt="Logo" width={80} height={80} className="rounded-md" />}
                      <p className="text-muted-foreground whitespace-pre-wrap">{gig.description}</p>
                      <div><h4 className="font-semibold mb-2">Platforms</h4><div className="flex flex-wrap gap-2">{gig.platforms.map(p => <Badge key={p} variant="secondary">{p}</Badge>)}</div></div>
                  </CardContent>
              </Card>

              {hasAccepted && !canManageGig && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary"/> Submit Your Work</CardTitle>
                    <CardDescription>Upload {gig.videosPerCreator} video{gig.videosPerCreator > 1 ? 's' : ''} and calculate your Verza Score for each.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-8">
                    {Array.from({ length: gig.videosPerCreator }).map((_, i) => {
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
                              <Badge variant={submission.status === 'submitted' ? 'default' : 'secondary'} className={submission.status === 'submitted' ? 'bg-green-500' : ''}>
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
                              
                              {submission.status === 'pending_verza_score' || submission.status === 'rejected' ? (
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
                                  <Button className="w-full" onClick={() => handleRunVerzaScore(submission)} disabled={!!isRunningVerzaScore}>
                                    {scoreRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Flame className="mr-2 h-4 w-4 text-orange-500"/>}
                                    {submission.status === 'rejected' ? 'Retry Verza Score' : 'Calculate Verza Score'}
                                  </Button>
                                </div>
                              ) : (
                                <div className="p-4 border rounded-lg bg-green-500/10 text-green-700 flex items-center gap-3">
                                  <CheckCircle className="h-5 w-5"/>
                                  <p className="text-sm font-medium">Verified & Submitted! Verza Score: {submission.verzaScore}%</p>
                                </div>
                              )}
                              
                              {submission.status !== 'approved' && (
                                <div className="pt-2 flex justify-center">
                                  <Label htmlFor={`video-replace-${i}`} className="cursor-pointer text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                                    <Edit className="h-3 w-3"/> Replace Video
                                  </Label>
                                  <input id={`video-replace-${i}`} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => handleVideoUpload(e, i)} disabled={!!isUploading || !!isRunningVerzaScore}/>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg bg-background hover:bg-muted/30 transition-colors">
                              <input id={`video-upload-${i}`} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => handleVideoUpload(e, i)} disabled={!!isUploading}/>
                              <label htmlFor={`video-upload-${i}`} className="cursor-pointer flex flex-col items-center gap-3">
                                <div className="p-4 bg-muted rounded-full">
                                  {slotLoading ? <Loader2 className="h-8 w-8 animate-spin text-primary"/> : <UploadCloud className="h-8 w-8 text-primary"/>}
                                </div>
                                <div className="text-center">
                                  <p className="font-medium">{slotLoading ? 'Uploading...' : 'Upload Video'}</p>
                                  <p className="text-sm text-muted-foreground">MP4 or MOV, max 50MB</p>
                                </div>
                              </label>
                            </div>
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
                          <CardTitle className="flex items-center gap-2"><Users className="text-primary"/> Creator Roster & Submissions</CardTitle>
                          <CardDescription>Manage accepted creators and review their {gig.videosPerCreator} requested video{gig.videosPerCreator > 1 ? 's' : ''}.</CardDescription>
                      </CardHeader>
                      <CardContent>
                          {acceptedCreators.length > 0 ? (
                             <div className="space-y-6">
                                  {acceptedCreators.map(creator => {
                                    const isPaid = gig.paidCreatorIds?.includes(creator.uid);
                                    const creatorSubmissions = submissions.filter(s => s.creatorId === creator.uid);
                                    const allVideosSubmitted = creatorSubmissions.length === gig.videosPerCreator && creatorSubmissions.every(s => s.status === 'submitted' || s.status === 'approved');

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
                                                  <p className="font-semibold hover:underline">{creator.displayName}</p>
                                                  <p className="text-xs text-muted-foreground">{creator.email}</p>
                                                </div>
                                              </Link>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <Button size="sm" variant="outline" onClick={() => handleGenerateAgreement(creator)} disabled={!!isGenerating}>
                                                {isGenerating === creator.uid ? <Loader2 className="h-4 w-4 animate-spin"/> : <Wand2 className="h-4 w-4 mr-1"/>} Agreement
                                              </Button>
                                              {isPaid ? (
                                                <Badge variant="default" className="bg-green-500">Paid</Badge>
                                              ) : (
                                                <Button size="sm" onClick={() => handlePayout(creator)} disabled={isPaying === creator.uid || !allVideosSubmitted}>
                                                  {isPaying === creator.uid ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <DollarSign className="h-4 w-4 mr-1"/>} Approve & Pay
                                                </Button>
                                              )}
                                            </div>
                                          </div>

                                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {Array.from({ length: gig.videosPerCreator }).map((_, idx) => {
                                              const sub = creatorSubmissions[idx];
                                              return (
                                                <div key={idx} className="p-3 bg-background rounded-md border space-y-3">
                                                  <div className="flex items-center justify-between">
                                                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Video {idx + 1}</span>
                                                    {sub && (
                                                      <div className="flex items-center gap-2">
                                                        <Badge variant="outline" className="text-[10px] py-0 h-5 gap-1"><Star className="h-2 w-2 text-yellow-500"/> Score: {sub.verzaScore}%</Badge>
                                                        <Button size="icon" variant="ghost" className="h-6 w-6" asChild>
                                                          <a href={sub.videoUrl} download target="_blank" rel="noopener noreferrer">
                                                            <Download className="h-3 w-3"/>
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
                                                      <Loader2 className="h-4 w-4 animate-pulse text-muted-foreground mb-2"/>
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
                              <p className="text-sm text-muted-foreground text-center py-4">No creators have accepted this gig yet.</p>
                          )}
                      </CardContent>
                   </Card>
              )}
          </div>
          <div className="lg:col-span-1 space-y-6">
              <Card>
                  <CardHeader><CardTitle>Gig Overview</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                      <div className="flex justify-between items-center"><span className="text-muted-foreground">Rate per Creator</span><span className="font-bold text-2xl text-primary">${gig.ratePerCreator.toLocaleString()}</span></div>
                      <div className="flex justify-between items-center"><span className="text-muted-foreground flex items-center gap-1"><Video className="h-4 w-4" /> Videos Requested</span><span className="font-bold">{gig.videosPerCreator || 1}</span></div>
                      <div className="flex justify-between items-center"><span className="text-muted-foreground">Spots Remaining</span><span className="font-bold">{spotsLeft} / {gig.creatorsNeeded}</span></div>
                      <div className="flex justify-between items-center"><span className="text-muted-foreground">Status</span><Badge variant={gig.status === 'open' ? 'default' : 'secondary'} className={gig.status === 'open' ? 'bg-green-500' : ''}>{gig.status.replace(/_/g, ' ')}</Badge></div>
                      
                      {user && !canManageGig && (
                        hasAccepted ? (
                          <Button className="w-full" disabled><CheckCircle className="mr-2 h-4 w-4" /> Gig Accepted</Button>
                        ) : spotsLeft > 0 && gig.status === 'open' ? (
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
                                  Public profile required to accept gigs.
                                </AlertDescription>
                              </Alert>
                            )}
                            <Button 
                              className="w-full" 
                              onClick={handleAcceptGig} 
                              disabled={isAccepting}
                            >
                              {isAccepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} 
                              Accept Gig
                            </Button>
                          </div>
                        ) : (
                          <Button className="w-full" disabled>{gig.status === 'pending_payment' ? 'Funding Pending' : 'Gig Full'}</Button>
                        )
                      )}
                      
                      {canManageGig && (
                        <div className="space-y-2">
                          {gig.status === 'pending_payment' && (
                            <Button className="w-full" onClick={handleResumeFunding} disabled={isResumingFunding}>
                              {isResumingFunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <CreditCard className="mr-2 h-4 w-4"/>}
                              Complete Funding
                            </Button>
                          )}
                          <Button asChild className="w-full" variant="outline">
                            <Link href={`/gigs/${gig.id}/edit`}>
                              <Edit className="mr-2 h-4 w-4" /> Edit Gig
                            </Link>
                          </Button>
                          {canDeleteGig && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button className="w-full" variant="destructive">
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete Gig
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this gig?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently remove the gig listing. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={handleDeleteGig} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      )}
                  </CardContent>
              </Card>

              <MarketplaceCoPilot 
                context={canManageGig ? 'details_brand' : (hasAccepted ? 'details_creator' : 'browse')} 
                className="hidden lg:block"
              />
          </div>
        </div>
      </div>
      {contractGenData && (
        <UploadContractDialog isOpen={isContractDialogOpen} onOpenChange={setIsContractDialogOpen} initialSFDT={contractGenData.sfdt} initialSelectedOwner={contractGenData.talent.uid} initialFileName={`UGC Agreement - ${gig.title} - ${contractGenData.talent.displayName}.docx`} affiliatedCreator={contractGenData.talent} />
      )}
    </>
  );
}

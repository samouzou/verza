
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

  // Submission State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRunningVerzaScore, setIsRunningVerzaScore] = useState(false);
  const [activeSubmission, setActiveSubmission] = useState<GigSubmission | null>(null);

  const payoutCreatorForGigCallable = httpsCallable(functions, 'payoutCreatorForGig');
  const createGigFundingCheckoutSessionCallable = httpsCallable(functions, 'createGigFundingCheckoutSession');

  // 1. Fetch Gig Data
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

  // 2. Fetch Submissions with Role-Based Filtering
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
        
        const mySub = subs.find(s => s.creatorId === user.uid);
        
        // Auto-heal legacy submissions missing brandId
        if (mySub && !mySub.brandId && gig) {
          const subRef = doc(db, 'submissions', mySub.id);
          updateDoc(subRef, { brandId: gig.brandId }).catch(e => console.warn("Failed to auto-heal submission brandId:", e));
        }

        setActiveSubmission(mySub || null);
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

  // 3. Fetch accepted creator profiles (Brand only)
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

      // Notify Brand
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

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !gig) return;
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Videos must be under 50MB.", variant: "destructive" });
      return;
    }
    setVideoFile(file);
    setIsUploading(true);
    try {
      const path = `submissions/${gig.id}/${user.uid}/${Date.now()}_${file.name}`;
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

      if (activeSubmission) {
        const subRef = doc(db, 'submissions', activeSubmission.id);
        await updateDoc(subRef, subData);
      } else {
        await addDoc(collection(db, 'submissions'), subData);
      }
      toast({ title: "Upload successful!", description: "Now calculate your Verza Score to verify your work." });
    } catch (error: any) {
      console.error(error);
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRunVerzaScore = async () => {
    if (!activeSubmission || !gig) return;
    setIsRunningVerzaScore(true);
    toast({ title: "Calculating Verza Score...", description: "AI is analyzing engagement potential..." });
    try {
      const result = await runVerzaScore({ videoUrl: activeSubmission.videoUrl });
      const subRef = doc(db, 'submissions', activeSubmission.id);
      
      const updates: Partial<GigSubmission> = {
        verzaScore: result.score,
        verzaFeedback: result.feedback,
        status: result.score >= 65 ? 'submitted' : 'rejected'
      };

      await updateDoc(subRef, updates);

      if (result.score >= 65) {
        // Notify Brand of new submission
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
        toast({ title: "VERZA SCORE LOW", description: `Score: ${result.score}%. Check the feedback and try again.`, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Analysis Error", description: error.message, variant: "destructive" });
    } finally {
      setIsRunningVerzaScore(false);
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
      const sub = submissions.find(s => s.creatorId === creator.uid && s.status === 'submitted');
      if (sub) {
        const subRef = doc(db, 'submissions', sub.id);
        await updateDoc(subRef, { status: 'approved' });
      }

      // Notify Creator
      await addDoc(collection(db, 'notifications'), {
        userId: creator.uid,
        title: "Payout Received!",
        message: `Your submission for "${gig.title}" has been approved and paid.`,
        type: 'payout_received',
        read: false,
        link: '/wallet',
        createdAt: serverTimestamp(),
      } as Omit<Notification, 'id'>);

      toast({ title: "Payout Processing!", description: "Creator has been paid (less 5% platform fee)." });
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

  if (isLoading || authLoading) return <div className="flex justify-center items-center h-96"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  if (!gig) return <div className="text-center py-10"><AlertTriangle className="mx-auto h-12 w-12 text-destructive" /><h3 className="mt-4">Gig Not Found</h3></div>;

  const spotsLeft = gig.creatorsNeeded - gig.acceptedCreatorIds.length;
  const hasAccepted = user ? gig.acceptedCreatorIds.includes(user.uid) : false;
  const canManageGig = user ? gig.brandId === user.primaryAgencyId || user.agencyMemberships?.some(m => m.agencyId === gig.brandId) : false;
  const isStripeSetup = user?.stripeAccountId && user?.stripePayoutsEnabled;
  const canDeleteGig = canManageGig && (gig.status === 'pending_payment' || (gig.status === 'open' && gig.acceptedCreatorIds.length === 0));

  return (
    <>
      <PageHeader
        title={gig.title}
        description={`Posted by ${gig.brandName}`}
        actions={<Button asChild variant="outline"><Link href="/gigs"><ArrowLeft className="mr-2 h-4 w-4"/> Back</Link></Button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
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
                  <CardDescription>Upload your video and calculate your Verza Score to submit it to the brand.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {activeSubmission ? (
                    <div className="space-y-4">
                      <div className="aspect-video bg-black rounded-lg overflow-hidden relative group">
                        <video src={activeSubmission.videoUrl} controls className="w-full h-full" />
                        <div className="absolute top-2 right-2 flex gap-2">
                           <Badge variant={activeSubmission.status === 'submitted' ? 'default' : 'secondary'} className={activeSubmission.status === 'submitted' ? 'bg-green-500' : ''}>
                             {activeSubmission.status.replace(/_/g, ' ')}
                           </Badge>
                           <Button size="icon" variant="secondary" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" asChild>
                             <a href={activeSubmission.videoUrl} download target="_blank" rel="noopener noreferrer">
                               <Download className="h-3 w-3" />
                             </a>
                           </Button>
                        </div>
                      </div>
                      
                      {activeSubmission.status === 'pending_verza_score' || activeSubmission.status === 'rejected' ? (
                        <div className="p-4 border rounded-lg bg-muted/50 space-y-4">
                          <div className="flex justify-between items-center">
                            <h4 className="font-semibold">Verza Score Analysis</h4>
                            {activeSubmission.verzaScore > 0 && <Badge variant={activeSubmission.status === 'rejected' ? 'destructive' : 'default'}>{activeSubmission.verzaScore}%</Badge>}
                          </div>
                          {activeSubmission.verzaFeedback && (
                            <div className="p-3 bg-background rounded border border-orange-500/20">
                              <p className="text-sm italic text-muted-foreground">"{activeSubmission.verzaFeedback}"</p>
                            </div>
                          )}
                          <Button className="w-full" onClick={handleRunVerzaScore} disabled={isRunningVerzaScore}>
                            {isRunningVerzaScore ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Flame className="mr-2 h-4 w-4 text-orange-500"/>}
                            {activeSubmission.status === 'rejected' ? 'Retry Verza Score' : 'Calculate Verza Score'}
                          </Button>
                          <p className="text-xs text-center text-muted-foreground">65% minimum required to submit to brand.</p>
                        </div>
                      ) : (
                        <div className="p-4 border rounded-lg bg-green-500/10 text-green-700 flex items-center gap-3">
                          <CheckCircle className="h-5 w-5"/>
                          <p className="text-sm font-medium">Verified & Submitted! Verza Score: {activeSubmission.verzaScore}%</p>
                        </div>
                      )}
                      
                      {activeSubmission.status !== 'approved' && (
                        <div className="pt-2">
                          <Label htmlFor="video-reupload" className="cursor-pointer text-xs text-primary hover:underline flex items-center gap-1">
                            <UploadCloud className="h-3 w-3"/> Re-upload Video
                          </Label>
                          <input id="video-reupload" type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={handleVideoUpload} disabled={isUploading || isRunningVerzaScore}/>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg">
                      <input id="video-upload" type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={handleVideoUpload} disabled={isUploading}/>
                      <label htmlFor="video-upload" className="cursor-pointer flex flex-col items-center gap-3">
                        <div className="p-4 bg-muted rounded-full">
                          {isUploading ? <Loader2 className="h-8 w-8 animate-spin text-primary"/> : <UploadCloud className="h-8 w-8 text-primary"/>}
                        </div>
                        <div className="text-center">
                          <p className="font-medium">{isUploading ? 'Uploading...' : 'Click to upload your video'}</p>
                          <p className="text-sm text-muted-foreground">MP4 or MOV, max 50MB</p>
                        </div>
                      </label>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {canManageGig && (
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Users className="text-primary"/> Creator Roster & Submissions</CardTitle>
                        <CardDescription>Manage accepted creators and review their work.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {acceptedCreators.length > 0 ? (
                           <div className="space-y-6">
                                {acceptedCreators.map(creator => {
                                  const isPaid = gig.paidCreatorIds?.includes(creator.uid);
                                  const submission = submissions.find(s => s.creatorId === creator.uid);
                                  return (
                                    <Card key={creator.uid} className="border bg-muted/30">
                                      <CardContent className="p-4">
                                        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
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
                                              <Button size="sm" onClick={() => handlePayout(creator)} disabled={isPaying === creator.uid || (submission?.status !== 'submitted' && submission?.status !== 'approved')}>
                                                {isPaying === creator.uid ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <DollarSign className="h-4 w-4 mr-1"/>} Approve & Pay
                                              </Button>
                                            )}
                                          </div>
                                        </div>

                                        {submission ? (
                                          <div className="mt-4 p-3 bg-background rounded-md border space-y-3">
                                            <div className="flex items-center justify-between">
                                              <span className="text-sm font-medium flex items-center gap-2">
                                                <Play className="h-4 w-4 text-primary"/> Submission Work
                                              </span>
                                              <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="gap-1"><Star className="h-3 w-3 text-yellow-500"/> Verza Score: {submission.verzaScore}%</Badge>
                                                <Button size="sm" variant="ghost" className="h-7 px-2" asChild>
                                                  <a href={submission.videoUrl} download target="_blank" rel="noopener noreferrer">
                                                    <Download className="h-4 w-4"/>
                                                  </a>
                                                </Button>
                                              </div>
                                            </div>
                                            <video src={submission.videoUrl} controls className="w-full rounded-md max-h-64 bg-black" />
                                            {submission.verzaFeedback && (
                                              <p className="text-xs text-muted-foreground italic">AI Analysis: {submission.verzaFeedback}</p>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="mt-4 py-4 text-center border-2 border-dashed rounded-md">
                                            <p className="text-xs text-muted-foreground">Waiting for submission...</p>
                                          </div>
                                        )}
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
                    <div className="flex justify-between items-center"><span className="text-muted-foreground flex items-center gap-1"><Video className="h-4 w-4" /> Videos Needed</span><span className="font-bold">{gig.videosPerCreator || 1}</span></div>
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
        </div>
      </div>
      {contractGenData && (
        <UploadContractDialog isOpen={isContractDialogOpen} onOpenChange={setIsContractDialogOpen} initialSFDT={contractGenData.sfdt} initialSelectedOwner={contractGenData.talent.uid} initialFileName={`UGC Agreement - ${gig.title} - ${contractGenData.talent.displayName}.docx`} affiliatedCreator={contractGenData.talent} />
      )}
    </>
  );
}


"use client";

import { useEffect, useState, useCallback, FormEvent, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db, doc, getDoc, updateDoc, Timestamp, collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp } from '@/lib/firebase';
import type { SharedContractVersion as SharedContractVersionType, Contract, ContractComment, CommentReply, RedlineProposal } from '@/types';
import { Loader2, AlertTriangle, FileText, DollarSign, CalendarDays, Info, ArrowLeft, MessageSquare, Lightbulb, Send, CornerDownRight, User, FilePenLine } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link'; 
import { Input } from '@/components/ui/input'; 
import { Label } from '@/components/ui/label'; 
import { Textarea } from '@/components/ui/textarea'; 
import { Separator } from "@/components/ui/separator";
import { diffChars } from 'diff';

// Helper function to format date or return N/A
const formatDateDisplay = (dateInput: string | Timestamp | Date | undefined | null): string => {
  if (!dateInput) return 'N/A';
  try {
    let date: Date;
    if (dateInput instanceof Timestamp) {
      date = dateInput.toDate();
    } else if (dateInput instanceof Date) {
      date = dateInput;
    } else if (typeof dateInput === 'string') {
      if (dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) { // YYYY-MM-DD
        const parts = dateInput.split('-');
        date = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
      } else { // Try parsing as ISO string or other common formats
        date = new Date(dateInput);
      }
    } else {
      return 'Invalid Date Input';
    }

    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }
    return format(date, "PPp"); // Example: Jul 28, 2024, 3:30 PM
  } catch (e) {
    console.warn("Error formatting date:", dateInput, e);
    return 'Invalid Date';
  }
};


export default function ShareContractPage() {
  const params = useParams();
  const router = useRouter();
  const sharedVersionId = params.sharedVersionId as string;
  const { toast } = useToast();

  const [sharedVersion, setSharedVersion] = useState<SharedContractVersionType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [comments, setComments] = useState<ContractComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(true);
  const [newCommentText, setNewCommentText] = useState("");
  const [newCommenterName, setNewCommenterName] = useState("");
  const [newCommenterEmail, setNewCommenterEmail] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  // Redlining State
  const [redlineProposals, setRedlineProposals] = useState<RedlineProposal[]>([]);
  const [isLoadingProposals, setIsLoadingProposals] = useState(true);
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);
  const [newOriginalText, setNewOriginalText] = useState("");
  const [newProposedText, setNewProposedText] = useState("");
  const [newProposalComment, setNewProposalComment] = useState("");
  // We can reuse commenterName and commenterEmail for proposals

  // State for text selection
  const [selectedText, setSelectedText] = useState("");
  const redlineFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!sharedVersionId) {
      setError("No shared version ID provided.");
      setIsLoading(false);
      setIsLoadingComments(false);
      setIsLoadingProposals(false);
      return;
    }

    let unsubscribeComments: (() => void) | undefined;
    let unsubscribeProposals: (() => void) | undefined;

    const fetchSharedVersionAndRelatedData = async () => {
      setIsLoading(true);
      setIsLoadingComments(true);
      setIsLoadingProposals(true);
      setError(null);
      try {
        const versionDocRef = doc(db, 'sharedContractVersions', sharedVersionId);
        const versionSnap = await getDoc(versionDocRef);

        if (versionSnap.exists()) {
          const data = versionSnap.data() as SharedContractVersionType;
          if (data.status === 'revoked') {
            setError("This share link has been revoked by the creator.");
            setSharedVersion(null);
            setIsLoading(false);
            setIsLoadingComments(false);
            setIsLoadingProposals(false);
            return;
          }
          setSharedVersion({ ...data, id: versionSnap.id });
          if (!data.brandHasViewed) {
            updateDoc(versionDocRef, {
              brandHasViewed: true,
              lastViewedByBrandAt: Timestamp.now(),
            }).catch(updateError => console.warn("Could not update brandHasViewed status (expected if rules restrict public write):", updateError.message));
          }
          
          // Fetch Comments
          const commentsQuery = query(collection(db, "contractComments"), where("sharedVersionId", "==", sharedVersionId), orderBy("commentedAt", "asc"));
          unsubscribeComments = onSnapshot(commentsQuery, (snapshot) => {
            setComments(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ContractComment)));
            setIsLoadingComments(false);
          }, (commentError) => {
            console.error("Error fetching comments: ", commentError);
            setIsLoadingComments(false);
          });
          
          // Fetch Redline Proposals
          const proposalsQuery = query(collection(db, "redlineProposals"), where("sharedVersionId", "==", sharedVersionId), orderBy("proposedAt", "asc"));
          unsubscribeProposals = onSnapshot(proposalsQuery, (snapshot) => {
            setRedlineProposals(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as RedlineProposal)));
            setIsLoadingProposals(false);
          }, (proposalError) => {
            console.error("Error fetching proposals: ", proposalError);
            setIsLoadingProposals(false);
          });

        } else {
          setError("Share link not found or is invalid.");
          setSharedVersion(null);
          setIsLoadingComments(false);
          setIsLoadingProposals(false);
        }
      } catch (e: any) {
        console.error("Error fetching shared contract version:", e);
        setError(e.message || "Could not load the shared contract details. Please try again later.");
        setSharedVersion(null);
        setIsLoadingComments(false);
        setIsLoadingProposals(false);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSharedVersionAndRelatedData();
    return () => {
      if (unsubscribeComments) unsubscribeComments();
      if (unsubscribeProposals) unsubscribeProposals();
    };
  }, [sharedVersionId, toast]);

  const handleAddComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || !newCommenterName.trim() || !sharedVersion) {
      toast({ title: "Missing Information", description: "Please enter your name and comment.", variant: "destructive" });
      return;
    }
    setIsSubmittingComment(true);
    try {
      await addDoc(collection(db, "contractComments"), {
        sharedVersionId: sharedVersion.id,
        originalContractId: sharedVersion.originalContractId,
        creatorId: sharedVersion.userId, 
        commenterName: newCommenterName.trim(),
        commenterEmail: newCommenterEmail.trim() || null,
        commentText: newCommentText.trim(),
        commentedAt: serverTimestamp(),
        replies: [], 
      });
      setNewCommentText("");
      toast({ title: "Comment Added", description: "Your feedback has been submitted." });
    } catch (commentError: any) {
      console.error("Error adding comment:", commentError);
      toast({ title: "Error Submitting Comment", description: commentError.message || "Could not save your comment.", variant: "destructive" });
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleAddProposal = async (e: FormEvent) => {
    e.preventDefault();
    if (!newOriginalText.trim() || !newProposedText.trim() || !newCommenterName.trim() || !sharedVersion) {
      toast({ title: "Missing Information", description: "Please provide your name and the original & proposed text.", variant: "destructive" });
      return;
    }
    setIsSubmittingProposal(true);
    try {
      await addDoc(collection(db, "redlineProposals"), {
        sharedVersionId: sharedVersion.id,
        originalContractId: sharedVersion.originalContractId,
        creatorId: sharedVersion.userId,
        proposerName: newCommenterName.trim(),
        proposerEmail: newCommenterEmail.trim() || null,
        originalText: newOriginalText.trim(),
        proposedText: newProposedText.trim(),
        comment: newProposalComment.trim() || null,
        status: 'proposed',
        proposedAt: serverTimestamp(),
        reviewedAt: null,
      });
      setNewOriginalText("");
      setNewProposedText("");
      setNewProposalComment("");
      toast({ title: "Proposal Submitted", description: "Your suggested edit has been sent to the creator for review." });
    } catch (proposalError: any) {
      console.error("Error submitting proposal:", proposalError);
      toast({ title: "Error Submitting Proposal", description: proposalError.message || "Could not save your proposal.", variant: "destructive" });
    } finally {
      setIsSubmittingProposal(false);
    }
  };

  const handleTextSelection = () => {
    const text = window.getSelection()?.toString().trim();
    if (text) {
      setSelectedText(text);
    } else {
      setSelectedText("");
    }
  };

  const handleProposeEditForSelection = () => {
    if (selectedText) {
      setNewOriginalText(selectedText);
      redlineFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setSelectedText("");
    }
  };


  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading Shared Contract...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4 text-center">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Error</h2>
        <p className="text-muted-foreground mb-6">{error}</p>
        <Button onClick={() => router.push('/')} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Go to Homepage
        </Button>
      </div>
    );
  }

  if (!sharedVersion) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4 text-center">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Shared Contract Not Available</h2>
        <p className="text-muted-foreground mb-6">The requested shared contract could not be displayed.</p>
         <Button onClick={() => router.push('/')} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Go to Homepage
        </Button>
      </div>
    );
  }

  const contract = sharedVersion.contractData;
  const hasChangesToShow = !!contract.previousContractText && contract.previousContractText !== contract.contractText;
  const changes = hasChangesToShow ? diffChars(contract.previousContractText!, contract.contractText || '') : [];

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 py-8 px-4 sm:px-6 lg:px-8">
      <header className="max-w-7xl mx-auto mb-8">
        <div className="flex items-center gap-3 mb-2">
          <svg width="40" height="40" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary">
             <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontSize="38" fontWeight="bold" fill="currentColor">V</text>
          </svg>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Contract Review</h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Shared by creator on: {formatDateDisplay(sharedVersion.sharedAt)}
        </p>
      </header>

      <main className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content (Document) */}
          <div className="lg:col-span-2 space-y-6">
            {sharedVersion.notesForBrand && (
              <Card className="bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-700 shadow-md">
                <CardHeader><CardTitle className="text-lg text-blue-700 dark:text-blue-300 flex items-center"><MessageSquare className="mr-2 h-5 w-5"/> Notes from Creator</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-blue-600 dark:text-blue-200 whitespace-pre-wrap">{sharedVersion.notesForBrand}</p></CardContent>
              </Card>
            )}

            <Card className="shadow-lg bg-card text-card-foreground">
                <CardHeader>
                    <CardTitle className="text-xl text-slate-700 dark:text-slate-200">Contract: {contract.brand} - {contract.projectName || 'Details'}</CardTitle>
                    <CardDescription className="dark:text-slate-400">
                      {hasChangesToShow
                        ? "Review the proposed changes below. Deletions are in red, additions are in green."
                        : "Review the full text of the agreement below."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm p-4 border rounded-lg bg-muted/30">
                        <div><strong className="text-slate-600 dark:text-slate-300">Brand:</strong> <span className="text-slate-800 dark:text-slate-100">{contract.brand}</span></div>
                        <div><strong className="text-slate-600 dark:text-slate-300">Amount:</strong> <span className="text-slate-800 dark:text-slate-100 font-semibold">${contract.amount.toLocaleString()}</span></div>
                        <div><strong className="text-slate-600 dark:text-slate-300">Due Date:</strong> <span className="text-slate-800 dark:text-slate-100">{formatDateDisplay(contract.dueDate)}</span></div>
                        {contract.projectName && <div><strong className="text-slate-600 dark:text-slate-300">Project:</strong> <span className="text-slate-800 dark:text-slate-100">{contract.projectName}</span></div>}
                     </div>
                     {contract.contractText && (
                      <div className="relative">
                        <h3 className="font-semibold text-lg mb-2 text-slate-700 dark:text-slate-200">Full Contract Text</h3>
                        <p className="text-xs text-muted-foreground mb-2">Select text below to propose an edit.</p>
                        <ScrollArea onMouseUp={handleTextSelection} className="h-[1100px] border rounded-md p-4 bg-slate-50 dark:bg-slate-800">
                          <pre className="whitespace-pre-wrap font-mono text-sm">
                            {hasChangesToShow ? (
                              changes.map((part, index) => {
                                  if (part.added) {
                                    return <ins key={index} className="diff-ins">{part.value}</ins>;
                                  }
                                  if (part.removed) {
                                    return <del key={index} className="diff-del">{part.value}</del>;
                                  }
                                  return <span key={index}>{part.value}</span>;
                              })
                            ) : (
                              <span>{contract.contractText || "No contract text available."}</span>
                            )}
                          </pre>
                        </ScrollArea>
                        {selectedText && (
                            <div className="absolute top-10 right-4 z-10">
                                <Button onClick={handleProposeEditForSelection} size="sm" variant="default" className="shadow-lg">
                                    <FilePenLine className="mr-2 h-4 w-4" />Propose Edit
                                </Button>
                            </div>
                        )}
                      </div>
                    )}
                </CardContent>
            </Card>
          </div>

          {/* Right Column - Feedback & Actions */}
          <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-8 h-fit">
             <Card className="shadow-lg bg-card text-card-foreground">
                <CardHeader>
                    <CardTitle className="text-lg text-slate-700 dark:text-slate-200">Provide Your Feedback</CardTitle>
                    <CardDescription>Enter your name to leave comments or suggest edits.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label htmlFor="commenterName" className="dark:text-slate-300">Your Name*</Label>
                        <Input id="commenterName" value={newCommenterName} onChange={(e) => setNewCommenterName(e.target.value)} placeholder="e.g., Jane Doe" required className="mt-1"/>
                    </div>
                    <div>
                        <Label htmlFor="commenterEmail" className="dark:text-slate-300">Your Email (Optional)</Label>
                        <Input id="commenterEmail" type="email" value={newCommenterEmail} onChange={(e) => setNewCommenterEmail(e.target.value)} placeholder="jane.doe@brand.com" className="mt-1"/>
                    </div>
                </CardContent>
            </Card>
            
            <Card className="shadow-lg bg-card text-card-foreground">
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><FilePenLine/>Suggest an Edit (Redline)</CardTitle></CardHeader>
                <CardContent>
                    <form ref={redlineFormRef} onSubmit={handleAddProposal} className="space-y-4">
                        <div>
                            <Label htmlFor="originalText">Original Text</Label>
                            <Textarea id="originalText" value={newOriginalText} onChange={(e) => setNewOriginalText(e.target.value)} required placeholder="Select text from the contract to populate this..." rows={3} className="mt-1 font-mono text-xs"/>
                        </div>
                        <div>
                            <Label htmlFor="proposedText">Proposed New Text</Label>
                            <Textarea id="proposedText" value={newProposedText} onChange={(e) => setNewProposedText(e.target.value)} required placeholder="Enter your suggested replacement..." rows={3} className="mt-1 font-mono text-xs"/>
                        </div>
                        <div>
                            <Label htmlFor="proposalComment">Reason (Optional)</Label>
                            <Textarea id="proposalComment" value={newProposalComment} onChange={(e) => setNewProposalComment(e.target.value)} placeholder="Explain your change..." rows={2} className="mt-1"/>
                        </div>
                        <Button type="submit" disabled={isSubmittingProposal || !newOriginalText.trim() || !newProposedText.trim() || !newCommenterName.trim()} className="w-full">
                            {isSubmittingProposal ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4"/>} Submit Proposal
                        </Button>
                    </form>
                </CardContent>
            </Card>

             <Card className="shadow-lg bg-card text-card-foreground">
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><MessageSquare/> Feedback History</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleAddComment} className="space-y-4 mb-6">
                  <div>
                    <Label htmlFor="commentText" className="dark:text-slate-300">General Comment</Label>
                    <Textarea id="commentText" value={newCommentText} onChange={(e) => setNewCommentText(e.target.value)} placeholder="Leave general feedback here..." required rows={3} className="mt-1" disabled={isSubmittingComment}/>
                  </div>
                  <Button type="submit" disabled={isSubmittingComment || !newCommentText.trim() || !newCommenterName.trim()} className="w-full">
                    {isSubmittingComment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Submit Comment
                  </Button>
                </form>
                <Separator className="my-4"/>
                <ScrollArea className="h-[250px] pr-3">
                    {isLoadingProposals || isLoadingComments ? <div className="flex justify-center items-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                    : (redlineProposals.length === 0 && comments.length === 0) ? <p className="text-sm text-muted-foreground text-center py-4">No feedback yet.</p>
                    : <div className="space-y-4">
                        {redlineProposals.map(p => {
                           const diff = diffChars(p.originalText, p.proposedText);
                           return (
                            <div key={p.id} className="p-3 border rounded-lg bg-muted/30 text-xs">
                              <div className="flex justify-between items-center mb-1">
                                <p className="font-semibold text-sm">{p.proposerName}</p>
                                <Badge variant={p.status === 'proposed' ? 'secondary' : p.status === 'accepted' ? 'default' : 'destructive'} className={`capitalize text-xs ${p.status === 'accepted' ? 'bg-green-500' : ''}`}>{p.status}</Badge>
                              </div>
                              {p.comment && <p className="italic text-muted-foreground mb-2">"{p.comment}"</p>}
                              <div className="font-mono text-xs bg-muted p-2 rounded mt-2">
                                <pre className="whitespace-pre-wrap">
                                  {diff.map((part, index) => {
                                      if (part.added) {
                                        return <ins key={index} className="diff-ins">{part.value}</ins>;
                                      }
                                      if (part.removed) {
                                        return <del key={index} className="diff-del">{part.value}</del>;
                                      }
                                      return <span key={index}>{part.value}</span>;
                                  })}
                                </pre>
                              </div>
                            </div>
                           );
                        })}
                        {comments.map(c => (
                          <div key={c.id} className="p-3 border rounded-md bg-slate-50/70 dark:bg-slate-800/70">
                            <div className="flex items-start justify-between mb-1">
                               <p className="text-sm font-semibold">{c.commenterName}</p>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{c.commentText}</p>
                            {c.replies && c.replies.length > 0 && (
                                <div className="mt-3 ml-5 pl-4 border-l-2 border-slate-200 dark:border-slate-700 space-y-3">
                                    {c.replies.map(reply => (
                                        <div key={reply.replyId}>
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="text-xs font-semibold text-primary flex items-center"><CornerDownRight className="h-3 w-3 mr-1.5" />{reply.creatorName} (Creator)</p>
                                            </div>
                                            <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap ml-5">{reply.replyText}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                          </div>
                        ))}
                    </div>}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <footer className="text-center text-xs text-slate-500 dark:text-slate-400 mt-12 py-4">
        Shared via Verza &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}

    
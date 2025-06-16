
"use client";

import { useEffect, useState, useCallback, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db, doc, getDoc, updateDoc, Timestamp, collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp } from '@/lib/firebase';
import type { SharedContractVersion as SharedContractVersionType, Contract, ContractComment } from '@/types';
import { Loader2, AlertTriangle, FileText, DollarSign, CalendarDays, Info, ArrowLeft, MessageSquare, Lightbulb, Send } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link'; // Ensure Link is imported
import { Input } from '@/components/ui/input'; // Ensure Input is imported
import { Label } from '@/components/ui/label'; // Ensure Label is imported
import { Textarea } from '@/components/ui/textarea'; // Ensure Textarea is imported
import { Separator } from "@/components/ui/separator"; // Added missing import

// Helper function to format date or return N/A
const formatDateDisplay = (dateInput: string | Timestamp | undefined | null): string => {
  if (!dateInput) return 'N/A';
  try {
    const date = dateInput instanceof Timestamp ? dateInput.toDate() : new Date(dateInput);
    if (isNaN(date.getTime())) {
      if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const parts = dateInput.split('-');
        const utcDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
        if (!isNaN(utcDate.getTime())) return format(utcDate, "PPP");
      }
      return 'Invalid Date';
    }
    return format(date, "PPP");
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

  useEffect(() => {
    if (!sharedVersionId) {
      setError("No shared version ID provided.");
      setIsLoading(false);
      setIsLoadingComments(false);
      return;
    }

    let unsubscribeComments: (() => void) | undefined;

    const fetchSharedVersionAndComments = async () => {
      setIsLoading(true);
      setIsLoadingComments(true);
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
            return;
          }
          setSharedVersion({ ...data, id: versionSnap.id });
          if (!data.brandHasViewed) {
            // This update might fail due to Firestore rules if user is not authenticated (which is expected for public viewers).
            // The page will still load. Consider a Cloud Function for robust 'viewed' tracking.
            updateDoc(versionDocRef, {
              brandHasViewed: true,
              lastViewedByBrandAt: Timestamp.now(),
            }).catch(updateError => console.warn("Could not update brandHasViewed status:", updateError.message));
          }

          // Fetch comments
          const commentsQuery = query(
            collection(db, "contractComments"),
            where("sharedVersionId", "==", sharedVersionId),
            orderBy("commentedAt", "asc")
          );
          unsubscribeComments = onSnapshot(commentsQuery, (snapshot) => {
            const fetchedComments = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ContractComment));
            setComments(fetchedComments);
            setIsLoadingComments(false);
          }, (commentError) => {
            console.error("Error fetching comments: ", commentError);
            toast({ title: "Comments Error", description: "Could not load comments.", variant: "destructive" });
            setIsLoadingComments(false);
          });

        } else {
          setError("Share link not found or is invalid.");
          setSharedVersion(null);
          setIsLoadingComments(false);
        }
      } catch (e: any) {
        console.error("Error fetching shared contract version:", e);
        setError(e.message || "Could not load the shared contract details. Please try again later.");
        setSharedVersion(null);
        setIsLoadingComments(false);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSharedVersionAndComments();
    return () => {
      if (unsubscribeComments) unsubscribeComments();
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
        creatorId: sharedVersion.userId, // Important for security rules
        commenterName: newCommenterName.trim(),
        commenterEmail: newCommenterEmail.trim() || null,
        commentText: newCommentText.trim(),
        commentedAt: serverTimestamp(),
      });
      setNewCommentText("");
      setNewCommenterName("");
      setNewCommenterEmail("");
      toast({ title: "Comment Added", description: "Your feedback has been submitted." });
    } catch (commentError: any) {
      console.error("Error adding comment:", commentError);
      toast({ title: "Error Submitting Comment", description: commentError.message || "Could not save your comment.", variant: "destructive" });
    } finally {
      setIsSubmittingComment(false);
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
  const hasExtractedTerms = contract.extractedTerms && Object.values(contract.extractedTerms).some(term => term !== undefined && term !== null && (Array.isArray(term) ? term.length > 0 : true));
  const hasNegotiationSuggestions = contract.negotiationSuggestions && 
                                   (contract.negotiationSuggestions.paymentTerms ||
                                    contract.negotiationSuggestions.exclusivity ||
                                    contract.negotiationSuggestions.ipRights ||
                                    (contract.negotiationSuggestions.generalSuggestions && contract.negotiationSuggestions.generalSuggestions.length > 0));

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <header className="max-w-4xl mx-auto mb-8">
        <div className="flex items-center gap-3 mb-2">
          <svg width="40" height="40" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary">
             <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontSize="38" fontWeight="bold" fill="currentColor">V</text>
          </svg>
          <h1 className="text-3xl font-bold text-slate-800">Contract Review</h1>
        </div>
        <p className="text-sm text-slate-500">
          Shared on: {formatDateDisplay(sharedVersion.sharedAt)}
          {sharedVersion.brandHasViewed && sharedVersion.lastViewedByBrandAt && (
            <span className="ml-2 text-green-600">(Viewed on: {formatDateDisplay(sharedVersion.lastViewedByBrandAt)})</span>
          )}
        </p>
      </header>

      <main className="max-w-4xl mx-auto space-y-6">
        {sharedVersion.notesForBrand && (
          <Card className="bg-blue-50 border-blue-200 shadow-md">
            <CardHeader>
              <CardTitle className="text-lg text-blue-700 flex items-center">
                <MessageSquare className="mr-2 h-5 w-5"/> Notes from Creator
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-blue-600 whitespace-pre-wrap">{sharedVersion.notesForBrand}</p>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl text-slate-700">
              Contract: {contract.brand} - {contract.projectName || contract.fileName || 'Details'}
            </CardTitle>
            <CardDescription>
                {contract.contractType && <Badge variant="secondary" className="capitalize mr-2">{contract.contractType}</Badge>}
                Invoice Status: <Badge variant={contract.invoiceStatus === 'paid' ? 'default' : 'outline'} className={`capitalize ${contract.invoiceStatus === 'paid' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>{contract.invoiceStatus?.replace('_', ' ') || 'None'}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><strong className="text-slate-600">Brand:</strong> <span className="text-slate-800">{contract.brand}</span></div>
              <div><strong className="text-slate-600">Amount:</strong> <span className="text-slate-800 font-semibold">${contract.amount.toLocaleString()}</span></div>
              <div><strong className="text-slate-600">Due Date:</strong> <span className="text-slate-800">{formatDateDisplay(contract.dueDate)}</span></div>
              {contract.projectName && <div><strong className="text-slate-600">Project:</strong> <span className="text-slate-800">{contract.projectName}</span></div>}
              {contract.clientName && <div><strong className="text-slate-600">Client Name:</strong> <span className="text-slate-800">{contract.clientName}</span></div>}
              {contract.clientEmail && <div><strong className="text-slate-600">Client Email:</strong> <span className="text-slate-800">{contract.clientEmail}</span></div>}
            </div>
            {contract.fileUrl && (
              <div className="mt-3">
                <Button variant="outline" asChild size="sm">
                  <a href={contract.fileUrl} target="_blank" rel="noopener noreferrer">
                    <FileText className="mr-2 h-4 w-4" /> View Original Contract File
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {contract.summary && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg text-slate-700">AI Generated Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-auto max-h-[200px] pr-3">
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{contract.summary}</p>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
        
        {hasExtractedTerms && contract.extractedTerms && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg text-slate-700">Key Terms (AI Extracted)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {contract.extractedTerms.deliverables && contract.extractedTerms.deliverables.length > 0 && (
                <div><strong className="text-slate-600">Deliverables:</strong> <span className="text-slate-800">{contract.extractedTerms.deliverables.join(', ')}</span></div>
              )}
              {contract.extractedTerms.paymentMethod && <div><strong className="text-slate-600">Payment Method:</strong> <span className="text-slate-800">{contract.extractedTerms.paymentMethod}</span></div>}
              {contract.extractedTerms.usageRights && <div><strong className="text-slate-600">Usage Rights:</strong> <span className="text-slate-800">{contract.extractedTerms.usageRights}</span></div>}
              {contract.extractedTerms.terminationClauses && <div><strong className="text-slate-600">Termination:</strong> <span className="text-slate-800">{contract.extractedTerms.terminationClauses}</span></div>}
              {contract.extractedTerms.lateFeePenalty && <div><strong className="text-slate-600">Late Fee/Penalty:</strong> <span className="text-slate-800">{contract.extractedTerms.lateFeePenalty}</span></div>}
            </CardContent>
          </Card>
        )}

        {hasNegotiationSuggestions && contract.negotiationSuggestions && (
           <Card className="shadow-lg bg-indigo-50 border-indigo-200">
              <CardHeader>
                <CardTitle className="text-lg text-indigo-700 flex items-center">
                    <Lightbulb className="mr-2 h-5 w-5"/> Creator's Negotiation Points (AI Suggestions)
                </CardTitle>
                <CardDescription className="text-indigo-600">These were AI-generated suggestions for the creator during contract review.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {contract.negotiationSuggestions.paymentTerms && <p><strong className="text-indigo-700">Payment Terms Advice:</strong> <span className="text-indigo-800">{contract.negotiationSuggestions.paymentTerms}</span></p>}
                {contract.negotiationSuggestions.exclusivity && <p><strong className="text-indigo-700">Exclusivity Advice:</strong> <span className="text-indigo-800">{contract.negotiationSuggestions.exclusivity}</span></p>}
                {contract.negotiationSuggestions.ipRights && <p><strong className="text-indigo-700">IP Rights Advice:</strong> <span className="text-indigo-800">{contract.negotiationSuggestions.ipRights}</span></p>}
                {contract.negotiationSuggestions.generalSuggestions && contract.negotiationSuggestions.generalSuggestions.length > 0 && (
                  <div>
                    <strong className="text-indigo-700">General Suggestions:</strong>
                    <ul className="list-disc list-inside ml-4 text-indigo-800">
                      {contract.negotiationSuggestions.generalSuggestions.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
        )}

        {contract.contractText && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg text-slate-700">Full Contract Text (Snapshot)</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px] border rounded-md p-3 bg-slate-100">
                <p className="text-xs text-slate-700 whitespace-pre-wrap">{contract.contractText}</p>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg text-slate-700">Feedback & Comments</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddComment} className="space-y-4 mb-6">
              <div>
                <Label htmlFor="commenterName">Your Name</Label>
                <Input 
                  id="commenterName" 
                  value={newCommenterName} 
                  onChange={(e) => setNewCommenterName(e.target.value)} 
                  placeholder="e.g., Jane Doe (Brand Manager)" 
                  required 
                  className="mt-1"
                  disabled={isSubmittingComment}
                />
              </div>
              <div>
                <Label htmlFor="commenterEmail">Your Email (Optional)</Label>
                <Input 
                  id="commenterEmail" 
                  type="email"
                  value={newCommenterEmail} 
                  onChange={(e) => setNewCommenterEmail(e.target.value)} 
                  placeholder="jane.doe@brand.com" 
                  className="mt-1"
                  disabled={isSubmittingComment}
                />
              </div>
              <div>
                <Label htmlFor="commentText">Your Comment/Feedback</Label>
                <Textarea 
                  id="commentText" 
                  value={newCommentText} 
                  onChange={(e) => setNewCommentText(e.target.value)} 
                  placeholder="Enter your feedback here..." 
                  required 
                  rows={4}
                  className="mt-1"
                  disabled={isSubmittingComment}
                />
              </div>
              <Button type="submit" disabled={isSubmittingComment || !newCommentText.trim() || !newCommenterName.trim()}>
                {isSubmittingComment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Submit Feedback
              </Button>
            </form>

            <Separator className="my-6"/>

            {isLoadingComments && <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoadingComments && comments.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No comments yet. Be the first to provide feedback!</p>
            )}
            {!isLoadingComments && comments.length > 0 && (
              <ScrollArea className="h-auto max-h-[400px] pr-3">
                <div className="space-y-4">
                  {comments.map(comment => (
                    <div key={comment.id} className="p-3 border rounded-md bg-slate-100/70">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-slate-700">{comment.commenterName}</p>
                        <p className="text-xs text-slate-500">{formatDateDisplay(comment.commentedAt)}</p>
                      </div>
                      {comment.commenterEmail && <p className="text-xs text-slate-500 mb-1">{comment.commenterEmail}</p>}
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">{comment.commentText}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </main>
      <footer className="text-center text-xs text-slate-500 mt-12 py-4">
        Shared via Verza &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}

    
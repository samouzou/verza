
"use client";

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, FormEvent, useRef } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit3, Trash2, FileText, DollarSign, CalendarDays, Briefcase, Info, CheckCircle, AlertTriangle, Loader2, Lightbulb, FileSpreadsheet, History, Printer, Share2, MessageCircle, Send as SendIconComponent, CornerDownRight, User, Mail, Trash, FilePenLine, Check, X, Menu } from 'lucide-react'; // Renamed Send icon
import Link from 'next/link';
import type { Contract, SharedContractVersion as SharedContractVersionType, ContractComment, CommentReply, RedlineProposal } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ContractStatusBadge } from '@/components/contracts/contract-status-badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, Timestamp, deleteDoc as deleteFirestoreDoc, serverTimestamp, arrayUnion, collection, query, where, onSnapshot, orderBy, updateDoc, arrayRemove } from '@/lib/firebase';
import { storage, functions as firebaseAppFunctions } from '@/lib/firebase'; // Import initialized functions
import { ref as storageFileRef, deleteObject } from 'firebase/storage';
import { getFunctions, httpsCallableFromURL } from 'firebase/functions'; // Keep these for callable
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from "@/hooks/use-toast";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ShareContractDialog } from '@/components/contracts/share-contract-dialog';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const INITIATE_HELLOSIGN_REQUEST_FUNCTION_URL = "https://initiatehellosignrequest-cpmccwbluq-uc.a.run.app";


function DetailItem({ icon: Icon, label, value, valueClassName }: { icon: React.ElementType, label: string, value: React.ReactNode, valueClassName?: string }) {
  return (
    <div className="flex items-start space-x-3">
      <Icon className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`font-medium ${valueClassName}`}>{value || 'N/A'}</p>
      </div>
    </div>
  );
}

interface ReplyFormProps {
  commentId: string;
  onSubmitReply: (commentId: string, replyText: string) => Promise<void>;
}

function ReplyForm({ commentId, onSubmitReply }: ReplyFormProps) {
  const [replyText, setReplyText] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setIsSubmittingReply(true);
    await onSubmitReply(commentId, replyText.trim());
    setReplyText("");
    setIsSubmittingReply(false);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 ml-8 pl-4 border-l border-muted space-y-2">
      <Textarea
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        placeholder="Write your reply..."
        rows={2}
        className="text-sm"
        disabled={isSubmittingReply}
      />
      <Button type="submit" size="sm" variant="outline" disabled={isSubmittingReply || !replyText.trim()}>
        {isSubmittingReply ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <SendIconComponent className="mr-1 h-3 w-3" />}
        Reply
      </Button>
    </form>
  );
}


export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { user, isLoading: authLoading, getUserIdToken } = useAuth();
  const { toast } = useToast();
  const [isDeletingContract, setIsDeletingContract] = useState(false);
  const [isContractDeleteDialogOpen, setIsContractDeleteDialogOpen] = useState(false);
  const [sharedVersions, setSharedVersions] = useState<SharedContractVersionType[]>([]);
  const [isLoadingSharedVersions, setIsLoadingSharedVersions] = useState(true);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [contractComments, setContractComments] = useState<ContractComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(true);

  // Redlining State
  const [redlineProposals, setRedlineProposals] = useState<RedlineProposal[]>([]);
  const [isLoadingProposals, setIsLoadingProposals] = useState(true);
  const [isUpdatingProposal, setIsUpdatingProposal] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'comment'; id: string } | { type: 'reply'; commentId: string; replyId: string } | null>(null);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [isDeletingCommentOrReply, setIsDeletingCommentOrReply] = useState(false);

  // E-Signature State
  const [isSendingForSignature, setIsSendingForSignature] = useState(false);
  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [signerEmailOverride, setSignerEmailOverride] = useState("");

  const [isSidebarVisible, setIsSidebarVisible] = useState(false);

  useEffect(() => {
    let unsubscribeSharedVersions: (() => void) | undefined;
    let unsubscribeComments: (() => void) | undefined;
    let unsubscribeProposals: (() => void) | undefined;
    let unsubscribeContract: (() => void) | undefined;


    if (id && user && !authLoading) {
      setIsLoading(true);
      setIsLoadingSharedVersions(true);
      setIsLoadingComments(true);
      setIsLoadingProposals(true);

      const contractDocRef = doc(db, 'contracts', id as string);
      unsubscribeContract = onSnapshot(contractDocRef, (contractSnap) => {
        const agencyId = user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId;
        const data = contractSnap.data();

        if (contractSnap.exists() && data && (data.userId === user.uid || (data.ownerType === 'agency' && data.ownerId === agencyId))) {
          let createdAt = data.createdAt;
          if (createdAt && !(createdAt instanceof Timestamp)) {
            if (typeof createdAt === 'string') {
              createdAt = Timestamp.fromDate(new Date(createdAt));
            } else if (createdAt.seconds && typeof createdAt.seconds === 'number' && createdAt.nanoseconds && typeof createdAt.nanoseconds === 'number') {
              createdAt = new Timestamp(createdAt.seconds, createdAt.nanoseconds);
            } else {
              createdAt = Timestamp.now(); 
            }
          } else if (!createdAt) {
               createdAt = Timestamp.now();
          }

          let updatedAt = data.updatedAt;
          if (updatedAt && !(updatedAt instanceof Timestamp)) {
             if (typeof updatedAt === 'string') {
              updatedAt = Timestamp.fromDate(new Date(updatedAt));
            } else if (updatedAt.seconds && typeof updatedAt.seconds === 'number' && updatedAt.nanoseconds && typeof updatedAt.nanoseconds === 'number') {
              updatedAt = new Timestamp(updatedAt.seconds, updatedAt.nanoseconds);
            } else {
              updatedAt = Timestamp.now(); 
            }
          } else if (!updatedAt) {
              updatedAt = Timestamp.now();
          }
          
          let lastReminderSentAt = data.lastReminderSentAt;
          if (lastReminderSentAt && !(lastReminderSentAt instanceof Timestamp)) {
            if (typeof lastReminderSentAt === 'string') {
              lastReminderSentAt = Timestamp.fromDate(new Date(lastReminderSentAt));
            } else if (lastReminderSentAt.seconds && typeof lastReminderSentAt.seconds === 'number') {
              lastReminderSentAt = new Timestamp(lastReminderSentAt.seconds, lastReminderSentAt.nanoseconds || 0);
            } else {
              lastReminderSentAt = null;
            }
          }
          
          let lastSignatureEventAt = data.lastSignatureEventAt;
           if (lastSignatureEventAt && !(lastSignatureEventAt instanceof Timestamp)) {
            if (typeof lastSignatureEventAt === 'string') {
              lastSignatureEventAt = Timestamp.fromDate(new Date(lastSignatureEventAt));
            } else if (lastSignatureEventAt.seconds && typeof lastSignatureEventAt.seconds === 'number') {
              lastSignatureEventAt = new Timestamp(lastSignatureEventAt.seconds, lastSignatureEventAt.nanoseconds || 0);
            } else {
              lastSignatureEventAt = null;
            }
          }


          setContract({
            id: contractSnap.id,
            ...data,
            createdAt: createdAt,
            updatedAt: updatedAt,
            lastReminderSentAt: lastReminderSentAt || null,
            invoiceStatus: data.invoiceStatus || 'none',
            invoiceHistory: data.invoiceHistory?.map((entry: any) => ({
              ...entry,
              timestamp: entry.timestamp instanceof Timestamp ? entry.timestamp : Timestamp.fromDate(new Date(entry.timestamp.seconds * 1000))
            })) || [],
            signatureStatus: data.signatureStatus || 'none',
            lastSignatureEventAt: lastSignatureEventAt || null,
          } as Contract);
        } else {
          setContract(null);
          toast({ title: "Error", description: "Contract not found or you don't have permission to view it.", variant: "destructive" });
          router.push('/contracts');
        }
        setIsLoading(false);
      }, (error) => {
          console.error("Error fetching contract with onSnapshot:", error);
          setContract(null);
          toast({ title: "Fetch Error", description: "Could not load contract details.", variant: "destructive" });
          setIsLoading(false);
      });


      const sharedVersionsQuery = query(
        collection(db, "sharedContractVersions"),
        where("originalContractId", "==", id),
        where("userId", "==", user.uid),
        orderBy("sharedAt", "desc")
      );
      unsubscribeSharedVersions = onSnapshot(sharedVersionsQuery, (snapshot) => {
        const versions = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as SharedContractVersionType));
        setSharedVersions(versions);
        setIsLoadingSharedVersions(false);
      }, (error) => {
        console.error("Error fetching shared versions: ", error);
        toast({ title: "Sharing Error", description: "Could not load shared versions.", variant: "destructive" });
        setIsLoadingSharedVersions(false);
      });

      const commentsQuery = query(
        collection(db, "contractComments"),
        where("originalContractId", "==", id),
        where("creatorId", "==", user.uid), 
        orderBy("commentedAt", "desc")
      );
      unsubscribeComments = onSnapshot(commentsQuery, (snapshot) => {
        const fetchedComments = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ContractComment));
        setContractComments(fetchedComments);
        setIsLoadingComments(false);
      }, (error) => {
        console.error("Error fetching contract comments:", error);
        toast({ title: "Comment Fetch Error", description: "Could not load comments for this contract.", variant: "destructive" });
        setIsLoadingComments(false);
      });
      
      const proposalsQuery = query(
        collection(db, "redlineProposals"),
        where("originalContractId", "==", id),
        where("creatorId", "==", user.uid),
        orderBy("proposedAt", "desc")
      );
      unsubscribeProposals = onSnapshot(proposalsQuery, (snapshot) => {
        const proposals = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as RedlineProposal));
        setRedlineProposals(proposals);
        setIsLoadingProposals(false);
      }, (error) => {
        console.error("Error fetching redline proposals: ", error);
        toast({ title: "Proposals Error", description: "Could not load redline proposals.", variant: "destructive" });
        setIsLoadingProposals(false);
      });


    } else if (!authLoading && !user) {
      router.push('/login');
    } else if (!id) {
        setIsLoading(false);
        setIsLoadingSharedVersions(false);
        setIsLoadingComments(false);
        setIsLoadingProposals(false);
    }
     return () => {
      if (unsubscribeContract) unsubscribeContract();
      if (unsubscribeSharedVersions) unsubscribeSharedVersions();
      if (unsubscribeComments) unsubscribeComments();
      if (unsubscribeProposals) unsubscribeProposals();
    };
  }, [id, user, authLoading, router, toast]);

  useEffect(() => {
    if (isSignatureDialogOpen && contract) {
      setSignerEmailOverride(contract.clientEmail || "");
    }
  }, [isSignatureDialogOpen, contract]);

  const handleDeleteContract = async () => {
    if (!contract) return;
    setIsDeletingContract(true);
    try {
      if (contract.fileUrl) {
        try {
          const fileRef = storageFileRef(storage, contract.fileUrl);
          await deleteObject(fileRef);
          toast({ title: "File Deleted", description: "Associated file removed from storage." });
        } catch (storageError: any) {
          console.error("Error deleting file from storage:", storageError);
          if (storageError.code !== 'storage/object-not-found') { 
             toast({ title: "Storage Error", description: "Could not delete associated file. It might have been already removed or the URL is invalid.", variant: "destructive" });
          }
        }
      }

      const contractDocRef = doc(db, 'contracts', contract.id);
      await deleteFirestoreDoc(contractDocRef);

      toast({ title: "Contract Deleted", description: `${contract.brand} contract has been successfully deleted.` });
      router.push('/contracts');
    } catch (error) {
      console.error("Error deleting contract:", error);
      toast({ title: "Deletion Failed", description: "Could not delete the contract. Please try again.", variant: "destructive" });
    } finally {
      setIsDeletingContract(false);
      setIsContractDeleteDialogOpen(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };
  
  const formatCommentDateDisplay = (dateInput: Timestamp | undefined | null): string => {
    if (!dateInput) return 'N/A';
    try {
      const date = dateInput.toDate();
      return format(date, "PPp"); 
    } catch (e) {
      console.warn("Error formatting comment date:", dateInput, e);
      return 'Invalid Date';
    }
  };

  const handleAddReply = async (commentId: string, replyText: string) => {
    if (!user || !contract) {
      toast({ title: "Error", description: "User or contract data missing.", variant: "destructive" });
      return;
    }
    try {
      const commentDocRef = doc(db, "contractComments", commentId);
      const newReply: CommentReply = {
        replyId: doc(collection(db, "tmp")).id, 
        creatorId: user.uid,
        creatorName: user.displayName || "Creator",
        replyText: replyText,
        repliedAt: Timestamp.now(),
      };

      await updateDoc(commentDocRef, {
        replies: arrayUnion(newReply)
      });

      toast({ title: "Reply Added", description: "Your reply has been posted." });
    } catch (error: any) {
      console.error("Error adding reply:", error);
      toast({ title: "Reply Failed", description: error.message || "Could not post reply.", variant: "destructive" });
    }
  };

  const openDeleteConfirmationDialog = (type: 'comment' | 'reply', id: string, commentId?: string) => {
    if (type === 'comment') {
      setDeleteTarget({ type: 'comment', id });
    } else if (type === 'reply' && commentId) {
      setDeleteTarget({ type: 'reply', commentId, replyId: id });
    }
    setIsDeleteConfirmationOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !user) return;
    setIsDeletingCommentOrReply(true);
    try {
      if (deleteTarget.type === 'comment') {
        const commentDocRef = doc(db, "contractComments", deleteTarget.id);
        await deleteFirestoreDoc(commentDocRef);
        toast({ title: "Comment Deleted", description: "The brand's comment has been removed." });
      } else if (deleteTarget.type === 'reply') {
        const commentDocRef = doc(db, "contractComments", deleteTarget.commentId);
        const commentSnap = await getDoc(commentDocRef);
        if (commentSnap.exists()) {
            const commentData = commentSnap.data() as ContractComment;
            const replyToRemove = commentData.replies?.find(r => r.replyId === deleteTarget.replyId);
            if (replyToRemove) {
                await updateDoc(commentDocRef, {
                    replies: arrayRemove(replyToRemove)
                });
                toast({ title: "Reply Deleted", description: "Your reply has been removed." });
            } else {
                 toast({ title: "Reply Not Found", description: "Could not find the reply to delete.", variant: "destructive" });
            }
        }
      }
      setDeleteTarget(null);
      setIsDeleteConfirmationOpen(false);
    } catch (error: any) {
      console.error("Error deleting comment/reply:", error);
      toast({ title: "Deletion Failed", description: error.message || "Could not complete deletion.", variant: "destructive" });
    } finally {
      setIsDeletingCommentOrReply(false);
    }
  };
  
  const handleInitiateSignatureRequest = async () => {
    if (!contract || !user) {
      toast({ title: "Error", description: "Contract or user data missing.", variant: "destructive" });
      return;
    }
    if (!signerEmailOverride.trim()) {
      toast({ title: "Email Required", description: "Please enter the signer's email address.", variant: "destructive" });
      return;
    }
    if (!contract.fileUrl && !contract.contractText) {
      toast({ title: "File or Text Missing", description: "This contract does not have an uploaded file or text to send for signature.", variant: "destructive" });
      return;
    }

    setIsSendingForSignature(true);
    try {
      const idToken = await getUserIdToken();
      if (!idToken) {
        throw new Error("Authentication token is not available.");
      }
      
      const initiateRequestCallable = httpsCallableFromURL(
        firebaseAppFunctions, 
        INITIATE_HELLOSIGN_REQUEST_FUNCTION_URL
      );

      const result = await initiateRequestCallable({
        contractId: contract.id,
        signerEmailOverride: signerEmailOverride.trim(),
      });

      const data = result.data as { success: boolean; message: string; helloSignRequestId?: string };

      if (data.success) {
        toast({ title: "E-Signature Request Sent", description: data.message });
        setIsSignatureDialogOpen(false); 
      } else {
        throw new Error(data.message || "Failed to send e-signature request.");
      }
    } catch (error: any) {
      console.error("Error initiating Dropbox Sign request:", error);
      toast({
        title: "E-Signature Error",
        description: error.message || "Could not initiate e-signature request.",
        variant: "destructive",
      });
    } finally {
      setIsSendingForSignature(false);
    }
  };

  const getSignatureButtonText = () => {
    if (!contract?.signatureStatus || contract.signatureStatus === 'none') return "Send for E-Signature";
    if (contract.signatureStatus === 'sent') return "Signature Request Sent";
    if (contract.signatureStatus === 'signed') return "Document Signed";
    if (contract.signatureStatus === 'viewed_by_signer') return "Viewed by Signer";
    if (contract.signatureStatus === 'declined') return "Signature Declined - Resend?";
    if (contract.signatureStatus === 'canceled') return "Request Canceled - Resend?";
    if (contract.signatureStatus === 'error') return "Error Sending - Retry?";
    return "Manage E-Signature";
  };
  
  const canSendSignatureRequest = !contract?.signatureStatus || 
                                 contract.signatureStatus === 'none' || 
                                 contract.signatureStatus === 'error' || 
                                 contract.signatureStatus === 'declined' ||
                                 contract.signatureStatus === 'canceled';

  const handleUpdateProposalStatus = async (proposal: RedlineProposal, newStatus: 'accepted' | 'rejected') => {
    if (!contract || !user) return;
    setIsUpdatingProposal(proposal.id);

    try {
        const proposalRef = doc(db, "redlineProposals", proposal.id);
        const updates: Partial<RedlineProposal> = {
            status: newStatus,
            reviewedAt: Timestamp.now(),
        };

        if (newStatus === 'accepted') {
            const contractRef = doc(db, "contracts", contract.id);
            const currentText = contract.contractText || "";
            
            if (currentText.includes(proposal.originalText)) {
                const newText = currentText.replace(proposal.originalText, proposal.proposedText);
                await updateDoc(contractRef, { contractText: newText });

                const historyEntry = {
                    timestamp: Timestamp.now(),
                    action: "Redline Proposal Accepted",
                    details: `Change by ${proposal.proposerName}.`,
                };
                await updateDoc(contractRef, {
                    invoiceHistory: arrayUnion(historyEntry),
                    updatedAt: serverTimestamp(),
                });

                toast({ title: "Proposal Accepted", description: "The contract text has been updated." });
            } else {
                throw new Error("The original text to be replaced was not found in the current contract. The contract may have been updated since this proposal was made.");
            }
        }
        
        await updateDoc(proposalRef, updates);

        if (newStatus === 'rejected') {
            toast({ title: "Proposal Rejected", description: "The proposal has been marked as rejected." });
        }
    } catch (error: any) {
        console.error("Error updating proposal status:", error);
        toast({ title: "Update Failed", description: error.message || "Could not update proposal.", variant: "destructive" });
    } finally {
        setIsUpdatingProposal(null);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex-1 p-8 overflow-y-auto">
        <PageHeader title="Loading Contract..." description="Please wait while we fetch the details." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
                <Skeleton className="h-96 w-full" />
            </div>
            <div className="md:col-span-1 space-y-6">
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        </div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex-1 p-8 overflow-y-auto flex flex-col items-center justify-center h-full">
         <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Contract Not Found</h2>
        <p className="text-muted-foreground mb-6">The contract you are looking for does not exist or could not be loaded.</p>
        <Button asChild variant="outline">
          <Link href="/contracts">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Contracts
          </Link>
        </Button>
      </div>
    );
  }
  
  const formattedDueDate = contract.dueDate ? new Date(contract.dueDate + 'T00:00:00').toLocaleDateString() : 'N/A';
  
  const formattedCreatedAt = contract.createdAt instanceof Timestamp
    ? contract.createdAt.toDate().toLocaleDateString()
    : 'N/A';
  
  let effectiveDisplayStatus: Contract['status'] = contract.status || 'pending';
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const contractDueDate = contract.dueDate ? new Date(contract.dueDate + 'T00:00:00') : null;

  if (contract.invoiceStatus === 'paid') {
    effectiveDisplayStatus = 'paid';
  } else if (contract.invoiceStatus === 'overdue') {
    effectiveDisplayStatus = 'overdue';
  } else if ((contract.invoiceStatus === 'sent' || contract.invoiceStatus === 'viewed') && contractDueDate && contractDueDate < todayMidnight) {
    effectiveDisplayStatus = 'overdue';
  } else if (contract.invoiceStatus === 'sent' || contract.invoiceStatus === 'viewed') {
    effectiveDisplayStatus = 'invoiced';
  } else if (effectiveDisplayStatus === 'pending' && contractDueDate && contractDueDate < todayMidnight) { 
    effectiveDisplayStatus = 'overdue';
  }


  return (
    <>
      <div className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto">
        <PageHeader
          className="hide-on-print"
          title={(contract.brand || "Contract") + " - " + (contract.projectName || contract.fileName || "Details")}
          description={`ID: ${contract.id}`}
          actions={
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" asChild>
                <Link href="/contracts">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Link>
              </Button>
               <Button variant="outline" className="md:hidden" onClick={() => setIsSidebarVisible(!isSidebarVisible)}>
                <Menu className="h-4 w-4" />
                <span className="sr-only">Toggle Sidebar</span>
              </Button>
            </div>
          }
        />

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Main Content (Document) */}
          <div className="flex-1 min-w-0">
             <Card className="shadow-lg">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>{contract.brand} - {contract.projectName || 'Contract'}</CardTitle>
                        <CardDescription>Key information and full text of the agreement.</CardDescription>
                    </div>
                    <ContractStatusBadge status={effectiveDisplayStatus} />
                </CardHeader>
                <CardContent className="space-y-6">
                     {contract.summary && (
                        <div>
                            <h3 className="font-semibold text-lg mb-2">AI Generated Summary</h3>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap p-3 border rounded-md bg-muted/30">{contract.summary}</p>
                        </div>
                     )}

                     {contract.contractText && (
                        <div className="contract-text-card-for-print">
                            <h3 className="font-semibold text-lg mb-2 hide-on-print">Full Contract Text</h3>
                             <ScrollArea className="h-[500px] pr-3 border rounded-md p-3 bg-muted/30 hide-on-print">
                                <p className="text-sm text-foreground whitespace-pre-wrap">{contract.contractText}</p>
                            </ScrollArea>
                            {/* This is for printing only */}
                            <div className="hidden print:block">
                               <p className="text-xs text-foreground whitespace-pre-wrap contract-text-paragraph-for-print">{contract.contractText}</p>
                            </div>
                        </div>
                     )}
                     {!contract.contractText && (
                        <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-lg">
                          <p>No contract text available.</p>
                          <p className="text-sm">Edit the contract to paste the text for AI analysis.</p>
                        </div>
                     )}
                </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <aside className={`w-full lg:w-96 lg:flex-shrink-0 lg:block ${isSidebarVisible ? 'block' : 'hidden'} lg:sticky lg:top-8 h-fit`}>
            <div className="space-y-6">
              <Card className="shadow-lg hide-on-print">
                  <CardHeader><CardTitle className="text-lg">Actions</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2">
                      <Button variant="outline" asChild><Link href={`/contracts/${contract.id}/edit`}><Edit3 className="mr-2 h-4 w-4"/>Edit</Link></Button>
                      <Button variant="outline" asChild><Link href={`/contracts/${contract.id}/invoice`}><FileSpreadsheet className="mr-2 h-4 w-4"/>Invoice</Link></Button>
                      <ShareContractDialog contractId={contract.id} isOpen={isShareDialogOpen} onOpenChange={setIsShareDialogOpen} />
                      <Dialog open={isSignatureDialogOpen} onOpenChange={setIsSignatureDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" disabled={!canSendSignatureRequest && !isSendingForSignature}>
                            {getSignatureButtonText()}
                          </Button>
                        </DialogTrigger>
                         {canSendSignatureRequest && (
                           <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Send for E-Signature</DialogTitle>
                                <DialogDescription>
                                  Send this contract to the client for signature via Dropbox Sign. You will also be required to sign.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-2">
                                <div>
                                  <Label htmlFor="signer-email">Client's Email</Label>
                                  <Input 
                                    id="signer-email"
                                    type="email"
                                    value={signerEmailOverride}
                                    onChange={(e) => setSignerEmailOverride(e.target.value)}
                                    placeholder="client@example.com"
                                    disabled={isSendingForSignature}
                                  />
                                  <p className="text-xs text-muted-foreground mt-1">Defaults to client email on contract, if available.</p>
                                </div>
                              </div>
                              <DialogFooter>
                                <Button variant="outline" onClick={() => setIsSignatureDialogOpen(false)}>Cancel</Button>
                                <Button onClick={handleInitiateSignatureRequest} disabled={isSendingForSignature || !signerEmailOverride.trim()}>
                                  {isSendingForSignature ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SendIconComponent className="mr-2 h-4 w-4" />}
                                  Send Request
                                </Button>
                              </DialogFooter>
                           </DialogContent>
                         )}
                      </Dialog>
                  </CardContent>
              </Card>

              <Card className="shadow-lg hide-on-print">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5 text-blue-500" />Invoice History</CardTitle>
                    <CardDescription>A log of all invoice-related events.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                    : !contract.invoiceHistory || contract.invoiceHistory.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No invoice history yet.</p>
                    : <ScrollArea className="h-[200px] pr-3"><div className="space-y-3">
                        {contract.invoiceHistory.sort((a,b) => b.timestamp.toMillis() - a.timestamp.toMillis()).map((event, index) => (
                          <div key={index} className="flex items-start gap-3 text-xs">
                            <div className="font-mono text-muted-foreground whitespace-nowrap">{format(event.timestamp.toDate(), "MMM d, HH:mm")}</div>
                            <div className="flex-1">
                              <p className="font-medium text-foreground">{event.action}</p>
                              {event.details && <p className="text-muted-foreground">{event.details}</p>}
                            </div>
                          </div>
                        ))}
                      </div></ScrollArea>
                  }
                </CardContent>
              </Card>
              
              <Card className="shadow-lg hide-on-print">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><Info className="h-5 w-5 text-green-500" />Platform Fee Notice</CardTitle>
                </CardHeader>
                <CardContent>
                   <p className="text-xs text-muted-foreground">
                    Payments received through Verza are subject to a 1% platform fee and standard Stripe processing fees (typically 2.9% + 30¢). These fees are deducted from the total payment amount.
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-lg hide-on-print">
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg"><FilePenLine className="h-5 w-5 text-indigo-500" />Redline Proposals</CardTitle>
                      <CardDescription>Review brand-proposed changes.</CardDescription>
                  </CardHeader>
                  <CardContent>
                      {isLoadingProposals ? <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                      : redlineProposals.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No proposals submitted.</p>
                      : <ScrollArea className="h-[200px] pr-3"><div className="space-y-4">
                          {redlineProposals.map(proposal => (
                              <div key={proposal.id} className="p-3 border rounded-lg bg-muted/30 relative text-sm">
                                  <div className="flex justify-between items-start mb-2"><p className="font-semibold text-foreground">{proposal.proposerName}</p><Badge variant={proposal.status === 'proposed' ? 'secondary' : proposal.status === 'accepted' ? 'default' : 'destructive'} className={`capitalize text-xs ${proposal.status === 'accepted' ? 'bg-green-500' : ''}`}>{proposal.status}</Badge></div>
                                  {proposal.comment && <p className="italic text-muted-foreground mb-2">"{proposal.comment}"</p>}
                                  <div><p className="text-xs text-red-500">REPLACES:</p><p className="font-mono text-xs bg-red-50 dark:bg-red-900/20 p-1 rounded">"{proposal.originalText}"</p></div>
                                  <div className="mt-1"><p className="text-xs text-green-500">WITH:</p><p className="font-mono text-xs bg-green-50 dark:bg-green-900/20 p-1 rounded">"{proposal.proposedText}"</p></div>
                                  {proposal.status === 'proposed' && (
                                      <div className="flex gap-2 mt-3 justify-end">
                                          <Button size="sm" variant="destructive_outline" onClick={() => handleUpdateProposalStatus(proposal, 'rejected')} disabled={isUpdatingProposal === proposal.id}><X className="mr-1 h-4 w-4"/> Reject</Button>
                                          <Button size="sm" variant="default" onClick={() => handleUpdateProposalStatus(proposal, 'accepted')} disabled={isUpdatingProposal === proposal.id}><Check className="mr-1 h-4 w-4"/> Accept</Button>
                                      </div>
                                  )}
                              </div>
                          ))}
                      </div></ScrollArea>}
                  </CardContent>
              </Card>

              <Card className="shadow-lg hide-on-print">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><MessageCircle className="h-5 w-5 text-purple-500" />Contract Comments</CardTitle></CardHeader>
                  <CardContent>
                      {isLoadingComments ? <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                      : contractComments.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No comments received.</p>
                      : <ScrollArea className="h-[200px] pr-3"><div className="space-y-4">
                          {contractComments.map(comment => (
                            <div key={comment.id} className="p-3 border rounded-md bg-muted/30">
                              <div className="flex items-center justify-between mb-1"><p className="text-sm font-semibold flex items-center"><User className="h-4 w-4 mr-1.5"/>{comment.commenterName}</p><Button variant="ghost" size="icon" className="ml-2 h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => openDeleteConfirmationDialog('comment', comment.id)} disabled={isDeletingCommentOrReply}><Trash2 className="h-3 w-3"/></Button></div>
                              <p className="text-sm text-foreground/90 whitespace-pre-wrap ml-5">{comment.commentText}</p>
                              {comment.replies && comment.replies.length > 0 && (
                                <div className="mt-3 ml-8 pl-4 border-l border-primary/30 space-y-2">{comment.replies.map(reply => (
                                  <div key={reply.replyId} className="text-sm p-2 rounded-md bg-primary/5">
                                    <div className="flex items-center justify-between mb-0.5"><p className="font-semibold text-primary text-xs flex items-center"><CornerDownRight className="h-3 w-3 mr-1.5"/>{reply.creatorName}</p><Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:bg-destructive/10" onClick={() => openDeleteConfirmationDialog('reply', reply.replyId, comment.id)} disabled={isDeletingCommentOrReply}><Trash2 className="h-3 w-3"/></Button></div>
                                    <p className="text-foreground/80 whitespace-pre-wrap text-xs ml-5">{reply.replyText}</p>
                                  </div>
                                ))}</div>
                              )}
                              <ReplyForm commentId={comment.id} onSubmitReply={handleAddReply} />
                            </div>
                          ))}
                      </div></ScrollArea>}
                  </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-lg">Danger Zone</CardTitle></CardHeader>
                <CardContent>
                    <AlertDialog open={isContractDeleteDialogOpen} onOpenChange={setIsContractDeleteDialogOpen}>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isDeletingContract}>
                        {isDeletingContract ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash className="mr-2 h-4 w-4" />}
                        Delete Contract
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the contract
                            for "{contract.brand} - {contract.fileName || contract.id}" and remove its associated file from storage (if any).
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeletingContract}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteContract} disabled={isDeletingContract} className="bg-destructive hover:bg-destructive/90">
                            {isDeletingContract ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Yes, delete contract
                        </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      </div>

      <AlertDialog open={isDeleteConfirmationOpen} onOpenChange={setIsDeleteConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'comment' ? "This will permanently delete the brand's comment." : "This will permanently delete your reply."} This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)} disabled={isDeletingCommentOrReply}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeletingCommentOrReply} className="bg-destructive hover:bg-destructive/90">
              {isDeletingCommentOrReply ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

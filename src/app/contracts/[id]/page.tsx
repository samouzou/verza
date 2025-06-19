
"use client";

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, FormEvent } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit3, Trash2, FileText, DollarSign, CalendarDays, Briefcase, Info, CheckCircle, AlertTriangle, Loader2, Lightbulb, FileSpreadsheet, History, Printer, Share2, MessageCircle, Send as SendIconComponent, CornerDownRight, User, Mail } from 'lucide-react'; // Renamed Send icon
import Link from 'next/link';
import type { Contract, SharedContractVersion as SharedContractVersionType, ContractComment, CommentReply } from '@/types';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
      <Icon className="h-5 w-5 text-primary mt-1 flex-shrink-0" />
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

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'comment'; id: string } | { type: 'reply'; commentId: string; replyId: string } | null>(null);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [isDeletingCommentOrReply, setIsDeletingCommentOrReply] = useState(false);

  // E-Signature State
  const [isSendingForSignature, setIsSendingForSignature] = useState(false);
  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [signerEmailOverride, setSignerEmailOverride] = useState("");

  useEffect(() => {
    let unsubscribeSharedVersions: (() => void) | undefined;
    let unsubscribeComments: (() => void) | undefined;
    let unsubscribeContract: (() => void) | undefined;


    if (id && user && !authLoading) {
      setIsLoading(true);
      setIsLoadingSharedVersions(true);
      setIsLoadingComments(true);

      const contractDocRef = doc(db, 'contracts', id as string);
      unsubscribeContract = onSnapshot(contractDocRef, (contractSnap) => {
        if (contractSnap.exists() && contractSnap.data().userId === user.uid) {
          const data = contractSnap.data();
          
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

    } else if (!authLoading && !user) {
      router.push('/login');
    } else if (!id) {
        setIsLoading(false);
        setIsLoadingSharedVersions(false);
        setIsLoadingComments(false);
    }
     return () => {
      if (unsubscribeContract) unsubscribeContract();
      if (unsubscribeSharedVersions) unsubscribeSharedVersions();
      if (unsubscribeComments) unsubscribeComments();
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
    if (!contract.fileUrl) {
      toast({ title: "File Missing", description: "This contract does not have an uploaded file to send for signature.", variant: "destructive" });
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
        // Firestore listener should update the contract state.
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



  if (authLoading || isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loading Contract..." description="Please wait while we fetch the details." />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
          <div className="lg:col-span-1 space-y-6">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
             <Skeleton className="h-40 w-full rounded-lg" /> {/* Placeholder for e-signature card */}
          </div>
        </div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center h-full pt-10">
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
      <PageHeader
        className="hide-on-print"
        title={(contract.brand || "Contract") + " - " + (contract.projectName || contract.fileName || "Details")}
        description={`Details for contract ID: ${contract.id}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" asChild>
              <Link href="/contracts">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Link>
            </Button>
            <Button variant="secondary" asChild>
               <Link href={`/contracts/${contract.id}/invoice`}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Manage Invoice
              </Link>
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" /> Export to PDF
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/contracts/${contract.id}/edit`}>
                <Edit3 className="mr-2 h-4 w-4" /> Edit
              </Link>
            </Button>
            <AlertDialog open={isContractDeleteDialogOpen} onOpenChange={setIsContractDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeletingContract}>
                  {isDeletingContract ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash className="mr-2 h-4 w-4" />}
                  Delete
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
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6"> {/* Left Column */}
          <Card className="shadow-lg hide-on-print">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Key Information</span>
                <ContractStatusBadge status={effectiveDisplayStatus} /> 
              </CardTitle>
              <CardDescription>Core details of the agreement with {contract.brand}.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <DetailItem icon={Briefcase} label="Brand" value={contract.brand} />
              <DetailItem icon={DollarSign} label="Amount" value={`$${contract.amount.toLocaleString()}`} />
              <DetailItem icon={CalendarDays} label="Due Date" value={formattedDueDate} />
              <DetailItem icon={FileText} label="Contract Type" value={<span className="capitalize">{contract.contractType}</span>} />
              {contract.projectName && <DetailItem icon={Briefcase} label="Project Name" value={contract.projectName} />}
              <DetailItem icon={Info} label="File Name" value={contract.fileName || "N/A"} />
               <DetailItem icon={CalendarDays} label="Created At" value={formattedCreatedAt} />
               {contract.fileUrl && (
                <DetailItem 
                  icon={FileText} 
                  label="Contract File" 
                  value={
                    <a href={contract.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                      View/Download File
                    </a>
                  } 
                />
              )}
              {contract.invoiceNumber && (
                <DetailItem icon={FileSpreadsheet} label="Invoice Number" value={contract.invoiceNumber} />
              )}
              {contract.invoiceStatus && contract.invoiceStatus !== 'none' && (
                 <DetailItem 
                    icon={Info} 
                    label="Invoice Status" 
                    value={<Badge variant="outline" className="capitalize">{contract.invoiceStatus.replace('_', ' ')}</Badge>} 
                 />
              )}
            </CardContent>
          </Card>

          { (contract.clientName || contract.clientEmail || contract.clientAddress || contract.paymentInstructions) && (
             <Card className="shadow-lg hide-on-print">
                <CardHeader>
                    <CardTitle>Client &amp; Payment Info</CardTitle>
                    <CardDescription>Details for invoicing purposes.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    {contract.clientName && <p><strong className="text-foreground">Client Name:</strong> <span className="text-muted-foreground">{contract.clientName}</span></p>}
                    {contract.clientEmail && <p><strong className="text-foreground">Client Email:</strong> <span className="text-muted-foreground">{contract.clientEmail}</span></p>}
                    {contract.clientAddress && <p><strong className="text-foreground">Client Address:</strong> <span className="text-muted-foreground whitespace-pre-wrap">{contract.clientAddress}</span></p>}
                    {contract.paymentInstructions && <p><strong className="text-foreground">Payment Instructions:</strong> <span className="text-muted-foreground whitespace-pre-wrap">{contract.paymentInstructions}</span></p>}
                </CardContent>
             </Card>
          )}

          {contract.extractedTerms && Object.keys(contract.extractedTerms).length > 0 && (
            <Card className="shadow-lg hide-on-print">
              <CardHeader>
                <CardTitle>Extracted Terms</CardTitle>
                <CardDescription>Specific terms identified from the contract document by AI.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {contract.extractedTerms.deliverables && contract.extractedTerms.deliverables.length > 0 && (
                  <div>
                    <strong className="text-foreground">Deliverables:</strong>
                    <ul className="list-disc list-inside ml-4 text-muted-foreground">
                      {contract.extractedTerms.deliverables.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {contract.extractedTerms.paymentMethod && <p><strong className="text-foreground">Payment Method:</strong> <span className="text-muted-foreground">{contract.extractedTerms.paymentMethod}</span></p>}
                {contract.extractedTerms.usageRights && <p><strong className="text-foreground">Usage Rights:</strong> <span className="text-muted-foreground">{contract.extractedTerms.usageRights}</span></p>}
                {contract.extractedTerms.terminationClauses && <p><strong className="text-foreground">Termination:</strong> <span className="text-muted-foreground">{contract.extractedTerms.terminationClauses}</span></p>}
                {contract.extractedTerms.lateFeePenalty && <p><strong className="text-foreground">Late Fee/Penalty:</strong> <span className="text-muted-foreground">{contract.extractedTerms.lateFeePenalty}</span></p>}
                 {Object.keys(contract.extractedTerms).length === 0 && <p className="text-muted-foreground">No specific terms were extracted by AI.</p>}
              </CardContent>
            </Card>
          )}
          
          <Card className="shadow-lg hide-on-print flex flex-col max-h-[500px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-purple-500" />
                Contract Comments
              </CardTitle>
              <CardDescription>Feedback received on shared versions of this contract. You can reply here.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0">
              {isLoadingComments ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : contractComments.length === 0 ? (
                 <div className="flex items-center justify-center h-full py-10">
                    <p className="text-sm text-muted-foreground">No comments yet on any shared versions of this contract.</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px] pr-3">
                  <div className="space-y-4">
                    {contractComments.map(comment => (
                      <div key={comment.id} className="p-3 border rounded-md bg-muted/30">
                        <div className="flex items-center justify-between mb-1">
                           <div className="flex items-center">
                            <p className="text-sm font-semibold text-foreground flex items-center">
                                <User className="h-4 w-4 mr-1.5 text-muted-foreground" />
                                {comment.commenterName}
                            </p>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="ml-2 h-6 w-6 text-destructive hover:bg-destructive/10"
                                onClick={() => openDeleteConfirmationDialog('comment', comment.id)}
                                disabled={isDeletingCommentOrReply}
                            >
                                <Trash2 className="h-3 w-3" />
                            </Button>
                           </div>
                          <p className="text-xs text-muted-foreground">{formatCommentDateDisplay(comment.commentedAt)}</p>
                        </div>
                        {comment.commenterEmail && <p className="text-xs text-muted-foreground mb-1 ml-5">{comment.commenterEmail}</p>}
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap ml-5">{comment.commentText}</p>
                        
                        {comment.replies && comment.replies.length > 0 && (
                          <div className="mt-3 ml-8 pl-4 border-l border-primary/30 space-y-2">
                            {comment.replies.map(reply => (
                              <div key={reply.replyId} className="text-sm p-2 rounded-md bg-primary/5">
                                <div className="flex items-center justify-between mb-0.5">
                                  <p className="font-semibold text-primary text-xs flex items-center">
                                    <CornerDownRight className="h-3 w-3 mr-1.5 text-primary/80"/>
                                    {reply.creatorName} (Creator)
                                  </p>
                                   <div className="flex items-center">
                                      <p className="text-xs text-muted-foreground mr-1">{formatCommentDateDisplay(reply.repliedAt)}</p>
                                       {reply.creatorId === user?.uid && (
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-5 w-5 text-destructive hover:bg-destructive/10"
                                            onClick={() => openDeleteConfirmationDialog('reply', reply.replyId, comment.id)}
                                            disabled={isDeletingCommentOrReply}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    )}
                                   </div>
                                </div>
                                <p className="text-foreground/80 whitespace-pre-wrap text-xs ml-5">{reply.replyText}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <ReplyForm commentId={comment.id} onSubmitReply={handleAddReply} />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

        </div> {/* End Left Column */}

        <div className="lg:col-span-1 space-y-6"> {/* Right Column */}
           <Card className="shadow-lg hide-on-print">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5 text-green-500" />
                Share &amp; Feedback
              </CardTitle>
              <CardDescription>Share contract versions with brands for feedback.</CardDescription>
            </CardHeader>
            <CardContent>
              <ShareContractDialog 
                contractId={contract.id} 
                isOpen={isShareDialogOpen}
                onOpenChange={setIsShareDialogOpen}
              />
              {isLoadingSharedVersions ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto my-4" />
              ) : sharedVersions.length > 0 ? (
                <ScrollArea className="h-[150px] pr-3 mt-4">
                  <ul className="space-y-2">
                    {sharedVersions.map(version => (
                      <li key={version.id} className="text-sm p-2 border rounded-md">
                        <Link href={`/share/contract/${version.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                          Shared Link ({version.id.substring(0, 6)}...)
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          Shared on: {format(version.sharedAt.toDate(), "PPp")}
                        </p>
                        {version.notesForBrand && <p className="text-xs text-muted-foreground mt-1 italic">Notes: {version.notesForBrand}</p>}
                        <Badge variant={version.status === 'active' ? 'default' : 'outline'} className="mt-1 capitalize text-xs">
                          {version.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground mt-2 text-center">No shared versions yet. Click "Share for Feedback" to create one.</p>
              )}
            </CardContent>
          </Card>
          
          <Card className="shadow-lg hide-on-print">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-blue-600">
                        <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20ZM12 12.59L9.41 10L8 11.41L12 15.41L16 11.41L14.59 10L12 12.59Z"></path>
                    </svg>
                    E-Signature (Dropbox Sign)
                </CardTitle>
                <CardDescription>Manage electronic signature for this contract.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <p className="text-sm font-medium capitalize">{contract.signatureStatus?.replace('_', ' ') || 'Not Sent'}</p>
                </div>
                {contract.helloSignRequestId && (
                    <div>
                        <Label className="text-xs text-muted-foreground">Request ID</Label>
                        <p className="text-sm font-mono text-muted-foreground break-all">{contract.helloSignRequestId}</p>
                    </div>
                )}
                 {contract.lastSignatureEventAt && (
                    <div>
                        <Label className="text-xs text-muted-foreground">Last Event</Label>
                        <p className="text-sm">{format(contract.lastSignatureEventAt.toDate(), 'PPpp')}</p>
                    </div>
                )}
                {contract.signatureStatus === 'signed' && contract.signedDocumentUrl && (
                     <Button variant="outline" size="sm" asChild>
                        <a href={contract.signedDocumentUrl} target="_blank" rel="noopener noreferrer">
                            <CheckCircle className="mr-2 h-4 w-4 text-green-500"/> View Signed Document
                        </a>
                    </Button>
                )}
                {canSendSignatureRequest && contract.fileUrl && (
                    <Dialog open={isSignatureDialogOpen} onOpenChange={setIsSignatureDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="default" className="w-full">
                                <Mail className="mr-2 h-4 w-4" /> {getSignatureButtonText()}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Send Signature Request</DialogTitle>
                                <DialogDescription>
                                    Enter the email address of the person who needs to sign this contract.
                                    The contract file "{contract.fileName || 'Contract'}" will be sent.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                                <div>
                                    <Label htmlFor="signerEmail">Signer's Email Address</Label>
                                    <Input 
                                        id="signerEmail" 
                                        type="email"
                                        value={signerEmailOverride} 
                                        onChange={(e) => setSignerEmailOverride(e.target.value)} 
                                        placeholder="signer@example.com"
                                        className="mt-1"
                                        disabled={isSendingForSignature}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline" disabled={isSendingForSignature}>Cancel</Button>
                                </DialogClose>
                                <Button onClick={handleInitiateSignatureRequest} disabled={isSendingForSignature || !signerEmailOverride.trim()}>
                                    {isSendingForSignature ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <SendIconComponent className="mr-2 h-4 w-4"/>}
                                    Send Request
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                )}
                 {!contract.fileUrl && canSendSignatureRequest && (
                    <p className="text-sm text-destructive">
                        <AlertTriangle className="inline h-4 w-4 mr-1"/>A contract file must be uploaded before sending for e-signature. Please edit the contract to upload a file.
                    </p>
                )}
            </CardContent>
          </Card>


          {contract.invoiceHistory && contract.invoiceHistory.length > 0 && (
            <Card className="shadow-lg hide-on-print">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5 text-blue-500" />
                  Invoice History
                </CardTitle>
                <CardDescription>A log of actions related to this invoice.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[150px] pr-3">
                  <ul className="space-y-2">
                    {contract.invoiceHistory.slice().sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis()).map((entry, index) => (
                      <li key={index} className="text-sm">
                        <span className="font-medium text-foreground">
                          {format(entry.timestamp.toDate(), "PPpp")}
                        </span>
                        <span className="text-muted-foreground">: {entry.action}</span>
                        {entry.details && <span className="text-xs text-muted-foreground/80 block pl-2">- {entry.details}</span>}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
          
          <Card className="shadow-lg hide-on-print contract-text-card-for-print">
            <Accordion type="multiple" defaultValue={["ai-summary", "ai-negotiation-suggestions"]} className="w-full">
              {(contract.summary) && (
                <AccordionItem value="ai-summary" className="border-b">
                  <AccordionTrigger className="px-6 py-4 hover:no-underline [&[data-state=open]>svg]:text-primary">
                     <div className="flex flex-col space-y-1.5 text-left">
                        <CardTitle className="text-lg">AI Generated Summary</CardTitle>
                     </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                    <div className="px-6 pb-4">
                       <ScrollArea className="h-auto max-h-[200px] pr-3">
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {contract.summary}
                        </p>
                      </ScrollArea>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {contract.negotiationSuggestions && (
                 <AccordionItem value="ai-negotiation-suggestions" className="border-b">
                   <AccordionTrigger className="px-6 py-4 hover:no-underline [&[data-state=open]>svg]:text-primary">
                      <div className="flex flex-col space-y-1.5 text-left">
                        <CardTitle className="flex items-center text-lg gap-2">
                          <Lightbulb className="h-5 w-5 text-yellow-500" />
                          AI Negotiation Suggestions
                        </CardTitle>
                        <CardDescription>Advice for negotiating better terms.</CardDescription>
                      </div>
                   </AccordionTrigger>
                   <AccordionContent className="pt-0">
                    <div className="px-6 pb-4 space-y-4 text-sm">
                      {contract.negotiationSuggestions.paymentTerms && (
                        <div>
                          <h4 className="font-semibold text-foreground mb-1">Payment Terms:</h4>
                          <p className="text-muted-foreground whitespace-pre-wrap">{contract.negotiationSuggestions.paymentTerms}</p>
                        </div>
                      )}
                      {contract.negotiationSuggestions.exclusivity && (
                        <div>
                          <h4 className="font-semibold text-foreground mb-1">Exclusivity:</h4>
                          <p className="text-muted-foreground whitespace-pre-wrap">{contract.negotiationSuggestions.exclusivity}</p>
                        </div>
                      )}
                      {contract.negotiationSuggestions.ipRights && (
                        <div>
                          <h4 className="font-semibold text-foreground mb-1">Intellectual Property Rights:</h4>
                          <p className="text-muted-foreground whitespace-pre-wrap">{contract.negotiationSuggestions.ipRights}</p>
                        </div>
                      )}
                      {contract.negotiationSuggestions.generalSuggestions && contract.negotiationSuggestions.generalSuggestions.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-foreground mb-1">General Suggestions:</h4>
                          <ul className="list-disc list-inside ml-4 text-muted-foreground space-y-1">
                            {contract.negotiationSuggestions.generalSuggestions.map((item, i) => <li key={i} className="whitespace-pre-wrap">{item}</li>)}
                          </ul>
                        </div>
                      )}
                      {(!contract.negotiationSuggestions.paymentTerms && !contract.negotiationSuggestions.exclusivity && !contract.negotiationSuggestions.ipRights && (!contract.negotiationSuggestions.generalSuggestions || contract.negotiationSuggestions.generalSuggestions.length === 0)) && (
                         <p className="text-muted-foreground">No specific negotiation points provided by AI.</p>
                      )}
                    </div>
                   </AccordionContent>
                 </AccordionItem>
              )}
              
              {contract.contractText && (
                <AccordionItem value="full-contract-text" className="border-b-0">
                  <AccordionTrigger className="px-6 py-4 hover:no-underline [&[data-state=open]>svg]:text-primary">
                     <div className="flex flex-col space-y-1.5 text-left">
                        <CardTitle className="flex items-center text-lg">Full Contract Text</CardTitle>
                     </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-0">
                    <div className="px-6 pb-4">
                      <ScrollArea className="h-[200px] pr-3 contract-text-scrollarea-for-print">
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap contract-text-paragraph-for-print">
                          {contract.contractText}
                        </p>
                      </ScrollArea>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>
          </Card>
          
        </div> {/* End Right Column */}
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


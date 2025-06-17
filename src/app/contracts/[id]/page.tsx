
"use client";

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, FormEvent } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit3, Trash2, FileText, DollarSign, CalendarDays, Briefcase, Info, CheckCircle, AlertTriangle, Loader2, Lightbulb, FileSpreadsheet, History, Printer, Share2, MessageCircle, Send as SendIcon, CornerDownRight, User } from 'lucide-react';
import Link from 'next/link';
import type { Contract, SharedContractVersion as SharedContractVersionType, ContractComment, CommentReply } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ContractStatusBadge } from '@/components/contracts/contract-status-badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, Timestamp, deleteDoc, serverTimestamp, arrayUnion, collection, query, where, onSnapshot, orderBy, updateDoc } from '@/lib/firebase';
import { storage } from '@/lib/firebase';
import { ref as storageFileRef, deleteObject } from 'firebase/storage';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ShareContractDialog } from '@/components/contracts/share-contract-dialog';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

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
        {isSubmittingReply ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <SendIcon className="mr-1 h-3 w-3" />}
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
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [sharedVersions, setSharedVersions] = useState<SharedContractVersionType[]>([]);
  const [isLoadingSharedVersions, setIsLoadingSharedVersions] = useState(true);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [contractComments, setContractComments] = useState<ContractComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(true);


  useEffect(() => {
    let unsubscribeSharedVersions: (() => void) | undefined;
    let unsubscribeComments: (() => void) | undefined;

    if (id && user && !authLoading) {
      setIsLoading(true);
      setIsLoadingSharedVersions(true);
      setIsLoadingComments(true);

      const fetchContract = async () => {
        try {
          const contractDocRef = doc(db, 'contracts', id as string);
          const contractSnap = await getDoc(contractDocRef);
          if (contractSnap.exists() && contractSnap.data().userId === user.uid) {
            const data = contractSnap.data();
            
            let createdAt = data.createdAt;
            if (createdAt && !(createdAt instanceof Timestamp)) {
              if (typeof createdAt === 'string') {
                createdAt = Timestamp.fromDate(new Date(createdAt));
              } else if (createdAt.seconds && typeof createdAt.seconds === 'number' && createdAt.nanoseconds && typeof createdAt.nanoseconds === 'number') {
                createdAt = new Timestamp(createdAt.seconds, createdAt.nanoseconds);
              } else {
                console.warn("Unsupported createdAt format, using current date as fallback:", createdAt);
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
                console.warn("Unsupported updatedAt format, using current date as fallback:", updatedAt);
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
            } as Contract);
          } else {
            setContract(null);
            toast({ title: "Error", description: "Contract not found or you don't have permission to view it.", variant: "destructive" });
            router.push('/contracts');
          }
        } catch (error) {
          console.error("Error fetching contract:", error);
          setContract(null);
          toast({ title: "Fetch Error", description: "Could not load contract details.", variant: "destructive" });
        } finally {
          setIsLoading(false);
        }
      };
      fetchContract();

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
      if (unsubscribeSharedVersions) unsubscribeSharedVersions();
      if (unsubscribeComments) unsubscribeComments();
    };
  }, [id, user, authLoading, router, toast]);

  const handleDeleteContract = async () => {
    if (!contract) return;
    setIsDeleting(true);
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
      await deleteDoc(contractDocRef);

      toast({ title: "Contract Deleted", description: `${contract.brand} contract has been successfully deleted.` });
      router.push('/contracts');
    } catch (error) {
      console.error("Error deleting contract:", error);
      toast({ title: "Deletion Failed", description: "Could not delete the contract. Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
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
  
  const hasNegotiationSuggestions = contract.negotiationSuggestions && 
                                   (contract.negotiationSuggestions.paymentTerms ||
                                    contract.negotiationSuggestions.exclusivity ||
                                    contract.negotiationSuggestions.ipRights ||
                                    (contract.negotiationSuggestions.generalSuggestions && contract.negotiationSuggestions.generalSuggestions.length > 0));

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
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
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
                  <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteContract} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
                    <CardTitle>Client & Payment Info</CardTitle>
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
          
          <Card className="shadow-lg hide-on-print">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-purple-500" />
                Contract Comments
              </CardTitle>
              <CardDescription>Feedback received on shared versions of this contract. You can reply here.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingComments ? (
                <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : contractComments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No comments yet on any shared versions of this contract.</p>
              ) : (
                <ScrollArea className="h-auto max-h-[400px] pr-3">
                  <div className="space-y-4">
                    {contractComments.map(comment => (
                      <div key={comment.id} className="p-3 border rounded-md bg-muted/30">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-foreground flex items-center">
                            <User className="h-4 w-4 mr-1.5 text-muted-foreground" />
                            {comment.commenterName}
                          </p>
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
                                  <p className="text-xs text-muted-foreground">{formatCommentDateDisplay(reply.repliedAt)}</p>
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
                Share & Feedback
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
          
          {/* Unified Accordion Card for AI content and Full Text */}
          <Card className="shadow-lg hide-on-print contract-text-card-for-print">
            <Accordion type="multiple" defaultValue={["ai-summary", "ai-negotiation-suggestions"]} className="w-full">
              {contract.summary && (
                <AccordionItem value="ai-summary">
                  <AccordionTrigger className="px-6 py-4 hover:no-underline [&[data-state=open]>svg]:text-primary">
                    <div className="flex flex-col space-y-1.5 text-left">
                      <h3 className="text-lg font-semibold leading-none tracking-tight">AI Generated Summary</h3>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
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

              {hasNegotiationSuggestions && contract.negotiationSuggestions && (
                <AccordionItem value="ai-negotiation-suggestions">
                   <AccordionTrigger className="px-6 py-4 hover:no-underline [&[data-state=open]>svg]:text-primary">
                      <div className="flex flex-col space-y-1.5 text-left">
                        <h3 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
                          <Lightbulb className="h-5 w-5 text-yellow-500" />
                          AI Negotiation Suggestions
                        </h3>
                        <p className="text-sm text-muted-foreground">Advice for negotiating better terms.</p>
                      </div>
                   </AccordionTrigger>
                   <AccordionContent>
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
                    </div>
                   </AccordionContent>
                 </AccordionItem>
              )}
              
              {contract.contractText && (
                <AccordionItem value="full-contract-text" className="border-b-0"> {/* Remove bottom border for the last item in the card */}
                  <AccordionTrigger className="px-6 py-4 hover:no-underline [&[data-state=open]>svg]:text-primary">
                    <div className="flex flex-col space-y-1.5 text-left">
                      <h3 className="text-lg font-semibold leading-none tracking-tight">Full Contract Text</h3>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
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
    </>
  );
}


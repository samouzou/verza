
"use client";

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit3, Trash2, FileText, DollarSign, CalendarDays, Briefcase, Info, CheckCircle, AlertTriangle, Loader2, Lightbulb, FileSpreadsheet, History } from 'lucide-react';
import Link from 'next/link';
import type { Contract } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ContractStatusBadge } from '@/components/contracts/contract-status-badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, Timestamp, deleteDoc, serverTimestamp, arrayUnion } from '@/lib/firebase';
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
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

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

  useEffect(() => {
    if (id && user && !authLoading) {
      setIsLoading(true);
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
    } else if (!authLoading && !user) {
      router.push('/login');
    } else if (!id) {
        setIsLoading(false);
    }
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
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-lg">
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
             <Card className="shadow-lg">
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
            <Card className="shadow-lg">
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

          {hasNegotiationSuggestions && contract.negotiationSuggestions && (
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  AI Negotiation Suggestions
                </CardTitle>
                <CardDescription>Advice for negotiating better terms.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {contract.negotiationSuggestions.paymentTerms && <p><strong className="text-foreground">Payment Terms:</strong> <span className="text-muted-foreground">{contract.negotiationSuggestions.paymentTerms}</span></p>}
                {contract.negotiationSuggestions.exclusivity && <p><strong className="text-foreground">Exclusivity:</strong> <span className="text-muted-foreground">{contract.negotiationSuggestions.exclusivity}</span></p>}
                {contract.negotiationSuggestions.ipRights && <p><strong className="text-foreground">IP Rights:</strong> <span className="text-muted-foreground">{contract.negotiationSuggestions.ipRights}</span></p>}
                {contract.negotiationSuggestions.generalSuggestions && contract.negotiationSuggestions.generalSuggestions.length > 0 && (
                  <div>
                    <strong className="text-foreground">General Suggestions:</strong>
                    <ul className="list-disc list-inside ml-4 text-muted-foreground">
                      {contract.negotiationSuggestions.generalSuggestions.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {!hasNegotiationSuggestions && <p className="text-muted-foreground">No negotiation suggestions available for this contract.</p>}
              </CardContent>
            </Card>
          )}
          
          {contract.invoiceHistory && contract.invoiceHistory.length > 0 && (
            <Card className="shadow-lg">
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

        </div>

        <div className="lg:col-span-1 space-y-6">
           <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>AI Generated Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px] pr-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {contract.summary || 'No AI summary available for this contract.'}
                </p>
              </ScrollArea>
            </CardContent>
          </Card>

          {contract.contractText && (
             <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Full Contract Text (Excerpt)</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px] pr-3">
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {contract.contractText.substring(0,1000)}
                    {contract.contractText.length > 1000 && "..."}
                  </p>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
    

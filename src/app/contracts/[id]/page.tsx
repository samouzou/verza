
"use client";

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, FormEvent, useRef } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit3, Trash2, FileText, DollarSign, CalendarDays, Briefcase, Info, CheckCircle, AlertTriangle, Loader2, Lightbulb, FileSpreadsheet, History, Printer, Share2, MessageCircle, Send as SendIconComponent, CornerDownRight, User, Mail, Trash, FilePenLine, Check, X, Menu, Eye, Wand2, Save, UploadCloud } from 'lucide-react'; // Renamed Send icon
import Link from 'next/link';
import type { Contract, SharedContractVersion as SharedContractVersionType, ContractComment, CommentReply, RedlineProposal, EmailLog, PaymentMilestone } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { ContractStatusBadge } from '@/components/contracts/contract-status-badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, Timestamp, deleteDoc as deleteFirestoreDoc, serverTimestamp, arrayUnion, collection, query, where, onSnapshot, orderBy, updateDoc, arrayRemove, storage, ref as storageFileRef, deleteObject, uploadBytes, getDownloadURL } from '@/lib/firebase';
import { Skeleton } from "@/components/ui/skeleton";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ShareContractDialog } from '@/components/contracts/share-contract-dialog';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { DocumentEditorContainerComponent, Toolbar, Ribbon } from '@syncfusion/ej2-react-documenteditor';
import { registerLicense } from '@syncfusion/ej2-base';
import { useSidebar } from '@/components/ui/sidebar';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { v4 as uuidv4 } from 'uuid';


if (process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY) {
  registerLicense(process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY);
}


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

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [isDeletingContract, setIsDeletingContract] = useState(false);
  const [isContractDeleteDialogOpen, setIsContractDeleteDialogOpen] = useState(false);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [isLoadingEmailLogs, setIsLoadingEmailLogs] = useState(true);
  const [selectedEmailLog, setSelectedEmailLog] = useState<EmailLog | null>(null);

  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const editorRef = useRef<DocumentEditorContainerComponent | null>(null);
  const { setOpen } = useSidebar();
  
  // State for editable sidebar fields
  const [isSavingSidebar, setIsSavingSidebar] = useState(false);
  const [brand, setBrand] = useState('');
  const [projectName, setProjectName] = useState('');
  // Amount is now managed via milestones
  const [milestones, setMilestones] = useState<Omit<PaymentMilestone, 'status'>[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientTin, setClientTin] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [contractType, setContractType] = useState<Contract['contractType']>('other');
  const [newSelectedFile, setNewSelectedFile] = useState<File | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<Contract['recurrenceInterval']>();


  useEffect(() => {
    // Collapse sidebar by default on this page
    setOpen(false);
  }, [setOpen]);
  
  const populateSidebarForms = (contractData: Contract) => {
    setBrand(contractData.brand || '');
    setProjectName(contractData.projectName || '');
    setMilestones(contractData.milestones?.map(({ status, ...rest }) => rest) || [{ id: uuidv4(), description: 'Initial payment', amount: contractData.amount || 0, dueDate: contractData.dueDate || '' }]);
    setDueDate(contractData.dueDate || '');
    setContractType(contractData.contractType || 'other');
    setClientName(contractData.clientName || '');
    setClientEmail(contractData.clientEmail || '');
    setClientAddress(contractData.clientAddress || '');
    setClientTin(contractData.clientTin || '');
    setPaymentInstructions(contractData.paymentInstructions || '');
    setCurrentFileName(contractData.fileName || null);
    setIsRecurring(contractData.isRecurring || false);
    setRecurrenceInterval(contractData.recurrenceInterval);
    setNewSelectedFile(null); // Reset file selection on new data
  };

  useEffect(() => {
    let unsubscribeContract: (() => void) | undefined;
    let unsubscribeEmailLogs: (() => void) | undefined;


    if (id && user && !authLoading) {
      setIsLoading(true);
      setIsLoadingEmailLogs(true);

      const contractDocRef = doc(db, 'contracts', id as string);
      unsubscribeContract = onSnapshot(contractDocRef, (contractSnap) => {
        const agencyId = user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId;
        const data = contractSnap.data();

        if (contractSnap.exists() && data && (data.userId === user.uid || (data.ownerType === 'agency' && data.ownerId === agencyId))) {
          const processedData = {
            ...data,
            id: contractSnap.id,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : Timestamp.now(),
            lastReminderSentAt: data.lastReminderSentAt instanceof Timestamp ? data.lastReminderSentAt : null,
            invoiceStatus: data.invoiceStatus || 'none',
            invoiceHistory: data.invoiceHistory?.map((entry: any) => ({
              ...entry,
              timestamp: entry.timestamp instanceof Timestamp ? entry.timestamp : Timestamp.fromDate(new Date(entry.timestamp.seconds * 1000))
            })) || [],
            signatureStatus: data.signatureStatus || 'none',
            lastSignatureEventAt: data.lastSignatureEventAt instanceof Timestamp ? data.lastSignatureEventAt : null,
            milestones: data.milestones || [{ id: uuidv4(), description: 'Total Amount', amount: data.amount, dueDate: data.dueDate, status: 'pending' }],
          } as Contract;
          
          setContract(processedData);
          populateSidebarForms(processedData);

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

      const emailLogsQuery = query(
        collection(db, "emailLogs"),
        where("contractId", "==", id),
        orderBy("timestamp", "desc")
      );
      unsubscribeEmailLogs = onSnapshot(emailLogsQuery, (snapshot) => {
        const logs = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as EmailLog));
        setEmailLogs(logs);
        setIsLoadingEmailLogs(false);
      }, (error) => {
        console.error("Error fetching email logs:", error);
        toast({ title: "History Error", description: "Could not load email history.", variant: "destructive" });
        setIsLoadingEmailLogs(false);
      });


    } else if (!authLoading && !user) {
      router.push('/login');
    } else if (!id) {
        setIsLoading(false);
        setIsLoadingEmailLogs(false);
    }
     return () => {
      if (unsubscribeContract) unsubscribeContract();
      if (unsubscribeEmailLogs) unsubscribeEmailLogs();
    };
  }, [id, user, authLoading, router, toast]);
  
  const onEditorCreated = () => {
    if (editorRef.current && contract?.contractText) {
      try {
        editorRef.current.documentEditor.open(contract.contractText);
      } catch (e) {
        console.error("Failed to load SFDT content in viewer:", e);
      }
    }
  };

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
  
  const handleSaveSidebarChanges = async (event?: MouseEvent) => {
    event?.preventDefault(); 
    if (!contract || !user) {
      toast({ title: "Error", description: "Contract or user data missing.", variant: "destructive" });
      return false;
    }
    setIsSavingSidebar(true);
    
    const totalAmount = milestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    const finalDueDate = milestones.reduce((latest, m) => m.dueDate > latest ? m.dueDate : latest, "1970-01-01");

    if (totalAmount <= 0) {
        toast({ title: "Invalid Amount", description: "Total amount from milestones must be greater than zero.", variant: "destructive" });
        setIsSavingSidebar(false);
        return false;
    }

    try {
      const contractDocRef = doc(db, 'contracts', id);
      let newFileUrl: string | null = contract.fileUrl;
      let newFileNameToSave: string | null = contract.fileName;

      if (newSelectedFile) {
        if (contract.fileUrl) {
          try {
            const oldFileStorageRef = storageFileRef(storage, contract.fileUrl);
            await deleteObject(oldFileStorageRef);
          } catch (deleteError: any) {
            console.warn("Could not delete old file from storage:", deleteError.message);
          }
        }
        const fileStorageRef = storageFileRef(storage, `contracts/${user.uid}/${Date.now()}_${newSelectedFile.name}`);
        const uploadResult = await uploadBytes(fileStorageRef, newSelectedFile);
        newFileUrl = await getDownloadURL(uploadResult.ref);
        newFileNameToSave = newSelectedFile.name;
      }
      
      const updates: Partial<Contract> & { [key: string]: any } = {
        brand: brand.trim(),
        projectName: projectName.trim() || null,
        amount: totalAmount,
        dueDate: finalDueDate,
        milestones: milestones.map(m => ({ ...m, status: contract.milestones?.find(cm => cm.id === m.id)?.status || 'pending' })),
        contractType: contractType,
        clientName: clientName.trim() || null,
        clientEmail: clientEmail.trim() || null,
        clientAddress: clientAddress.trim() || null,
        clientTin: clientTin.trim() || null,
        paymentInstructions: paymentInstructions.trim() || null,
        fileUrl: newFileUrl,
        fileName: newFileNameToSave,
        updatedAt: Timestamp.now(),
        isRecurring: isRecurring,
        recurrenceInterval: isRecurring ? recurrenceInterval : undefined,
      };

      await updateDoc(contractDocRef, updates);
      toast({ title: "Contract Details Updated", description: "Changes saved successfully." });
      setNewSelectedFile(null); // Clear file input after save
      return true;
    } catch (error) {
      console.error("Error updating contract:", error);
      toast({ title: "Update Failed", description: "Could not save changes.", variant: "destructive" });
      return false;
    } finally {
      setIsSavingSidebar(false);
    }
  };

  const handleMilestoneChange = (id: string, field: keyof Omit<PaymentMilestone, 'id' | 'status'>, value: string | number) => {
    setMilestones(currentMilestones => 
      currentMilestones.map(m => m.id === id ? { ...m, [field]: value } : m)
    );
  };

  const addMilestone = () => {
    setMilestones([...milestones, { id: uuidv4(), description: "", amount: 0, dueDate: "" }]);
  };

  const removeMilestone = (id: string) => {
    if (milestones.length > 1) {
      setMilestones(milestones.filter(m => m.id !== id));
    } else {
      toast({ title: "Cannot Remove", description: "You must have at least one payment milestone." });
    }
  };

  const handlePrint = () => {
    window.print();
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
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Key Information</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border rounded-md bg-muted/30">
                            <DetailItem icon={Briefcase} label="Brand" value={contract.brand} />
                            <DetailItem icon={FileText} label="Project" value={contract.projectName} />
                            <DetailItem icon={DollarSign} label="Total Amount" value={`$${contract.amount.toLocaleString()}`} />
                            <DetailItem icon={CalendarDays} label="Final Due Date" value={formattedDueDate} />
                        </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-semibold text-lg">Payment Milestones</h3>
                      <div className="space-y-2">
                        {contract.milestones && contract.milestones.map((milestone) => (
                           <Card key={milestone.id} className="p-3">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                              <div className="flex-1 mb-2 sm:mb-0">
                                <p className="font-medium">{milestone.description}</p>
                                <p className="text-sm text-muted-foreground">Due: {milestone.dueDate ? new Date(milestone.dueDate + 'T00:00:00').toLocaleDateString() : 'N/A'}</p>
                              </div>
                              <div className="flex items-center gap-4 w-full sm:w-auto">
                                <Badge variant="secondary" className="text-base">${milestone.amount.toLocaleString()}</Badge>
                                <Badge variant={milestone.status === 'paid' ? 'default' : 'outline'} className={`capitalize ${milestone.status === 'paid' ? 'bg-green-500' : ''}`}>{milestone.status}</Badge>
                                <Button size="sm" asChild disabled={milestone.status !== 'pending'}>
                                  <Link href={`/contracts/${contract.id}/invoice?milestoneId=${milestone.id}`}>
                                    Generate Invoice
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>

                     {contract.extractedTerms && (Object.values(contract.extractedTerms).some(v => v)) && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">AI Extracted Terms</h3>
                            <div className="p-4 border rounded-md bg-muted/30 text-sm space-y-3">
                                {contract.extractedTerms.paymentMethod && <p><strong className="font-medium text-foreground">Payment Method:</strong> <span className="text-muted-foreground">{contract.extractedTerms.paymentMethod}</span></p>}
                                {contract.extractedTerms.deliverables && contract.extractedTerms.deliverables.length > 0 && <p><strong className="font-medium text-foreground">Deliverables:</strong> <span className="text-muted-foreground">{contract.extractedTerms.deliverables.join(', ')}</span></p>}
                                {contract.extractedTerms.usageRights && <p><strong className="font-medium text-foreground">Usage Rights:</strong> <span className="text-muted-foreground">{contract.extractedTerms.usageRights}</span></p>}
                                {contract.extractedTerms.terminationClauses && <p><strong className="font-medium text-foreground">Termination:</strong> <span className="text-muted-foreground">{contract.extractedTerms.terminationClauses}</span></p>}
                                {contract.extractedTerms.lateFeePenalty && <p><strong className="font-medium text-foreground">Late Fee/Penalty:</strong> <span className="text-muted-foreground">{contract.extractedTerms.lateFeePenalty}</span></p>}
                            </div>
                        </div>
                     )}
                     {contract.summary && (
                        <div>
                            <h3 className="font-semibold text-lg mb-2">AI Generated Summary</h3>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap p-3 border rounded-md bg-muted/30">{contract.summary}</p>
                        </div>
                     )}

                     {contract.contractText ? (
                        <div className="contract-text-card-for-print">
                            <h3 className="font-semibold text-lg mb-2 hide-on-print">Full Contract Text</h3>
                            <div className="h-[800px] border rounded-md overflow-hidden hide-on-print">
                              <DocumentEditorContainerComponent 
                                id="contract-viewer" 
                                ref={editorRef}
                                created={onEditorCreated}
                                style={{ display: 'block' }} 
                                height="100%" 
                                enableToolbar={false}
                                readOnly={true}
                                showPropertiesPane={false}
                              />
                            </div>
                            <div className="hidden print:block">
                               <p className="text-xs text-foreground whitespace-pre-wrap contract-text-paragraph-for-print">{contract.summary || 'Summary not available.'}</p>
                            </div>
                        </div>
                     ) : (
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
                  <CardContent className="flex flex-col gap-2">
                       <Button variant="outline" asChild><Link href={`/contracts/${contract.id}/edit`}><Wand2 className="mr-2 h-4 w-4"/>Contract Co-Pilot</Link></Button>
                  </CardContent>
              </Card>

              <Card className="shadow-lg hide-on-print">
                <CardHeader>
                  <CardTitle>Editable Details</CardTitle>
                  <CardDescription>Quickly edit metadata for this contract.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Accordion type="multiple" className="w-full space-y-6">
                    <AccordionItem value="core-details" className="border-b-0">
                      <Card>
                        <AccordionTrigger className="p-0 hover:no-underline [&>svg]:mx-6">
                          <CardHeader className="flex-1 text-left"><CardTitle className="text-base">Core Details</CardTitle></CardHeader>
                        </AccordionTrigger>
                        <AccordionContent>
                          <CardContent className="pt-0 space-y-4">
                            <div><Label htmlFor="brand">Brand Name</Label><Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} required className="mt-1" /></div>
                            <div><Label htmlFor="projectName">Project Name (Optional)</Label><Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="mt-1" /></div>
                            
                             <div className="space-y-2 rounded-md border p-4">
                                <Label>Payment Milestones</Label>
                                {milestones.map((milestone, index) => (
                                  <div key={milestone.id} className="grid grid-cols-12 gap-2 items-end pt-2 border-t first:border-t-0 first:pt-0">
                                      <div className="col-span-12"><Label htmlFor={`milestone-desc-${index}`} className="text-xs">Description</Label><Input id={`milestone-desc-${index}`} value={milestone.description} onChange={(e) => handleMilestoneChange(milestone.id, 'description', e.target.value)} placeholder="e.g., 50% Upfront" className="mt-1 h-8"/></div>
                                      <div className="col-span-6"><Label htmlFor={`milestone-amount-${index}`} className="text-xs">Amount</Label><Input id={`milestone-amount-${index}`} type="number" value={milestone.amount} onChange={(e) => handleMilestoneChange(milestone.id, 'amount', Number(e.target.value))} placeholder="5000" className="mt-1 h-8"/></div>
                                      <div className="col-span-6"><Label htmlFor={`milestone-due-${index}`} className="text-xs">Due Date</Label><Input id={`milestone-due-${index}`} type="date" value={milestone.dueDate} onChange={(e) => handleMilestoneChange(milestone.id, 'dueDate', e.target.value)} className="mt-1 h-8"/></div>
                                      {milestones.length > 1 && <div className="col-span-12 flex justify-end"><Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeMilestone(milestone.id)}><Trash2 className="h-4 w-4"/></Button></div>}
                                  </div>
                                ))}
                                <Button type="button" variant="outline" size="sm" onClick={addMilestone}><PlusCircle className="mr-2 h-4 w-4"/>Add Milestone</Button>
                                <div className="text-right font-semibold text-sm pt-2 border-t">Total: ${milestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0).toLocaleString()}</div>
                             </div>

                            <div><Label htmlFor="contractType">Contract Type</Label><Select value={contractType} onValueChange={(value) => setContractType(value as Contract['contractType'])}><SelectTrigger className="w-full mt-1"><SelectValue placeholder="Select contract type" /></SelectTrigger><SelectContent><SelectItem value="sponsorship">Sponsorship</SelectItem><SelectItem value="consulting">Consulting</SelectItem><SelectItem value="affiliate">Affiliate</SelectItem><SelectItem value="retainer">Retainer</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>
                    <AccordionItem value="client-file" className="border-b-0">
                      <Card>
                        <AccordionTrigger className="p-0 hover:no-underline [&>svg]:mx-6">
                           <CardHeader className="flex-1 text-left"><CardTitle className="text-base">Client &amp; File</CardTitle></CardHeader>
                        </AccordionTrigger>
                        <AccordionContent>
                          <CardContent className="pt-0 space-y-4">
                              <div><Label htmlFor="clientName">Client Name</Label><Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} className="mt-1" /></div>
                              <div><Label htmlFor="clientEmail">Client Email</Label><Input id="clientEmail" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="mt-1" /></div>
                              <div><Label htmlFor="clientTin">Client Tax ID (EIN/SSN)</Label><Input id="clientTin" value={clientTin} onChange={(e) => setClientTin(e.target.value)} className="mt-1" /></div>
                              <div><Label htmlFor="clientAddress">Client Address</Label><Textarea id="clientAddress" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className="mt-1" rows={2} /></div>
                              <div><Label htmlFor="paymentInstructions">Payment Instructions</Label><Textarea id="paymentInstructions" value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} className="mt-1" rows={2} placeholder="e.g. Bank Details, PayPal email"/></div>
                              <div><Label htmlFor="newContractFile">Replace Contract File (Optional)</Label>{currentFileName && !newSelectedFile && <div className="text-xs text-muted-foreground flex items-center mt-1"><FileText className="mr-1 h-3 w-3" /> {currentFileName}</div>}{newSelectedFile && <div className="text-xs text-green-600 flex items-center mt-1"><UploadCloud className="mr-1 h-3 w-3" /> {newSelectedFile.name}</div>}<Input id="newContractFile" type="file" className="mt-1" onChange={(e) => setNewSelectedFile(e.target.files ? e.target.files[0] : null)} /></div>
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>
                    <AccordionItem value="recurrence" className="border-b-0">
                      <Card>
                        <AccordionTrigger className="p-0 hover:no-underline [&>svg]:mx-6">
                          <CardHeader className="flex-1 text-left"><CardTitle className="text-base">Contract Recurrence</CardTitle></CardHeader>
                        </AccordionTrigger>
                        <AccordionContent>
                          <CardContent className="pt-0 space-y-4">
                             <div className="flex items-center space-x-2">
                              <Checkbox
                                id="isRecurring"
                                checked={isRecurring}
                                onCheckedChange={(checked) => setIsRecurring(checked as boolean)}
                              />
                              <Label htmlFor="isRecurring" className="font-normal">
                                Is this a recurring contract?
                              </Label>
                            </div>
                            {isRecurring && (
                              <div>
                                <Label htmlFor="recurrenceInterval">Recurrence Interval</Label>
                                <Select
                                  value={recurrenceInterval}
                                  onValueChange={(value) => setRecurrenceInterval(value as Contract['recurrenceInterval'])}
                                >
                                  <SelectTrigger id="recurrenceInterval" className="mt-1">
                                    <SelectValue placeholder="Select interval" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="monthly">Monthly</SelectItem>
                                    <SelectItem value="quarterly">Quarterly</SelectItem>
                                    <SelectItem value="annually">Annually</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
                 <CardFooter>
                    <Button onClick={(e) => handleSaveSidebarChanges(e as any)} disabled={isSavingSidebar} className="w-full">
                      {isSavingSidebar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save Details
                    </Button>
                  </CardFooter>
              </Card>

              <Card className="shadow-lg hide-on-print">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5 text-blue-500" />Invoice History</CardTitle>
                    <CardDescription>A log of all invoice-related events.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Sheet>
                    {isLoadingEmailLogs ? <div className="flex items-center justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                      : !contract.invoiceHistory || contract.invoiceHistory.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No invoice history yet.</p>
                      : <ScrollArea className="h-[200px] pr-3"><div className="space-y-3">
                          {contract.invoiceHistory.sort((a,b) => b.timestamp.toMillis() - a.timestamp.toMillis()).map((event, index) => (
                            <div key={index} className="flex items-start gap-3 text-xs">
                              <div className="font-mono text-muted-foreground whitespace-nowrap">{format(event.timestamp.toDate(), "MMM d, HH:mm")}</div>
                              <div className="flex-1">
                                {event.emailLogId ? (
                                  <SheetTrigger asChild>
                                    <button
                                      className="text-left font-medium text-primary hover:underline"
                                      onClick={() => setSelectedEmailLog(emailLogs.find(log => log.id === event.emailLogId) || null)}
                                    >
                                      {event.action} <Eye className="inline h-3 w-3 ml-1" />
                                    </button>
                                  </SheetTrigger>
                                ) : (
                                  <p className="font-medium text-foreground">{event.action}</p>
                                )}
                                {event.details && <p className="text-muted-foreground">{event.details}</p>}
                              </div>
                            </div>
                          ))}
                        </div></ScrollArea>
                    }
                     <SheetContent className="w-full max-w-[50vw] sm:max-w-xl md:max-w-2xl lg:max-w-3xl overflow-y-auto">
                        <SheetHeader>
                          <SheetTitle>Email Preview</SheetTitle>
                          <SheetDescription>
                            This is the content of the email that was sent to {selectedEmailLog?.to} on {selectedEmailLog ? format(selectedEmailLog.timestamp.toDate(), "PPpp") : 'N/A'}.
                          </SheetDescription>
                        </SheetHeader>
                        <div className="mt-4 prose dark:prose-invert max-w-none p-4 border rounded-md" dangerouslySetInnerHTML={{ __html: selectedEmailLog?.html || "<p>Email content not available.</p>" }} />
                    </SheetContent>
                  </Sheet>
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
    </>
  );
}

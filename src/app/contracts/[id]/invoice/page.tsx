
"use client";

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import { db, doc, getDoc, updateDoc, Timestamp, arrayUnion, serverTimestamp, collection, query, where, onSnapshot, getDocs } from '@/lib/firebase';
import { getFunctions, httpsCallableFromURL } from 'firebase/functions';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { StripePaymentForm } from '@/components/payments/stripe-payment-form';
import type { Contract, EditableInvoiceDetails, EditableInvoiceLineItem, Receipt as ReceiptType, PaymentMilestone } from '@/types';
import { generateInvoiceHtml, type GenerateInvoiceHtmlInput } from '@/ai/flows/generate-invoice-html-flow';
import { editInvoiceNote } from '@/ai/flows/edit-invoice-note-flow';
import { ArrowLeft, FileText, Loader2, Wand2, Save, AlertTriangle, CreditCard, Send, Edit, Eye, PlusCircle, Trash2, ReceiptText, Bot } from 'lucide-react';
import Link from 'next/link';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";


const CREATE_PAYMENT_INTENT_FUNCTION_URL = "https://createpaymentintent-cpmccwbluq-uc.a.run.app";
const SEND_CONTRACT_NOTIFICATION_FUNCTION_URL = "https://sendcontractnotification-cpmccwbluq-uc.a.run.app";

const getDefaultLineItem = (): EditableInvoiceLineItem => ({ description: "", quantity: 1, unitPrice: 0 });

const buildDefaultEditableDetails = (
  currentContract: Contract,
  creatorProfile: UserProfile | null,
  currentId: string,
  currentEditableInvoiceNumber?: string,
  milestone?: PaymentMilestone,
): EditableInvoiceDetails => {
    const lineItems: EditableInvoiceLineItem[] = milestone
    ? [{ description: milestone.description, quantity: 1, unitPrice: milestone.amount, isMilestone: true }]
    : currentContract.milestones?.map(m => ({ description: m.description, quantity: 1, unitPrice: m.amount, isMilestone: true })) ||
      (currentContract.amount > 0 ? [{ description: currentContract.projectName || `Services for ${currentContract.brand}`, quantity: 1, unitPrice: currentContract.amount, isMilestone: true }] : [getDefaultLineItem()]);

  return {
    creatorName: creatorProfile?.displayName || "",
    creatorAddress: creatorProfile?.address || "",
    creatorEmail: creatorProfile?.email || "",
    clientName: currentContract.clientName || "",
    clientAddress: currentContract.clientAddress || "",
    clientEmail: currentContract.clientEmail || "",
    invoiceNumber: currentEditableInvoiceNumber || currentContract.invoiceNumber || `INV-${currentContract.brand?.substring(0,3).toUpperCase() || 'AAA'}-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${currentId.substring(0,4).toUpperCase()}`,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: milestone?.dueDate || currentContract.dueDate || new Date().toISOString().split('T')[0],
    projectName: currentContract.projectName || "",
    deliverables: lineItems,
    paymentInstructions: currentContract.paymentInstructions || "",
  };
};

const calculateTotal = (items: EditableInvoiceLineItem[]): number => {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
};


export default function ManageInvoicePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params.id as string;
  const milestoneId = searchParams.get('milestoneId');
  const { user, isLoading: authLoading, getUserIdToken } = useAuth();
  const { toast } = useToast();

  // Core Data State
  const [contract, setContract] = useState<Contract | null>(null);
  const [creatorProfile, setCreatorProfile] = useState<UserProfile | null>(null);
  const [contractReceipts, setContractReceipts] = useState<Array<{url: string; description?: string;}>>([]);

  // Loading and UI State
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingDetails, setIsEditingDetails] = useState<boolean>(false);

  // Form Data State
  const [invoiceDetails, setInvoiceDetails] = useState<EditableInvoiceDetails | null>(null); // Single state for all invoice details
  const [formData, setFormData] = useState<EditableInvoiceDetails | null>(null); // Temporary state for the edit form

  const [invoiceHtmlContent, setInvoiceHtmlContent] = useState<string>("");
  const [invoiceStatus, setInvoiceStatus] = useState<Contract['invoiceStatus']>('none');
  
  // Action states
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // New state for send dialog
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [invoiceNote, setInvoiceNote] = useState("");
  const [aiTone, setAiTone] = useState<'more_professional' | 'more_friendly' | 'shorter' | 'more_detailed'>('more_professional');
  const [isEditingNoteWithAi, setIsEditingNoteWithAi] = useState(false);

  const [isFetchingClientSecret, setIsFetchingClientSecret] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState<boolean>(false);
  
  // Derived State
  const totalAmount = useMemo(() => calculateTotal(invoiceDetails?.deliverables || []), [invoiceDetails]);
  const payUrl = typeof window !== 'undefined' ? `${window.location.origin}/pay/contract/${id}${milestoneId ? '?milestoneId=' + milestoneId : ''}` : "";
  const milestoneBeingInvoiced = milestoneId ? contract?.milestones?.find(m => m.id === milestoneId) : undefined;
  const pageTitle = milestoneBeingInvoiced
    ? `Invoice for: ${milestoneBeingInvoiced.description}`
    : `Invoice for ${contract?.brand || ''} - ${contract?.projectName || contract?.id?.substring(0,6) || ''}`;
  const canSave = (isEditingDetails || !!invoiceHtmlContent) && !!invoiceDetails?.invoiceNumber;
  const canPay = (invoiceStatus === 'draft' || invoiceStatus === 'sent' || invoiceStatus === 'overdue' || invoiceStatus === 'partially_paid') && totalAmount > 0 && !clientSecret;
  const canSend = !!invoiceHtmlContent && (invoiceStatus === 'draft' || invoiceStatus === 'none' || invoiceStatus === 'sent' || invoiceStatus === 'partially_paid');
  const appearance = { theme: 'stripe' as const, variables: { colorPrimary: '#3F8CFF' }}; 
  const elementsOptions = clientSecret ? { clientSecret, appearance } : undefined;


  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
      setStripePromise(loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY));
    } else {
      console.error("Stripe publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) is missing.");
      toast({ title: "Stripe Error", description: "Stripe publishable key is not configured.", variant: "destructive", duration: 9000 });
    }
  }, [toast]);
  
  // Main data loading effect
  useEffect(() => {
    if (!id || !user?.uid) {
        if (!authLoading && !user?.uid) router.push('/login');
        return;
    }

    let isMounted = true;
    let unsubscribeContract: (() => void) | undefined;
    let unsubscribeCreator: (() => void) | undefined;
    let unsubscribeReceipts: (() => void) | undefined;
    
    setIsLoading(true);

    const contractDocRef = doc(db, 'contracts', id);
    unsubscribeContract = onSnapshot(contractDocRef, async (contractSnap) => {
        if (!isMounted) return;
        if (!contractSnap.exists()) {
            toast({ title: "Error", description: "Contract not found or access denied.", variant: "destructive" });
            router.push('/contracts');
            return;
        }

        const contractData = { ...contractSnap.data(), id: contractSnap.id } as Contract;
        setContract(contractData);
        setInvoiceStatus(contractData.invoiceStatus || 'none');

        // Once we have the contract, get the creator and receipts
        if(unsubscribeCreator) unsubscribeCreator();
        const creatorDocRef = doc(db, 'users', contractData.userId);
        unsubscribeCreator = onSnapshot(creatorDocRef, (creatorSnap) => {
            if (!isMounted) return;
            if (creatorSnap.exists()) {
                setCreatorProfile(creatorSnap.data() as UserProfile);
            } else {
                toast({ title: "Error", description: "Could not load creator's profile.", variant: "destructive" });
                setCreatorProfile(null);
            }
             setIsLoading(false); // Stop loading once core contract/creator data is here
        });

        if(unsubscribeReceipts) unsubscribeReceipts();
        const receiptsQuery = query(collection(db, 'receipts'), where('userId', '==', contractData.userId), where('linkedContractId', '==', id));
        unsubscribeReceipts = onSnapshot(receiptsQuery, (receiptsSnap) => {
            if (!isMounted) return;
            const fetchedReceipts = receiptsSnap.docs.map(docSnap => {
                const data = docSnap.data() as ReceiptType;
                return { url: data.receiptImageUrl, description: data.description || data.receiptFileName || "Uploaded Receipt"};
            });
            setContractReceipts(fetchedReceipts);
        });

    }, (error) => {
        if (isMounted) {
            console.error("Error fetching contract:", error);
            toast({ title: "Fetch Error", description: "Failed to load contract.", variant: "destructive" });
            setIsLoading(false);
        }
    });

    return () => { 
        isMounted = false; 
        if (unsubscribeContract) unsubscribeContract();
        if (unsubscribeCreator) unsubscribeCreator();
        if (unsubscribeReceipts) unsubscribeReceipts();
    };
}, [id, user?.uid, authLoading, router, toast]);


  // Effect to trigger initial AI generation once all data is ready
  useEffect(() => {
    if (isLoading || !contract || !creatorProfile) {
      return;
    }

    const handleInitialSetup = async () => {
        try {
            const savedDetails = contract.editableInvoiceDetails;
            const isMilestoneInvoice = !!milestoneId;
            const targetMilestone = milestoneId ? contract.milestones?.find(m => m.id === milestoneId) : undefined;
            const milestoneInSavedDetails = savedDetails?.deliverables?.some(d => d.isMilestone && d.description === targetMilestone?.description);

            let detailsToUse: EditableInvoiceDetails;

            if (savedDetails && (!isMilestoneInvoice || milestoneInSavedDetails)) {
                detailsToUse = savedDetails;
            } else {
                detailsToUse = buildDefaultEditableDetails(contract, creatorProfile, contract.id, contract.invoiceNumber, targetMilestone);
            }

            setInvoiceDetails(detailsToUse);
            await generateAndSetHtmlFromForm(detailsToUse, contractReceipts, contract.id, creatorProfile.companyLogoUrl);

            // Only toast if it's a fresh generation
            if (!savedDetails || (isMilestoneInvoice && !milestoneInSavedDetails)) {
                toast({ title: "Invoice Drafted by AI", description: "Review and edit as needed before saving or sending." });
            }
        } catch (error) {
            console.error("Error during initial invoice setup:", error);
            toast({ title: "Initialization Error", description: "Failed to set up invoice generator.", variant: "destructive" });
        }
    };

    handleInitialSetup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, contract, creatorProfile]);


  const generateAndSetHtmlFromForm = useCallback(async (detailsToUse: EditableInvoiceDetails, receiptsToUse: Array<{url: string; description?: string;}>, contractIdToUse: string, logoUrl?: string | null) => {
    setIsGeneratingAi(true);
    const totalAmount = calculateTotal(detailsToUse.deliverables);
    
    const inputForAI: GenerateInvoiceHtmlInput = {
      ...detailsToUse,
      contractId: contractIdToUse,
      totalAmount: totalAmount,
      companyLogoUrl: logoUrl || undefined,
      deliverables: detailsToUse.deliverables.map(d => ({ ...d, total: d.quantity * d.unitPrice })),
      payInvoiceLink: payUrl || undefined,
      receipts: receiptsToUse.length > 0 ? receiptsToUse.map(r => ({ url: r.url, description: r.description || "Receipt", 'sendgrid-disable-tracking': true } as any)) : undefined,
    };

    try {
      const result = await generateInvoiceHtml(inputForAI);
      setInvoiceHtmlContent(result.invoiceHtml);
    } catch (error) {
      console.error("Error generating HTML from form data:", error);
      toast({ title: "Preview Error", description: "Could not generate HTML preview from current details.", variant: "destructive" });
      setInvoiceHtmlContent("<p>Error generating preview.</p>");
    } finally {
        setIsGeneratingAi(false);
    }
  }, [toast, payUrl]); 

  const toggleEditMode = useCallback(async () => {
    if (isEditingDetails) { // Was editing, now switching to preview
      if (formData && contract && creatorProfile) {
        setInvoiceDetails(formData); // Apply form changes to main state
        await generateAndSetHtmlFromForm(formData, contractReceipts, contract.id, creatorProfile.companyLogoUrl);
      }
      setFormData(null); // Clear form data
    } else { // Was previewing, now switching to edit
        setFormData(invoiceDetails); // Populate form with current details
    }
    setIsEditingDetails(prev => !prev);
  }, [isEditingDetails, formData, invoiceDetails, contract, creatorProfile, contractReceipts, generateAndSetHtmlFromForm]);
  
  const handleSaveInvoice = async () => {
    if (!contract || !invoiceDetails?.invoiceNumber) {
      toast({ title: "Cannot Save", description: "Invoice number or core contract data missing.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const finalHtmlToSave = invoiceHtmlContent;
      const finalDetailsToSave = invoiceDetails;

      const contractDocRef = doc(db, 'contracts', contract.id);
      
      const milestoneDescription = milestoneId 
        ? contract.milestones?.find(m => m.id === milestoneId)?.description
        : 'General Invoice';
      
      const newStatus = (invoiceStatus === 'none' || invoiceStatus === '') ? 'draft' : invoiceStatus;

      const historyEntry = {
        timestamp: Timestamp.now(),
        action: `Invoice Draft Saved for ${milestoneId ? `Milestone: ${milestoneDescription}` : 'General Invoice'}`,
        details: `Invoice #: ${finalDetailsToSave.invoiceNumber}. Status: ${newStatus}. Total: $${totalAmount.toFixed(2)}`,
      };

      const updatesToSave: Partial<Contract> & {[key: string]: any} = { 
        invoiceHtmlContent: finalHtmlToSave,
        invoiceNumber: finalDetailsToSave.invoiceNumber,
        invoiceStatus: newStatus, 
        editableInvoiceDetails: finalDetailsToSave, 
        invoiceHistory: arrayUnion(historyEntry), 
        updatedAt: serverTimestamp(), 
      };

      await updateDoc(contractDocRef, updatesToSave);
      
      // No need to setContract, onSnapshot will handle it.
      setInvoiceStatus(newStatus);
      setIsEditingDetails(false); 

      toast({ title: "Invoice Saved", description: "Invoice details and HTML have been saved." });
    } catch (error) {
      console.error("Error saving invoice:", error);
      toast({ title: "Save Failed", description: "Could not save invoice details.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (newStatusValue: Contract['invoiceStatus']) => {
    if (!contract || !newStatusValue) return;
    setIsSaving(true);
    try {
      const contractDocRef = doc(db, 'contracts', contract.id);
      
      const milestoneDescription = milestoneId 
        ? contract.milestones?.find(m => m.id === milestoneId)?.description
        : 'General Invoice';

      const historyEntry = {
        timestamp: Timestamp.now(),
        action: `Status Changed to ${newStatusValue} for ${milestoneId ? `Milestone: ${milestoneDescription}` : 'General Invoice'}`,
        details: `Previous status: ${invoiceStatus}`,
      };
      await updateDoc(contractDocRef, {
        invoiceStatus: newStatusValue,
        invoiceHistory: arrayUnion(historyEntry),
        updatedAt: serverTimestamp(),
      });
      // No need to setInvoiceStatus or setContract, onSnapshot listener will update state
      toast({ title: "Status Updated", description: `Invoice status changed to ${newStatusValue}.` });
    } catch (error) {
      console.error("Error updating status:", error);
      toast({ title: "Update Failed", description: "Could not update invoice status.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInvoice = async () => {
    if (!contract || !user || !invoiceDetails) {
      toast({ title: "Cannot Send", description: "No contract, user, or invoice details available.", variant: "destructive" });
      return;
    }
    
    setIsSending(true);
    try {
      const idToken = await getUserIdToken();
      if (!idToken) throw new Error("Could not get user token.");

      let htmlToSend = invoiceHtmlContent;

      if (invoiceNote) {
        const noteHtml = `<p>${invoiceNote.replace(/\n/g, '<br>')}</p>`;
        const instructionsMarker = '<!-- Payment Instructions Section -->';
        if (htmlToSend.includes(instructionsMarker)) {
           htmlToSend = htmlToSend.replace(instructionsMarker, `
            <div class="notes-section" style="margin-bottom: 20px;">
              <h3 style="border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px;">Note from ${invoiceDetails.creatorName}</h3>
              ${noteHtml}
            </div>
            ${instructionsMarker}
           `);
        } else {
            htmlToSend = htmlToSend.replace('</body>', `<div style="padding: 30px; padding-top: 0;">${noteHtml}</div></body>`);
        }
      }

      const emailBody = {
        to: invoiceDetails.clientEmail,
        subject: `Invoice ${invoiceDetails.invoiceNumber} from ${invoiceDetails.creatorName}`,
        text: `Hello ${invoiceDetails.clientName},\n\nPlease find attached your invoice ${invoiceDetails.invoiceNumber} for ${invoiceDetails.projectName}.\n\nTotal Amount Due: $${totalAmount.toFixed(2)}\n\n${invoiceNote ? `Note: ${invoiceNote}\n\n` : ''}Click here to pay: ${payUrl}\n\nThank you,\n${invoiceDetails.creatorName}`,
        html: htmlToSend, 
        contractId: contract.id,
      };

      const response = await fetch(SEND_CONTRACT_NOTIFICATION_FUNCTION_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`},
        body: JSON.stringify(emailBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Server error" }));
        throw new Error(`Server error: ${errorData.message || response.status}`);
      }

      const contractDocRef = doc(db, 'contracts', contract.id);
      const historyEntry = { timestamp: Timestamp.now(), action: 'Invoice Sent to Client', details: `To: ${emailBody.to}`};
      
      let updatedMilestones = contract.milestones;
      if (milestoneId && updatedMilestones) {
        updatedMilestones = updatedMilestones.map(m => 
          m.id === milestoneId ? { ...m, status: 'invoiced', invoiceId: invoiceDetails.invoiceNumber } : m
        );
      }
      
      const allMilestonesDone = updatedMilestones?.every(m => m.status === 'invoiced' || m.status === 'paid');
      const newOverallStatus = allMilestonesDone ? 'invoiced' : 'sent';

      await updateDoc(contractDocRef, { 
        invoiceStatus: newOverallStatus, 
        milestones: updatedMilestones,
        invoiceHistory: arrayUnion(historyEntry),
        lastReminderSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(), 
      });

      toast({ title: "Invoice Sent", description: `Invoice ${invoiceDetails.invoiceNumber} sent to ${emailBody.to}.` });
      setIsSendDialogOpen(false);
      setInvoiceNote("");

    } catch (error: any) {
      console.error("Error sending invoice:", error);
      toast({ title: "Send Invoice Failed", description: error.message || "Could not send invoice email.", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const handleAiEditNote = async () => {
    if (!invoiceNote.trim()) {
      toast({ title: "Cannot Edit", description: "Please write a draft note first.", variant: "destructive" });
      return;
    }
    setIsEditingNoteWithAi(true);
    try {
      const result = await editInvoiceNote({ draftNote: invoiceNote, tone: aiTone });
      setInvoiceNote(result.editedNote);
      toast({ title: "Note Updated by AI" });
    } catch (error: any) {
      console.error("Error editing note with AI:", error);
      toast({ title: "AI Error", description: error.message || "Could not edit the note.", variant: "destructive" });
    } finally {
      setIsEditingNoteWithAi(false);
    }
  };

  const handleInitiatePayment = async () => {
    if (!contract || !user) return;
    setIsFetchingClientSecret(true); setClientSecret(null);
    try {
      const idToken = await getUserIdToken();
      if (!idToken) throw new Error("Could not get user token for payment.");

      const response = await fetch(CREATE_PAYMENT_INTENT_FUNCTION_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`},
        body: JSON.stringify({
          amount: totalAmount, 
          currency: 'usd', 
          contractId: contract.id,
          milestoneId: milestoneId,
          clientEmail: invoiceDetails?.clientEmail || contract.clientEmail || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Payment intent failed. Status: ${response.status}`);
      }
      const { clientSecret: receivedClientSecret } = await response.json();
      if (!receivedClientSecret) throw new Error("Client secret not received.");
      setClientSecret(receivedClientSecret);
      toast({ title: "Payment Form Ready", description: "Enter card details below." });
    } catch (error: any) {
      console.error("Payment intent error:", error);
      toast({ title: "Payment Setup Failed", description: error.message || "Could not initiate payment.", variant: "destructive" });
      setClientSecret(null);
    } finally {
      setIsFetchingClientSecret(false);
    }
  };

  const handleFormInputChange = (field: keyof EditableInvoiceDetails, value: string | number | EditableInvoiceLineItem[]) => {
    setFormData(prev => prev ? { ...prev, [field]: value } : null);
  };
  
  const handleDeliverableChange = (index: number, field: keyof EditableInvoiceLineItem, value: string | number) => {
    if (!formData) return;
    const newDeliverables = [...(formData.deliverables || [])];
    const item = { ...newDeliverables[index] };
    if (field === 'quantity' || field === 'unitPrice') {
        const numericValue = parseFloat(value as string);
        item[field] = isNaN(numericValue) ? 0 : (numericValue < 0 ? 0 : numericValue);
    } else {
        item[field] = value as string;
    }
    newDeliverables[index] = item;
    handleFormInputChange('deliverables', newDeliverables);
  };

  const addDeliverable = () => {
    if (!formData) return;
    handleFormInputChange('deliverables', [...(formData.deliverables || []), getDefaultLineItem()]);
  };

  const removeDeliverable = (index: number) => {
    if (!formData || !formData.deliverables) return;
    if (formData.deliverables[index]?.isMilestone) {
        toast({ title: "Cannot Remove", description: "The main milestone line item cannot be removed.", variant: "default" });
        return;
    }
    handleFormInputChange('deliverables', formData.deliverables.filter((_, i) => i !== index));
  };

  if (isLoading || authLoading) {
    return <div className="space-y-4 p-4"><PageHeader title="Manage Invoice" description="Loading..." /><Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card></div>;
  }
  if (!contract || !creatorProfile) {
    return <div className="flex flex-col items-center justify-center h-full p-4"><AlertTriangle className="w-16 h-16 text-destructive mb-4" /><h2 className="text-2xl font-semibold mb-2">Contract Not Found</h2><Button asChild variant="outline" onClick={() => router.push('/contracts')}><Link href="/contracts"><ArrowLeft className="mr-2 h-4 w-4"/>Back</Link></Button></div>;
  }

  const formDataTotalAmount = useMemo(() => calculateTotal(formData?.deliverables || []), [formData]);
  
  return (
    <>
      <PageHeader
        title={pageTitle}
        description={invoiceDetails?.invoiceNumber ? `Invoice #: ${invoiceDetails.invoiceNumber} | Status: ${invoiceStatus || 'None'}` : "Generate, edit, and manage the invoice."}
        actions={<Button variant="outline" asChild><Link href={`/contracts/${id}`}><ArrowLeft className="mr-2 h-4 w-4"/>Back to Contract</Link></Button>}
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Invoice Management</CardTitle>
            <CardDescription>Update invoice details, status, content, and process payments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={toggleEditMode} variant="outline" disabled={isSaving || isGeneratingAi || isSending || !!clientSecret}>
                {isEditingDetails ? <Eye className="mr-2 h-4 w-4" /> : <Edit className="mr-2 h-4 w-4" />}
                {isEditingDetails ? "Preview Changes" : "Edit Invoice Details"}
              </Button>
              <Button onClick={handleSaveInvoice} disabled={isSaving || isGeneratingAi || isFetchingClientSecret || isSending || !!clientSecret || !canSave}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Details & HTML
              </Button>
              {canSend && (
                 <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
                  <DialogTrigger asChild>
                     <Button disabled={isSending || isGeneratingAi || isSaving || isFetchingClientSecret || !!clientSecret || isEditingDetails}>
                      <Send className="mr-2 h-4 w-4" /> Send to Client
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Send Invoice to Client</DialogTitle>
                      <DialogDescription>Add an optional note to your client. The full invoice will be attached.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div>
                        <Label htmlFor="note">Personal Note (Optional)</Label>
                        <Textarea id="note" value={invoiceNote} onChange={(e) => setInvoiceNote(e.target.value)} placeholder="e.g., Thanks for the great collaboration on this project!" className="mt-1" rows={4} />
                      </div>
                      <div className="space-y-2">
                        <Label>Refine note with AI</Label>
                        <RadioGroup defaultValue="more_professional" value={aiTone} onValueChange={(val) => setAiTone(val as any)} className="flex gap-4">
                           <Label className="flex items-center gap-2 cursor-pointer"><RadioGroupItem value="more_professional" /> Professional</Label>
                           <Label className="flex items-center gap-2 cursor-pointer"><RadioGroupItem value="more_friendly" /> Friendly</Label>
                           <Label className="flex items-center gap-2 cursor-pointer"><RadioGroupItem value="shorter" /> Shorter</Label>
                        </RadioGroup>
                        <Button variant="outline" size="sm" onClick={handleAiEditNote} disabled={isEditingNoteWithAi || !invoiceNote.trim()}>
                           {isEditingNoteWithAi ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Bot className="h-4 w-4 mr-2"/>} Refine with AI
                        </Button>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsSendDialogOpen(false)}>Cancel</Button>
                      <Button type="button" onClick={handleSendInvoice} disabled={isSending}>
                        {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Send Invoice
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
               {canPay && (
                <Button onClick={handleInitiatePayment} disabled={isFetchingClientSecret || isGeneratingAi || isSaving || isSending || !stripePromise || isEditingDetails} variant="default">
                  {isFetchingClientSecret ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  Pay Invoice (${totalAmount.toLocaleString()})
                </Button>
              )}
            </div>
            {(!invoiceDetails?.clientEmail) && canSend && (
                <p className="text-xs text-destructive">Client email is missing. Please add it to enable sending.</p>
            )}
          </CardContent>
        </Card>

        {clientSecret && stripePromise && elementsOptions && (
          <Card>
            <CardHeader><CardTitle>Enter Payment Details</CardTitle><CardDescription>Securely enter your card information below.</CardDescription></CardHeader>
            <CardContent><Elements stripe={stripePromise} options={elementsOptions}><StripePaymentForm clientSecret={clientSecret} contractId={contract.id} /></Elements></CardContent>
          </Card>
        )}

        {isEditingDetails && !clientSecret && formData && (
          <Card>
            <CardHeader><CardTitle>Edit Invoice Details</CardTitle><CardDescription>Modify the fields below. The HTML preview will update when you click "Preview Changes".</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div><Label htmlFor="edit-invNum">Invoice Number</Label><Input id="edit-invNum" value={formData.invoiceNumber} onChange={(e) => handleFormInputChange('invoiceNumber', e.target.value)} className="mt-1"/></div>
                <div><Label htmlFor="edit-invDate">Invoice Date</Label><Input id="edit-invDate" type="date" value={formData.invoiceDate} onChange={(e) => handleFormInputChange('invoiceDate', e.target.value)} className="mt-1"/></div>
                <div><Label htmlFor="edit-dueDate">Due Date</Label><Input id="edit-dueDate" type="date" value={formData.dueDate} onChange={(e) => handleFormInputChange('dueDate', e.target.value)} className="mt-1"/></div>
                <div><Label htmlFor="edit-projName">Project Name (Optional)</Label><Input id="edit-projName" value={formData.projectName} onChange={(e) => handleFormInputChange('projectName', e.target.value)} className="mt-1"/></div>
              </div>
              
              <div className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold mb-2">Creator Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    <div><Label htmlFor="edit-creatorName">Your Name/Company</Label><Input id="edit-creatorName" value={formData.creatorName} onChange={(e) => handleFormInputChange('creatorName', e.target.value)} className="mt-1"/></div>
                    <div><Label htmlFor="edit-creatorEmail">Your Email</Label><Input id="edit-creatorEmail" type="email" value={formData.creatorEmail} onChange={(e) => handleFormInputChange('creatorEmail', e.target.value)} className="mt-1"/></div>
                    <div className="md:col-span-2"><Label htmlFor="edit-creatorAddr">Your Address</Label><Textarea id="edit-creatorAddr" value={formData.creatorAddress} onChange={(e) => handleFormInputChange('creatorAddress', e.target.value)} rows={2} className="mt-1"/></div>
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold mb-2">Client Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    <div><Label htmlFor="edit-clientName">Client Name</Label><Input id="edit-clientName" value={formData.clientName} onChange={(e) => handleFormInputChange('clientName', e.target.value)} className="mt-1"/></div>
                    <div><Label htmlFor="edit-clientEmail">Client Email</Label><Input id="edit-clientEmail" type="email" value={formData.clientEmail} onChange={(e) => handleFormInputChange('clientEmail', e.target.value)} className="mt-1"/></div>
                    <div className="md:col-span-2"><Label htmlFor="edit-clientAddr">Client Address</Label><Textarea id="edit-clientAddr" value={formData.clientAddress} onChange={(e) => handleFormInputChange('clientAddress', e.target.value)} rows={2} className="mt-1"/></div>
                </div>
              </div>
              
              <div className="border-t pt-4 mt-4">
                <div className="mb-6"> 
                  <h4 className="text-md font-semibold mb-2 flex items-center"><ReceiptText className="mr-2 h-5 w-5 text-primary" />Linked Receipts ({contractReceipts.length})</h4>
                  {contractReceipts.length > 0 ? (<ul className="space-y-2 rounded-md border bg-muted/50 p-3 max-h-40 overflow-y-auto">{contractReceipts.map((receipt, index) => (<li key={index} className="flex items-center justify-between text-sm p-1 hover:bg-muted rounded"><div className="flex items-center"><FileText className="mr-2 h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate" title={receipt.description || "Receipt"}>{receipt.description || "Receipt"}</span></div><a href={receipt.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs ml-2 flex-shrink-0">View</a></li>))}</ul>) 
                  : (<p className="text-sm text-muted-foreground p-3 border rounded-md bg-muted/50">No receipts linked.</p>)}
                  <p className="text-xs text-muted-foreground mt-2">Manage linked receipts on the <Link href={`/receipts?contractId=${id}`} className="text-primary hover:underline">Receipts page</Link>.</p>
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold mb-2">Invoice Line Items</h4>
                {formData.deliverables?.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end mb-3 p-3 border rounded-md">
                    <div className="col-span-12 md:col-span-5"><Label htmlFor={`desc-${index}`}>Description</Label><Input id={`desc-${index}`} value={item.description} onChange={(e) => handleDeliverableChange(index, 'description', e.target.value)} className="mt-1" disabled={item.isMilestone}/></div>
                    <div className="col-span-6 md:col-span-2"><Label htmlFor={`qty-${index}`}>Quantity</Label><Input id={`qty-${index}`} type="number" value={item.quantity} min="1" onChange={(e) => handleDeliverableChange(index, 'quantity', e.target.value)} className="mt-1" disabled={item.isMilestone}/></div>
                    <div className="col-span-6 md:col-span-2"><Label htmlFor={`price-${index}`}>Unit Price</Label><Input id={`price-${index}`} type="number" value={item.unitPrice} min="0" step="0.01" onChange={(e) => handleDeliverableChange(index, 'unitPrice', e.target.value)} className="mt-1" disabled={item.isMilestone}/></div>
                    <div className="col-span-10 md:col-span-2"><Label>Total</Label><Input value={!isNaN(item.quantity * item.unitPrice) ? (item.quantity * item.unitPrice).toFixed(2) : '0.00'} readOnly disabled className="mt-1 bg-muted"/></div>
                    <div className="col-span-2 md:col-span-1"><Button type="button" variant="ghost" size="icon" onClick={() => removeDeliverable(index)} className="text-destructive hover:bg-destructive/10 w-full" disabled={item.isMilestone}><Trash2 className="h-4 w-4"/></Button></div>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addDeliverable} size="sm"><PlusCircle className="mr-2 h-4 w-4"/>Add Line Item</Button>
                <div className="text-right font-semibold text-lg mt-4">Total Amount: ${formDataTotalAmount.toFixed(2)}</div>
              </div>

              <div className="border-t pt-4 mt-4">
                <Label htmlFor="edit-paymentInstr">Payment Instructions</Label>
                <Textarea id="edit-paymentInstr" value={formData.paymentInstructions} onChange={(e) => handleFormInputChange('paymentInstructions', e.target.value)} rows={3} className="mt-1"/>
              </div>
            </CardContent>
          </Card>
        )}

        {!clientSecret && !isEditingDetails && (
          invoiceHtmlContent ? (
            <Card>
              <CardHeader><CardTitle>Invoice HTML Preview</CardTitle><CardDescription>This is a preview of the invoice that will be sent.</CardDescription></CardHeader>
              <CardContent><div className="prose dark:prose-invert max-w-none p-4 border rounded-md bg-background overflow-auto max-h-[60vh]" dangerouslySetInnerHTML={{ __html: invoiceHtmlContent }} /></CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader><CardTitle>No Invoice Content</CardTitle></CardHeader>
              <CardContent><p className="text-muted-foreground">
                {isLoading || isGeneratingAi ? <Loader2 className="inline animate-spin mr-2 h-4 w-4" /> : ''}
                {isLoading ? 'Loading invoice data...' : 
                 isGeneratingAi ? 'Generating AI preview...' : 
                 'No invoice has been generated for this milestone yet. Click "Edit Details" to start.'}
              </p></CardContent>
            </Card>
          )
        )}
      </div>
    </>
  );
}

    
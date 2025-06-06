
"use client";

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, updateDoc, Timestamp, arrayUnion, serverTimestamp, collection, query, where, onSnapshot } from '@/lib/firebase';
import { getFunctions, httpsCallableFromURL } from 'firebase/functions';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { StripePaymentForm } from '@/components/payments/stripe-payment-form';
import type { Contract, EditableInvoiceDetails, EditableInvoiceLineItem, Receipt } from '@/types';
import { generateInvoiceHtml, type GenerateInvoiceHtmlInput } from '@/ai/flows/generate-invoice-html-flow';
import { ArrowLeft, FileText, Loader2, Wand2, Save, AlertTriangle, CreditCard, Send, Edit, Eye, PlusCircle, Trash2 } from 'lucide-react';
import Link from 'next/link';

const CREATE_PAYMENT_INTENT_FUNCTION_URL = "https://createpaymentintent-cpmccwbluq-uc.a.run.app";
const SEND_CONTRACT_NOTIFICATION_FUNCTION_URL = "https://sendcontractnotification-cpmccwbluq-uc.a.run.app";

const getDefaultLineItem = (): EditableInvoiceLineItem => ({ description: "", quantity: 1, unitPrice: 0 });

interface ContractReceipt {
  url: string;
  description?: string;
}

export default function ManageInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, isLoading: authLoading, getUserIdToken } = useAuth();
  const { toast } = useToast();

  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoadingContract, setIsLoadingContract] = useState(true);
  const [contractReceipts, setContractReceipts] = useState<ContractReceipt[]>([]);
  
  // State for form-based editing
  const [isEditingDetails, setIsEditingDetails] = useState<boolean>(false);
  const [editableCreatorName, setEditableCreatorName] = useState<string>("");
  const [editableCreatorAddress, setEditableCreatorAddress] = useState<string>("");
  const [editableCreatorEmail, setEditableCreatorEmail] = useState<string>("");
  const [editableClientName, setEditableClientName] = useState<string>("");
  const [editableClientAddress, setEditableClientAddress] = useState<string>("");
  const [editableClientEmail, setEditableClientEmail] = useState<string>("");
  const [editableInvoiceNumber, setEditableInvoiceNumber] = useState<string>("");
  const [editableInvoiceDate, setEditableInvoiceDate] = useState<string>("");
  const [editableDueDate, setEditableDueDate] = useState<string>("");
  const [editableProjectName, setEditableProjectName] = useState<string>("");
  const [editableDeliverables, setEditableDeliverables] = useState<EditableInvoiceLineItem[]>([getDefaultLineItem()]);
  const [editablePaymentInstructions, setEditablePaymentInstructions] = useState<string>("");
  const [calculatedTotalAmount, setCalculatedTotalAmount] = useState<number>(0);

  const [invoiceHtmlContent, setInvoiceHtmlContent] = useState<string>(""); // For preview & sending
  const [invoiceStatus, setInvoiceStatus] = useState<Contract['invoiceStatus']>('none');
  
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const [isFetchingClientSecret, setIsFetchingClientSecret] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [payUrl, setPayUrl] = useState<string>("");

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
      setStripePromise(loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY));
    } else {
      console.error("Stripe publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) is missing.");
      toast({ title: "Stripe Error", description: "Stripe publishable key is not configured.", variant: "destructive", duration: 9000 });
    }
  }, [toast]);
  
  const populateFormFromEditableDetails = useCallback((details: EditableInvoiceDetails) => {
    setEditableCreatorName(details.creatorName || user?.displayName || "");
    setEditableCreatorAddress(details.creatorAddress || user?.address || "");
    setEditableCreatorEmail(details.creatorEmail || user?.email || "");
    setEditableClientName(details.clientName || contract?.clientName || "");
    setEditableClientAddress(details.clientAddress || contract?.clientAddress || "");
    setEditableClientEmail(details.clientEmail || contract?.clientEmail || "");
    setEditableInvoiceNumber(details.invoiceNumber);
    setEditableInvoiceDate(details.invoiceDate);
    setEditableDueDate(details.dueDate);
    setEditableProjectName(details.projectName || contract?.projectName || "");
    setEditableDeliverables(details.deliverables.length > 0 ? details.deliverables.map(d => ({...d})) : [getDefaultLineItem()]);
    setEditablePaymentInstructions(details.paymentInstructions || contract?.paymentInstructions || "");
  }, [user, contract]);

  const generateAndSetHtmlFromForm = useCallback(async (currentEditableDetails?: EditableInvoiceDetails, currentReceipts?: ContractReceipt[]) => {
    if (!contract || !user) return;

    const detailsToUse = currentEditableDetails || getStructuredDataFromForm();
    const receiptsToUse = currentReceipts || contractReceipts;
    
    const inputForAI: GenerateInvoiceHtmlInput = {
      ...detailsToUse,
      contractId: contract.id,
      totalAmount: calculateTotal(detailsToUse.deliverables),
      deliverables: detailsToUse.deliverables.map(d => ({
        ...d,
        total: d.quantity * d.unitPrice
      })),
      payInvoiceLink: payUrl || undefined,
      receipts: receiptsToUse.length > 0 ? receiptsToUse : undefined,
    };

    try {
      const result = await generateInvoiceHtml(inputForAI);
      setInvoiceHtmlContent(result.invoiceHtml);
    } catch (error) {
      console.error("Error generating HTML from form data:", error);
      toast({ title: "Preview Error", description: "Could not generate HTML preview from current details.", variant: "destructive" });
    }
  }, [contract, user, payUrl, contractReceipts]); // Added contractReceipts

  useEffect(() => {
    let unsubscribeContract: (() => void) | undefined;
    let unsubscribeReceipts: (() => void) | undefined;

    if (id && user && !authLoading) { 
      setIsLoadingContract(true);
      
      const contractDocRef = doc(db, 'contracts', id);
      unsubscribeContract = onSnapshot(contractDocRef, async (contractSnap) => {
        if (contractSnap.exists() && contractSnap.data().userId === user.uid) {
          const data = contractSnap.data() as Contract;
          setContract({ ...data, id: contractSnap.id });
          setInvoiceStatus(data.invoiceStatus || 'none');
          setInvoiceHtmlContent(data.invoiceHtmlContent || "");
            
          const currentPayUrl = typeof window !== 'undefined' ? `${window.location.origin}/pay/contract/${id}` : "";
          setPayUrl(currentPayUrl);

          if (data.editableInvoiceDetails) {
            populateFormFromEditableDetails(data.editableInvoiceDetails);
            // HTML regeneration will happen when receipts are also loaded or form is changed
          } else {
            // Initialize form with base contract/user data
            setEditableCreatorName(user.displayName || "");
            setEditableCreatorAddress(user.address || "");
            setEditableCreatorEmail(user.email || "");
            setEditableClientName(data.clientName || "");
            setEditableClientAddress(data.clientAddress || "");
            setEditableClientEmail(data.clientEmail || "");
            setEditableInvoiceNumber(data.invoiceNumber || `INV-${data.brand?.substring(0,3).toUpperCase() || 'AAA'}-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${id.substring(0,4).toUpperCase()}`);
            setEditableInvoiceDate(new Date().toISOString().split('T')[0]);
            setEditableDueDate(data.dueDate);
            setEditableProjectName(data.projectName || "");
            setEditableDeliverables(data.amount > 0 ? [{ description: data.projectName || `Services for ${data.brand}`, quantity: 1, unitPrice: data.amount }] : [getDefaultLineItem()]);
            setEditablePaymentInstructions(data.paymentInstructions || "");
          }
          setIsLoadingContract(false); // Contract loaded, now can fetch receipts

          // Fetch receipts for this contract
          const receiptsCol = collection(db, 'receipts');
          const qReceipts = query(receiptsCol, where('userId', '==', user.uid), where('linkedContractId', '==', id));
          
          if (unsubscribeReceipts) unsubscribeReceipts(); // Unsubscribe previous listener if any

          unsubscribeReceipts = onSnapshot(qReceipts, (receiptSnapshot) => {
            const fetchedReceipts = receiptSnapshot.docs.map(docSnap => {
              const receiptData = docSnap.data() as Receipt;
              return {
                url: receiptData.receiptImageUrl,
                description: receiptData.description || receiptData.receiptFileName || "Uploaded Receipt"
              };
            });
            setContractReceipts(fetchedReceipts);

            // Regenerate HTML if contract details and receipts are loaded
            if (data.editableInvoiceDetails) {
              generateAndSetHtmlFromForm(data.editableInvoiceDetails, fetchedReceipts);
            } else if (!data.invoiceHtmlContent && data.amount > 0) {
              handleGenerateInvoiceWithAI(true, data, fetchedReceipts);
            } else if (data.invoiceHtmlContent) {
               // If HTML exists, it might not have receipts. If user edits/saves, it will be regenerated.
               // For now, just keep existing HTML or generate new if needed.
            }
          }, (error) => {
            console.error("Error fetching receipts:", error);
            toast({ title: "Receipts Error", description: "Could not load associated receipts.", variant: "destructive" });
          });


        } else {
          toast({ title: "Error", description: "Contract not found or access denied.", variant: "destructive" });
          router.push('/contracts');
          setIsLoadingContract(false);
        }
      }, (error) => {
        console.error("Error fetching contract:", error);
        toast({ title: "Fetch Error", description: "Could not load contract details.", variant: "destructive" });
        setIsLoadingContract(false);
      });

    } else if (!authLoading && !user) {
      router.push('/login');
    }
    return () => {
      if (unsubscribeContract) unsubscribeContract();
      if (unsubscribeReceipts) unsubscribeReceipts();
    };
  }, [id, user, authLoading, router, toast, populateFormFromEditableDetails, generateAndSetHtmlFromForm]);


  const calculateTotal = (items: EditableInvoiceLineItem[]): number => {
    return items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  };

  useEffect(() => {
    setCalculatedTotalAmount(calculateTotal(editableDeliverables));
  }, [editableDeliverables]);

  const getStructuredDataFromForm = (): EditableInvoiceDetails => ({
    creatorName: editableCreatorName,
    creatorAddress: editableCreatorAddress,
    creatorEmail: editableCreatorEmail,
    clientName: editableClientName,
    clientAddress: editableClientAddress,
    clientEmail: editableClientEmail,
    invoiceNumber: editableInvoiceNumber,
    invoiceDate: editableInvoiceDate,
    dueDate: editableDueDate,
    projectName: editableProjectName,
    deliverables: editableDeliverables.map(d => ({...d})), // Deep copy
    paymentInstructions: editablePaymentInstructions,
  });

  const handleGenerateInvoiceWithAI = async (isInitialLoad = false, initialContractData?: Contract, initialReceipts?: ContractReceipt[]) => {
    const currentContract = initialContractData || contract;
    const currentReceipts = initialReceipts || contractReceipts;

    if (!currentContract || !user || (!isInitialLoad && !editableInvoiceNumber) ) {
        if (!isInitialLoad) toast({ title: "Cannot Generate", description: "Contract details or invoice number missing.", variant: "destructive" });
        return;
    }
    setIsGeneratingAi(true);
    try {
      const baseDeliverables = currentContract.extractedTerms?.deliverables?.map((desc) => ({
        description: desc,
        quantity: 1,
        unitPrice: currentContract.extractedTerms?.deliverables && currentContract.extractedTerms.deliverables.length > 0 ? currentContract.amount / currentContract.extractedTerms.deliverables.length : currentContract.amount,
      })) || (currentContract.amount > 0 ? [{ description: currentContract.projectName || `Services for ${currentContract.brand}`, quantity: 1, unitPrice: currentContract.amount }] : [getDefaultLineItem()]);

      const aiInputDetails: EditableInvoiceDetails = {
        creatorName: user.displayName || "",
        creatorAddress: user.address || "",
        creatorEmail: user.email || "",
        clientName: currentContract.clientName || "",
        clientAddress: currentContract.clientAddress || "",
        clientEmail: currentContract.clientEmail || "",
        invoiceNumber: editableInvoiceNumber || `INV-${currentContract.brand?.substring(0,3).toUpperCase() || 'AAA'}-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${id.substring(0,4).toUpperCase()}`,
        invoiceDate: new Date().toISOString().split('T')[0],
        dueDate: currentContract.dueDate,
        projectName: currentContract.projectName || "",
        deliverables: baseDeliverables,
        paymentInstructions: currentContract.paymentInstructions || "",
      };
      
      populateFormFromEditableDetails(aiInputDetails); // Populate form with what AI will use

      const genHtmlInput: GenerateInvoiceHtmlInput = {
        ...aiInputDetails,
        contractId: currentContract.id,
        totalAmount: calculateTotal(aiInputDetails.deliverables),
        deliverables: aiInputDetails.deliverables.map(d => ({...d, total: d.quantity * d.unitPrice })),
        payInvoiceLink: payUrl || undefined,
        receipts: currentReceipts.length > 0 ? currentReceipts : undefined,
      };

      const result = await generateInvoiceHtml(genHtmlInput);
      setInvoiceHtmlContent(result.invoiceHtml);
      setIsEditingDetails(false); 
      if (!isInitialLoad) toast({ title: "Invoice Generated by AI", description: "Invoice details and HTML preview updated." });
    } catch (error) {
      console.error("Error generating invoice with AI:", error);
      if (!isInitialLoad) toast({ title: "AI Generation Failed", description: "Could not generate invoice with AI.", variant: "destructive" });
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const toggleEditMode = async () => {
    if (isEditingDetails) { // Leaving edit mode, update preview
      await generateAndSetHtmlFromForm(undefined, contractReceipts);
    } else { // Entering edit mode
      if (!invoiceHtmlContent && (!contract?.editableInvoiceDetails && !contract?.invoiceHtmlContent)) {
        await handleGenerateInvoiceWithAI(false, contract, contractReceipts);
      }
    }
    setIsEditingDetails(!isEditingDetails);
  };
  
  const handleSaveInvoice = async () => {
    if (!contract || !editableInvoiceNumber) {
      toast({ title: "Cannot Save", description: "Invoice number or core contract data missing.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const currentFormData = getStructuredDataFromForm();
      const finalTotalAmount = calculateTotal(currentFormData.deliverables);

      const inputForAI: GenerateInvoiceHtmlInput = {
        ...currentFormData,
        contractId: contract.id,
        totalAmount: finalTotalAmount,
        deliverables: currentFormData.deliverables.map(d => ({...d, total: d.quantity * d.unitPrice})),
        payInvoiceLink: payUrl || undefined,
        receipts: contractReceipts.length > 0 ? contractReceipts : undefined,
      };
      const htmlResult = await generateInvoiceHtml(inputForAI);
      const finalHtmlToSave = htmlResult.invoiceHtml;
      setInvoiceHtmlContent(finalHtmlToSave);

      const contractDocRef = doc(db, 'contracts', contract.id);
      const newStatus = invoiceStatus === 'none' ? 'draft' : invoiceStatus;
      
      const historyEntry = {
        timestamp: Timestamp.now(),
        action: "Invoice Details Updated",
        details: `Invoice details saved. Invoice #: ${editableInvoiceNumber}. Status: ${newStatus}. Total: $${finalTotalAmount.toFixed(2)}`,
      };

      await updateDoc(contractDocRef, {
        invoiceHtmlContent: finalHtmlToSave,
        invoiceNumber: editableInvoiceNumber,
        invoiceStatus: newStatus,
        editableInvoiceDetails: currentFormData, 
        amount: finalTotalAmount, 
        invoiceHistory: arrayUnion(historyEntry),
        updatedAt: serverTimestamp(),
      });
      
      // No need to setContract here, onSnapshot will update it.
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

  const handleStatusChange = async (newStatus: Contract['invoiceStatus']) => {
    if (!contract || !newStatus) return;
    setIsSaving(true);
    try {
      const contractDocRef = doc(db, 'contracts', contract.id);
      const historyEntry = {
        timestamp: Timestamp.now(),
        action: `Invoice Status Changed to ${newStatus}`,
         details: `Previous status: ${invoiceStatus}`,
      };
      await updateDoc(contractDocRef, {
        invoiceStatus: newStatus,
        invoiceHistory: arrayUnion(historyEntry),
        updatedAt: serverTimestamp(),
      });
      // No need to setContract or setInvoiceStatus here, onSnapshot will handle.
      toast({ title: "Status Updated", description: `Invoice status changed to ${newStatus}.` });
    } catch (error) {
      console.error("Error updating status:", error);
      toast({ title: "Update Failed", description: "Could not update invoice status.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInvoice = async () => {
    if (!contract || !invoiceHtmlContent || !user) {
      toast({ title: "Cannot Send", description: "No invoice content or user session available.", variant: "destructive" });
      return;
    }
    if (!editableClientEmail && !contract.clientEmail) {
      toast({ title: "Missing Client Email", description: "Client email is required to send an invoice. Please add it to the invoice details or contract.", variant: "destructive" });
      return;
    }
     if (isEditingDetails) {
      toast({ title: "Unsaved Changes", description: "Please save or preview your changes before sending.", variant: "default" });
      return;
    }

    setIsSending(true);
    try {
      const idToken = await getUserIdToken();
      if (!idToken) throw new Error("Could not get user token.");

      const emailTo = editableClientEmail || contract.clientEmail;
      const finalClientName = editableClientName || contract.clientName || contract.brand;
      const finalProjectName = editableProjectName || contract.projectName || 'services rendered';
      const finalInvoiceNumber = editableInvoiceNumber || contract.invoiceNumber;
      const finalDueDate = editableDueDate || contract.dueDate;
      const finalCreatorName = editableCreatorName || user.displayName || 'Your Service Provider';

      const emailBody = {
        to: emailTo,
        subject: `Invoice ${finalInvoiceNumber} from ${finalCreatorName}`,
        text: `Hello ${finalClientName},\n\nPlease find attached your invoice ${finalInvoiceNumber} for ${finalProjectName}.\n\nTotal Amount Due: $${calculatedTotalAmount.toFixed(2)}\nDue Date: ${new Date(finalDueDate).toLocaleDateString()}\n\nClick here to pay: ${payUrl}\n\nThank you,\n${finalCreatorName}`,
        html: invoiceHtmlContent, // This HTML already includes receipt links
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
      const historyEntry = { timestamp: Timestamp.now(), action: 'Invoice Sent to Client', details: `To: ${emailTo}`};
      await updateDoc(contractDocRef, { invoiceStatus: 'sent', invoiceHistory: arrayUnion(historyEntry), updatedAt: serverTimestamp()});
      // No need to setContract or setInvoiceStatus here, onSnapshot will handle.
      toast({ title: "Invoice Sent", description: `Invoice ${finalInvoiceNumber} sent to ${emailTo}.` });

    } catch (error: any) {
      console.error("Error sending invoice:", error);
      toast({ title: "Send Invoice Failed", description: error.message || "Could not send invoice email.", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const handleInitiatePayment = async () => {
    if (!contract || !user) {
      toast({ title: "Error", description: "Contract or user data missing.", variant: "destructive" });
      return;
    }
    if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
      toast({ title: "Stripe Error", description: "Stripe publishable key is not configured.", variant: "destructive" });
      return;
    }

    setIsFetchingClientSecret(true); setClientSecret(null);
    try {
      const idToken = await getUserIdToken();
      if (!idToken) throw new Error("Could not get user token for payment.");

      const response = await fetch(CREATE_PAYMENT_INTENT_FUNCTION_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`},
        body: JSON.stringify({
          amount: contract.amount, currency: 'usd', contractId: contract.id,
          clientEmail: editableClientEmail || contract.clientEmail || undefined,
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

  const handleDeliverableChange = (index: number, field: keyof EditableInvoiceLineItem, value: string | number) => {
    const newDeliverables = [...editableDeliverables];
    if (field === 'quantity' || field === 'unitPrice') {
        newDeliverables[index] = { ...newDeliverables[index], [field]: Number(value) < 0 ? 0 : Number(value) };
    } else {
        newDeliverables[index] = { ...newDeliverables[index], [field]: value as string };
    }
    setEditableDeliverables(newDeliverables);
  };

  const addDeliverable = () => setEditableDeliverables([...editableDeliverables, getDefaultLineItem()]);
  const removeDeliverable = (index: number) => {
    if (editableDeliverables.length > 1) {
      setEditableDeliverables(editableDeliverables.filter((_, i) => i !== index));
    } else {
      toast({title: "Cannot Remove", description: "You must have at least one line item.", variant: "default"});
    }
  };


  if (isLoadingContract || authLoading) {
    return <div className="space-y-4 p-4"><PageHeader title="Manage Invoice" description="Loading..." /><Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card></div>;
  }
  if (!contract) {
    return <div className="flex flex-col items-center justify-center h-full p-4"><AlertTriangle className="w-16 h-16 text-destructive mb-4" /><h2 className="text-2xl font-semibold mb-2">Contract Not Found</h2><Button asChild variant="outline" onClick={() => router.push('/contracts')}><Link href="/contracts"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link></Button></div>;
  }

  const canPay = (invoiceStatus === 'draft' || invoiceStatus === 'sent' || invoiceStatus === 'overdue') && contract.amount > 0 && !clientSecret;
  const canSend = !!invoiceHtmlContent && (invoiceStatus === 'draft' || invoiceStatus === 'none' || invoiceStatus === 'sent');
  const appearance = { theme: 'stripe' as const, variables: { colorPrimary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() }};
  const elementsOptions = clientSecret ? { clientSecret, appearance } : undefined;

  return (
    <>
      <PageHeader
        title={`Invoice for ${contract.brand} - ${contract.projectName || contract.id.substring(0,6)}`}
        description={editableInvoiceNumber ? `Invoice #: ${editableInvoiceNumber} | Status: ${invoiceStatus || 'None'}` : "Generate, edit, and manage the invoice."}
        actions={<Button variant="outline" asChild><Link href={`/contracts/${id}`}><ArrowLeft className="mr-2 h-4 w-4"/>Back to Contract</Link></Button>}
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Invoice Management</CardTitle>
            <CardDescription>Update invoice details, status, content, and process payments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <Label htmlFor="invoiceNumberInput">Invoice Number</Label>
                <Input id="invoiceNumberInput" value={editableInvoiceNumber} onChange={(e) => setEditableInvoiceNumber(e.target.value)} placeholder="e.g. INV-001" className="max-w-sm mt-1" disabled={isSaving || isSending || !!clientSecret || !isEditingDetails} />
              </div>
              <div>
                <Label htmlFor="invoiceStatusSelect">Invoice Status</Label>
                 <Select value={invoiceStatus || 'none'} onValueChange={(value) => handleStatusChange(value as Contract['invoiceStatus'])} disabled={isSaving || isLoadingContract || isSending || !!clientSecret || isEditingDetails}>
                  <SelectTrigger className="max-w-sm mt-1" id="invoiceStatusSelect"><SelectValue placeholder="Set Status" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="sent">Sent</SelectItem><SelectItem value="viewed">Viewed</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="overdue">Overdue</SelectItem></SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => handleGenerateInvoiceWithAI(false, contract, contractReceipts)} disabled={isGeneratingAi || isSaving || isFetchingClientSecret || isSending || !editableInvoiceNumber || !!clientSecret || isEditingDetails}>
                {isGeneratingAi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                {invoiceHtmlContent && contract?.editableInvoiceDetails ? "Re-generate with AI" : "Generate with AI"}
              </Button>
              <Button onClick={toggleEditMode} variant="outline" disabled={isSaving || isGeneratingAi || isSending || !!clientSecret || (!invoiceHtmlContent && !contract?.editableInvoiceDetails)}>
                {isEditingDetails ? <Eye className="mr-2 h-4 w-4" /> : <Edit className="mr-2 h-4 w-4" />}
                {isEditingDetails ? "Preview HTML" : "Edit Invoice Details"}
              </Button>
              <Button onClick={handleSaveInvoice} disabled={isSaving || isGeneratingAi || !editableInvoiceNumber || isFetchingClientSecret || isSending || !!clientSecret || !isEditingDetails}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Details & HTML
              </Button>
              {canSend && (
                <Button onClick={handleSendInvoice} disabled={isSending || isGeneratingAi || isSaving || isFetchingClientSecret || !!clientSecret || (!editableClientEmail && !contract.clientEmail) || isEditingDetails}>
                  {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Send to Client
                </Button>
              )}
               {canPay && (
                <Button onClick={handleInitiatePayment} disabled={isFetchingClientSecret || isGeneratingAi || isSaving || isSending || !stripePromise || isEditingDetails} variant="default">
                  {isFetchingClientSecret ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  Pay Invoice (${contract.amount.toLocaleString()})
                </Button>
              )}
            </div>
            {(!editableClientEmail && !contract.clientEmail) && canSend && (
                <p className="text-xs text-destructive">Client email is missing. Please add it to edit mode to enable sending.</p>
            )}
          </CardContent>
        </Card>

        {clientSecret && stripePromise && elementsOptions && (
          <Card>
            <CardHeader><CardTitle>Enter Payment Details</CardTitle><CardDescription>Securely enter your card information below.</CardDescription></CardHeader>
            <CardContent><Elements stripe={stripePromise} options={elementsOptions}><StripePaymentForm clientSecret={clientSecret} contractId={contract.id} /></Elements></CardContent>
          </Card>
        )}

        {isEditingDetails && !clientSecret && (
          <Card>
            <CardHeader><CardTitle>Edit Invoice Details</CardTitle><CardDescription>Modify the fields below. The HTML preview will update when you click "Preview HTML".</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div><Label htmlFor="edit-invNum">Invoice Number</Label><Input id="edit-invNum" value={editableInvoiceNumber} onChange={(e) => setEditableInvoiceNumber(e.target.value)} className="mt-1"/></div>
                <div><Label htmlFor="edit-invDate">Invoice Date</Label><Input id="edit-invDate" type="date" value={editableInvoiceDate} onChange={(e) => setEditableInvoiceDate(e.target.value)} className="mt-1"/></div>
                <div><Label htmlFor="edit-dueDate">Due Date</Label><Input id="edit-dueDate" type="date" value={editableDueDate} onChange={(e) => setEditableDueDate(e.target.value)} className="mt-1"/></div>
                <div><Label htmlFor="edit-projName">Project Name (Optional)</Label><Input id="edit-projName" value={editableProjectName} onChange={(e) => setEditableProjectName(e.target.value)} className="mt-1"/></div>
              </div>
              
              <div className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold mb-2">Creator Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    <div><Label htmlFor="edit-creatorName">Your Name/Company</Label><Input id="edit-creatorName" value={editableCreatorName} onChange={(e) => setEditableCreatorName(e.target.value)} className="mt-1"/></div>
                    <div><Label htmlFor="edit-creatorEmail">Your Email</Label><Input id="edit-creatorEmail" type="email" value={editableCreatorEmail} onChange={(e) => setEditableCreatorEmail(e.target.value)} className="mt-1"/></div>
                    <div className="md:col-span-2"><Label htmlFor="edit-creatorAddr">Your Address</Label><Textarea id="edit-creatorAddr" value={editableCreatorAddress} onChange={(e) => setEditableCreatorAddress(e.target.value)} rows={2} className="mt-1"/></div>
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold mb-2">Client Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    <div><Label htmlFor="edit-clientName">Client Name</Label><Input id="edit-clientName" value={editableClientName} onChange={(e) => setEditableClientName(e.target.value)} className="mt-1"/></div>
                    <div><Label htmlFor="edit-clientEmail">Client Email</Label><Input id="edit-clientEmail" type="email" value={editableClientEmail} onChange={(e) => setEditableClientEmail(e.target.value)} className="mt-1"/></div>
                    <div className="md:col-span-2"><Label htmlFor="edit-clientAddr">Client Address</Label><Textarea id="edit-clientAddr" value={editableClientAddress} onChange={(e) => setEditableClientAddress(e.target.value)} rows={2} className="mt-1"/></div>
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold mb-2">Invoice Line Items</h4>
                {editableDeliverables.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end mb-3 p-3 border rounded-md">
                    <div className="col-span-12 md:col-span-5"><Label htmlFor={`desc-${index}`}>Description</Label><Input id={`desc-${index}`} value={item.description} onChange={(e) => handleDeliverableChange(index, 'description', e.target.value)} className="mt-1"/></div>
                    <div className="col-span-6 md:col-span-2"><Label htmlFor={`qty-${index}`}>Quantity</Label><Input id={`qty-${index}`} type="number" value={item.quantity} min="0" onChange={(e) => handleDeliverableChange(index, 'quantity', parseFloat(e.target.value))} className="mt-1"/></div>
                    <div className="col-span-6 md:col-span-2"><Label htmlFor={`price-${index}`}>Unit Price</Label><Input id={`price-${index}`} type="number" value={item.unitPrice} min="0" step="0.01" onChange={(e) => handleDeliverableChange(index, 'unitPrice', parseFloat(e.target.value))} className="mt-1"/></div>
                    <div className="col-span-10 md:col-span-2"><Label>Total</Label><Input value={(item.quantity * item.unitPrice).toFixed(2)} readOnly disabled className="mt-1 bg-muted"/></div>
                    <div className="col-span-2 md:col-span-1"><Button type="button" variant="ghost" size="icon" onClick={() => removeDeliverable(index)} className="text-destructive hover:bg-destructive/10 w-full"><Trash2 className="h-4 w-4"/></Button></div>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addDeliverable} size="sm"><PlusCircle className="mr-2 h-4 w-4"/>Add Line Item</Button>
                <div className="text-right font-semibold text-lg mt-4">Total Amount: ${calculatedTotalAmount.toFixed(2)}</div>
              </div>

              <div className="border-t pt-4 mt-4">
                <Label htmlFor="edit-paymentInstr">Payment Instructions</Label>
                <Textarea id="edit-paymentInstr" value={editablePaymentInstructions} onChange={(e) => setEditablePaymentInstructions(e.target.value)} rows={3} className="mt-1"/>
              </div>
            </CardContent>
          </Card>
        )}

        {!clientSecret && !isEditingDetails && (
          invoiceHtmlContent ? (
            <Card>
              <CardHeader><CardTitle>Invoice HTML Preview</CardTitle><CardDescription>Current HTML. Copy or use browser print-to-PDF.</CardDescription></CardHeader>
              <CardContent><div className="prose dark:prose-invert max-w-none p-4 border rounded-md bg-background overflow-auto max-h-[60vh]" dangerouslySetInnerHTML={{ __html: invoiceHtmlContent }} /></CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader><CardTitle>No Invoice Content</CardTitle></CardHeader>
              <CardContent><p className="text-muted-foreground">Generate invoice with AI or switch to 'Edit Invoice Details' to manually create one.</p></CardContent>
            </Card>
          )
        )}
      </div>
    </>
  );
}


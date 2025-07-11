
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
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import { db, doc, getDoc, updateDoc, Timestamp, arrayUnion, serverTimestamp, collection, query, where, onSnapshot, getDocs } from '@/lib/firebase';
import { getFunctions, httpsCallableFromURL } from 'firebase/functions';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { StripePaymentForm } from '@/components/payments/stripe-payment-form';
import type { Contract, EditableInvoiceDetails, EditableInvoiceLineItem, Receipt as ReceiptType } from '@/types';
import { generateInvoiceHtml, type GenerateInvoiceHtmlInput } from '@/ai/flows/generate-invoice-html-flow';
import { ArrowLeft, FileText, Loader2, Wand2, Save, AlertTriangle, CreditCard, Send, Edit, Eye, PlusCircle, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';

const CREATE_PAYMENT_INTENT_FUNCTION_URL = "https://createpaymentintent-cpmccwbluq-uc.a.run.app";
const SEND_CONTRACT_NOTIFICATION_FUNCTION_URL = "https://sendcontractnotification-cpmccwbluq-uc.a.run.app";

const getDefaultLineItem = (): EditableInvoiceLineItem => ({ description: "", quantity: 1, unitPrice: 0 });

// Helper function defined outside the component
const buildDefaultEditableDetails = (
  currentContract: Contract,
  currentUser: UserProfile | null,
  currentId: string,
  currentEditableInvoiceNumber?: string
): EditableInvoiceDetails => {
  const baseDeliverables = currentContract.extractedTerms?.deliverables?.map((desc) => ({
    description: desc,
    quantity: 1,
    unitPrice: currentContract.extractedTerms?.deliverables && currentContract.extractedTerms.deliverables.length > 0 && currentContract.amount > 0 ? currentContract.amount / currentContract.extractedTerms.deliverables.length : currentContract.amount,
  })) || (currentContract.amount > 0 ? [{ description: currentContract.projectName || `Services for ${currentContract.brand}`, quantity: 1, unitPrice: currentContract.amount }] : [getDefaultLineItem()]);

  return {
    creatorName: currentUser?.displayName || "",
    creatorAddress: currentUser?.address || "",
    creatorEmail: currentUser?.email || "",
    clientName: currentContract.clientName || "",
    clientAddress: currentContract.clientAddress || "",
    clientEmail: currentContract.clientEmail || "",
    invoiceNumber: currentEditableInvoiceNumber || currentContract.invoiceNumber || `INV-${currentContract.brand?.substring(0,3).toUpperCase() || 'AAA'}-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${currentId.substring(0,4).toUpperCase()}`,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: currentContract.dueDate || new Date().toISOString().split('T')[0],
    projectName: currentContract.projectName || "",
    deliverables: baseDeliverables,
    paymentInstructions: currentContract.paymentInstructions || "",
  };
};

const calculateTotal = (items: EditableInvoiceLineItem[]): number => {
  return items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
};


export default function ManageInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, isLoading: authLoading, getUserIdToken } = useAuth();
  const { toast } = useToast();

  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoadingContract, setIsLoadingContract] = useState(true);
  const [contractReceipts, setContractReceipts] = useState<Array<{url: string; description?: string;}>>([]);
  
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

  const [invoiceHtmlContent, setInvoiceHtmlContent] = useState<string>("");
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
  
  useEffect(() => {
    setCalculatedTotalAmount(calculateTotal(editableDeliverables));
  }, [editableDeliverables]);

  const populateFormFromEditableDetails = useCallback((details: EditableInvoiceDetails, contractDataToUse?: Contract, userDataToUse?: UserProfile | null) => {
    setEditableCreatorName(details.creatorName || userDataToUse?.displayName || "");
    setEditableCreatorAddress(details.creatorAddress || userDataToUse?.address || "");
    setEditableCreatorEmail(details.creatorEmail || userDataToUse?.email || "");
    setEditableClientName(details.clientName || contractDataToUse?.clientName || "");
    setEditableClientAddress(details.clientAddress || contractDataToUse?.clientAddress || "");
    setEditableClientEmail(details.clientEmail || contractDataToUse?.clientEmail || "");
    setEditableInvoiceNumber(details.invoiceNumber);
    setEditableInvoiceDate(details.invoiceDate);
    setEditableDueDate(details.dueDate);
    setEditableProjectName(details.projectName || contractDataToUse?.projectName || "");
    setEditableDeliverables(details.deliverables && details.deliverables.length > 0 ? details.deliverables.map(d => ({...d})) : [getDefaultLineItem()]);
    setEditablePaymentInstructions(details.paymentInstructions || contractDataToUse?.paymentInstructions || "");
  }, [setEditableCreatorName, setEditableCreatorAddress, setEditableCreatorEmail, setEditableClientName, setEditableClientAddress, setEditableClientEmail, setEditableInvoiceNumber, setEditableInvoiceDate, setEditableDueDate, setEditableProjectName, setEditableDeliverables, setEditablePaymentInstructions]);

  const getStructuredDataFromForm = useCallback((): EditableInvoiceDetails => ({
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
    deliverables: editableDeliverables.map(d => ({...d})), 
    paymentInstructions: editablePaymentInstructions,
  }), [editableCreatorName, editableCreatorAddress, editableCreatorEmail, editableClientName, editableClientAddress, editableClientEmail, editableInvoiceNumber, editableInvoiceDate, editableDueDate, editableProjectName, editableDeliverables, editablePaymentInstructions]);

  const generateAndSetHtmlFromForm = useCallback(async (detailsToUse: EditableInvoiceDetails, receiptsToUse: Array<{url: string; description?: string;}>, contractIdToUse: string) => {
    const totalAmount = calculateTotal(detailsToUse.deliverables);
    const currentPayUrl = typeof window !== 'undefined' ? `${window.location.origin}/pay/contract/${contractIdToUse}` : "";
    
    const inputForAI: GenerateInvoiceHtmlInput = {
      ...detailsToUse,
      contractId: contractIdToUse,
      totalAmount: totalAmount,
      deliverables: detailsToUse.deliverables.map(d => ({ ...d, total: d.quantity * d.unitPrice })),
      payInvoiceLink: currentPayUrl || undefined,
      receipts: receiptsToUse.length > 0 ? receiptsToUse.map(r => ({ url: r.url, description: r.description || "Receipt" })) : undefined,
    };

    try {
      const result = await generateInvoiceHtml(inputForAI);
      setInvoiceHtmlContent(result.invoiceHtml);
    } catch (error) {
      console.error("Error generating HTML from form data:", error);
      toast({ title: "Preview Error", description: "Could not generate HTML preview from current details.", variant: "destructive" });
      setInvoiceHtmlContent("<p>Error generating preview.</p>");
    }
  }, [toast, setInvoiceHtmlContent]); 

  const handleInitialAiGeneration = useCallback(async (
    initialContractData: Contract,
    initialReceiptsData: Array<{url: string; description?: string;}>,
    currentUserData: UserProfile | null,
    currentContractId: string,
    currentInvNum?: string
  ) => {
    if (!initialContractData || !currentUserData) return;

    setIsGeneratingAi(true);
    try {
        const aiInputDetails = buildDefaultEditableDetails(initialContractData, currentUserData, currentContractId, currentInvNum);
        populateFormFromEditableDetails(aiInputDetails, initialContractData, currentUserData);
        await generateAndSetHtmlFromForm(aiInputDetails, initialReceiptsData, currentContractId);
        toast({ title: "Invoice Drafted by AI", description: "Review and edit as needed before saving or sending." });
    } catch (error) {
        console.error("Error in handleInitialAiGeneration:", error);
        toast({ title: "AI Generation Failed", description: "Could not generate initial invoice draft.", variant: "destructive" });
    } finally {
        setIsGeneratingAi(false);
    }
  }, [populateFormFromEditableDetails, generateAndSetHtmlFromForm, toast]);
  
  const handleAiRegenerationRequest = useCallback(async () => {
    if (!contract || !user) {
        toast({ title: "Cannot Generate", description: "Contract or user details missing.", variant: "destructive" });
        return;
    }
    if (!editableInvoiceNumber) {
        toast({ title: "Cannot Generate", description: "Invoice number missing. Please ensure it's set.", variant: "destructive" });
        return;
    }
    
    setIsGeneratingAi(true);
    try {
        const receiptsCol = collection(db, 'receipts');
        const qFreshReceipts = query(receiptsCol, where('userId', '==', user.uid), where('linkedContractId', '==', contract.id));
        const freshReceiptSnapshot = await getDocs(qFreshReceipts);
        const freshReceipts = freshReceiptSnapshot.docs.map(docSnap => {
            const receiptData = docSnap.data() as ReceiptType;
            return { url: receiptData.receiptImageUrl, description: receiptData.description || receiptData.receiptFileName || "Uploaded Receipt" };
        });
        setContractReceipts(freshReceipts); 
        
        await handleInitialAiGeneration(contract, freshReceipts, user, contract.id, editableInvoiceNumber);
        setIsEditingDetails(false); 
    } catch (error) {
        console.error("Error during AI re-generation request:", error);
        toast({ title: "AI Re-generation Failed", description: "Could not re-generate invoice draft.", variant: "destructive" });
    } finally {
        setIsGeneratingAi(false);
    }
  }, [contract, user, toast, handleInitialAiGeneration, editableInvoiceNumber, setContractReceipts]);

  useEffect(() => {
    if (!id || !user?.uid || authLoading) {
      if (!authLoading && !user?.uid) router.push('/login');
      setIsLoadingContract(id ? true : false);
      return;
    }

    let isMounted = true;
    let unsubscribeReceipts: (() => void) | undefined = undefined;
    setIsLoadingContract(true);

    const loadInitialData = async () => {
      try {
        const contractDocRef = doc(db, 'contracts', id);
        const contractSnap = await getDoc(contractDocRef);

        if (!isMounted) return;

        if (contractSnap.exists() && contractSnap.data()?.userId === user.uid) {
          const contractData = { ...contractSnap.data(), id: contractSnap.id } as Contract;
          setContract(contractData);
          setInvoiceStatus(contractData.invoiceStatus || 'none');
          const currentPayUrlValue = typeof window !== 'undefined' ? `${window.location.origin}/pay/contract/${id}` : "";
          setPayUrl(currentPayUrlValue);

          const receiptsCol = collection(db, 'receipts');
          const qReceipts = query(receiptsCol, where('userId', '==', user.uid), where('linkedContractId', '==', id));
          
          // Initial fetch for receipts to be used if AI generation is needed
          const initialReceiptSnapshot = await getDocs(qReceipts);
          const initialFetchedReceipts = initialReceiptSnapshot.docs.map(docSnap => {
            const receiptData = docSnap.data() as ReceiptType;
            return { url: receiptData.receiptImageUrl, description: receiptData.description || receiptData.receiptFileName || "Uploaded Receipt" };
          });
          
          if (isMounted) {
            setContractReceipts(initialFetchedReceipts); // Set receipts state first
          }

          // Logic for setting initial HTML content or generating AI
          if (contractData.invoiceHtmlContent) {
            setInvoiceHtmlContent(contractData.invoiceHtmlContent);
            const detailsToPopulate = contractData.editableInvoiceDetails || buildDefaultEditableDetails(contractData, user, id, contractData.invoiceNumber);
            populateFormFromEditableDetails(detailsToPopulate, contractData, user);
          } else if (contractData.editableInvoiceDetails) {
            populateFormFromEditableDetails(contractData.editableInvoiceDetails, contractData, user);
            await generateAndSetHtmlFromForm(contractData.editableInvoiceDetails, initialFetchedReceipts, id);
          } else if (contractData.amount > 0) {
            // AI generation if no content and amount exists
            await handleInitialAiGeneration(contractData, initialFetchedReceipts, user, id, contractData.invoiceNumber);
          } else {
            // No content, no details, no amount - just set defaults and empty HTML
            const defaultDetails = buildDefaultEditableDetails(contractData, user, id, contractData.invoiceNumber);
            populateFormFromEditableDetails(defaultDetails, contractData, user);
            setInvoiceHtmlContent("");
          }
          
          // Setup real-time listener for receipts AFTER initial data processing
          unsubscribeReceipts = onSnapshot(qReceipts, (snapshot) => {
            if (!isMounted) return;
            const fetchedReceiptsUpdate = snapshot.docs.map(docSnap => {
              const receiptData = docSnap.data() as ReceiptType;
              return { url: receiptData.receiptImageUrl, description: receiptData.description || receiptData.receiptFileName || "Uploaded Receipt"};
            });
            if(isMounted) setContractReceipts(fetchedReceiptsUpdate);
          }, (error) => {
            console.error("Error listening to receipts:", error);
            if(isMounted) toast({ title: "Receipts Sync Error", description: "Could not get real-time receipt updates.", variant: "default" });
          });

        } else {
          toast({ title: "Error", description: "Contract not found or access denied.", variant: "destructive" });
          router.push('/contracts');
        }
      } catch (error) {
        console.error("Error fetching initial contract data:", error);
        if (isMounted) toast({ title: "Fetch Error", description: "Could not load contract details.", variant: "destructive" });
      } finally {
        if (isMounted) setIsLoadingContract(false);
      }
    };

    loadInitialData();
    return () => { 
      isMounted = false; 
      if (unsubscribeReceipts) unsubscribeReceipts();
    };
  }, [id, user?.uid, authLoading, router, toast, populateFormFromEditableDetails, generateAndSetHtmlFromForm, handleInitialAiGeneration]);

  const toggleEditMode = useCallback(async () => {
    if (isEditingDetails) { 
      if (contract && user) {
        const currentFormData = getStructuredDataFromForm();
        setIsGeneratingAi(true); 
        await generateAndSetHtmlFromForm(currentFormData, contractReceipts, contract.id);
        setIsGeneratingAi(false);
      }
    } else { 
      if (contract && user) {
        const detailsToPopulate = contract.editableInvoiceDetails || buildDefaultEditableDetails(contract, user, contract.id, contract.invoiceNumber);
        populateFormFromEditableDetails(detailsToPopulate, contract, user);
      }
    }
    setIsEditingDetails(prev => !prev);
  }, [isEditingDetails, contract, user, contractReceipts, getStructuredDataFromForm, generateAndSetHtmlFromForm, populateFormFromEditableDetails]);
  
  const handleSaveInvoice = async () => {
    if (!contract || !editableInvoiceNumber) {
      toast({ title: "Cannot Save", description: "Invoice number or core contract data missing.", variant: "destructive" });
      return;
    }
    if (!user) {
      toast({ title: "Authentication Error", description: "User not authenticated.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const currentFormData = getStructuredDataFromForm();
      const finalTotalAmount = calculateTotal(currentFormData.deliverables);
      
      const currentPayUrl = typeof window !== 'undefined' ? `${window.location.origin}/pay/contract/${contract.id}` : "";
      const inputForAI: GenerateInvoiceHtmlInput = {
        ...currentFormData,
        contractId: contract.id,
        totalAmount: finalTotalAmount,
        deliverables: currentFormData.deliverables.map(d => ({...d, total: d.quantity * d.unitPrice})),
        payInvoiceLink: currentPayUrl || undefined,
        receipts: contractReceipts.length > 0 ? contractReceipts.map(r => ({ url: r.url, description: r.description || "Receipt" })) : undefined,
      };
      const htmlResult = await generateInvoiceHtml(inputForAI);
      const finalHtmlToSave = htmlResult.invoiceHtml;
      setInvoiceHtmlContent(finalHtmlToSave); 

      const contractDocRef = doc(db, 'contracts', contract.id);
      const newStatus = (contract.invoiceStatus === 'none' || !contract.invoiceStatus) ? 'draft' : contract.invoiceStatus;
      
      const historyEntry = {
        timestamp: Timestamp.now(),
        action: "Invoice Details Updated",
        details: `Invoice #: ${editableInvoiceNumber}. Status: ${newStatus}. Total: $${finalTotalAmount.toFixed(2)}`,
      };

      const updatesToSave: Partial<Contract> = { 
        invoiceHtmlContent: finalHtmlToSave,
        invoiceNumber: editableInvoiceNumber,
        invoiceStatus: newStatus, 
        editableInvoiceDetails: currentFormData, 
        amount: finalTotalAmount, 
        invoiceHistory: arrayUnion(historyEntry) as any, 
        updatedAt: serverTimestamp() as Timestamp, 
      };

      await updateDoc(contractDocRef, updatesToSave);
      
      setInvoiceStatus(newStatus); 
      setIsEditingDetails(false); 
      setContract(prev => prev ? ({
        ...prev, 
        invoiceHtmlContent: finalHtmlToSave, 
        editableInvoiceDetails: currentFormData, 
        amount: finalTotalAmount, 
        invoiceStatus: newStatus, 
        invoiceNumber: editableInvoiceNumber 
      }) : null);

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
      const historyEntry = {
        timestamp: Timestamp.now(),
        action: `Invoice Status Changed to ${newStatusValue}`,
         details: `Previous status: ${invoiceStatus}`,
      };
      await updateDoc(contractDocRef, {
        invoiceStatus: newStatusValue,
        invoiceHistory: arrayUnion(historyEntry),
        updatedAt: serverTimestamp(),
      });
      setInvoiceStatus(newStatusValue);
      toast({ title: "Status Updated", description: `Invoice status changed to ${newStatusValue}.` });
    } catch (error) {
      console.error("Error updating status:", error);
      toast({ title: "Update Failed", description: "Could not update invoice status.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInvoice = async () => {
    if (!contract || !user) {
      toast({ title: "Cannot Send", description: "No contract or user session available.", variant: "destructive" });
      return;
    }
    const finalClientEmail = editableClientEmail || contract.clientEmail;
    if (!finalClientEmail) {
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

      const finalClientName = editableClientName || contract.clientName || contract.brand;
      const finalProjectName = editableProjectName || contract.projectName || 'services rendered';
      const finalInvoiceNumber = editableInvoiceNumber || contract.invoiceNumber;
      const finalDueDate = editableDueDate || contract.dueDate || new Date().toISOString().split('T')[0];
      const finalCreatorName = editableCreatorName || user.displayName || 'Your Service Provider';
      
      const currentFormData = getStructuredDataFromForm();
      const totalAmountForEmail = calculateTotal(currentFormData.deliverables);

      const currentPayUrlForEmail = typeof window !== 'undefined' ? `${window.location.origin}/pay/contract/${contract.id}` : "";
      const inputForAISend: GenerateInvoiceHtmlInput = {
        ...currentFormData,
        contractId: contract.id,
        totalAmount: totalAmountForEmail,
        deliverables: currentFormData.deliverables.map(d => ({...d, total: d.quantity * d.unitPrice})),
        payInvoiceLink: currentPayUrlForEmail || undefined,
        receipts: contractReceipts.length > 0 ? contractReceipts.map(r => ({ url: r.url, description: r.description || "Receipt" })) : undefined,
      };
      const htmlResultForSend = await generateInvoiceHtml(inputForAISend);
      const htmlToSend = htmlResultForSend.invoiceHtml;

      const emailBody = {
        to: finalClientEmail,
        subject: `Invoice ${finalInvoiceNumber} from ${finalCreatorName}`,
        text: `Hello ${finalClientName},\n\nPlease find attached your invoice ${finalInvoiceNumber} for ${finalProjectName}.\n\nTotal Amount Due: $${totalAmountForEmail.toFixed(2)}\nDue Date: ${new Date(finalDueDate + 'T00:00:00').toLocaleDateString()}\n\nClick here to pay: ${currentPayUrlForEmail}\n\nThank you,\n${finalCreatorName}`,
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
      const historyEntry = { timestamp: Timestamp.now(), action: 'Invoice Sent to Client', details: `To: ${finalClientEmail}`};
      
      const updatesToSave: Partial<Contract> = { 
        invoiceStatus: 'sent', 
        invoiceHistory: arrayUnion(historyEntry) as any, 
        updatedAt: serverTimestamp() as Timestamp, 
        invoiceHtmlContent: htmlToSend,
        editableInvoiceDetails: currentFormData, 
        amount: totalAmountForEmail,
      };
      await updateDoc(contractDocRef, updatesToSave);

      setInvoiceStatus('sent');
      setInvoiceHtmlContent(htmlToSend); 
      setContract(prev => prev ? ({
        ...prev, 
        invoiceStatus: 'sent', 
        invoiceHtmlContent: htmlToSend, 
        editableInvoiceDetails: currentFormData, 
        amount: totalAmountForEmail 
      }) : null);

      toast({ title: "Invoice Sent", description: `Invoice ${finalInvoiceNumber} sent to ${finalClientEmail}.` });

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
    return <div className="flex flex-col items-center justify-center h-full p-4"><AlertTriangle className="w-16 h-16 text-destructive mb-4" /><h2 className="text-2xl font-semibold mb-2">Contract Not Found</h2><Button asChild variant="outline" onClick={() => router.push('/contracts')}><Link href="/contracts"><ArrowLeft className="mr-2 h-4 w-4"/>Back</Link></Button></div>;
  }

  const canPay = (invoiceStatus === 'draft' || invoiceStatus === 'sent' || invoiceStatus === 'overdue') && contract.amount > 0 && !clientSecret;
  const canSend = !!invoiceHtmlContent && (invoiceStatus === 'draft' || invoiceStatus === 'none' || invoiceStatus === 'sent');
  const appearance = { theme: 'stripe' as const, variables: { colorPrimary: '#3F8CFF' }}; 
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
              <Button 
                onClick={handleAiRegenerationRequest} 
                disabled={isGeneratingAi || isSaving || isFetchingClientSecret || isSending || !editableInvoiceNumber || !!clientSecret}
              >
                {isGeneratingAi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Re-generate with AI
              </Button>
              <Button onClick={toggleEditMode} variant="outline" disabled={isSaving || isGeneratingAi || isSending || !!clientSecret}>
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
              <CardContent><p className="text-muted-foreground">
                {isLoadingContract || isGeneratingAi ? <Loader2 className="inline animate-spin mr-2 h-4 w-4" /> : ''}
                {isLoadingContract ? 'Loading contract data...' : 
                 isGeneratingAi ? 'Generating AI preview...' : 
                 'Click "Re-generate with AI" to start, or switch to \'Edit Invoice Details\' to manually create one.'}
              </p></CardContent>
            </Card>
          )
        )}
      </div>
    </>
  );
}
    

    



    

    

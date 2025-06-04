
"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, updateDoc, Timestamp, arrayUnion, serverTimestamp } from '@/lib/firebase';
import { getFunctions, httpsCallableFromURL } from 'firebase/functions';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { StripePaymentForm } from '@/components/payments/stripe-payment-form';
import type { Contract } from '@/types';
import { generateInvoiceHtml, type GenerateInvoiceHtmlInput } from '@/ai/flows/generate-invoice-html-flow';
import { ArrowLeft, FileText, Loader2, Wand2, Save, AlertTriangle, CreditCard, Send } from 'lucide-react';
import Link from 'next/link';

const CREATE_PAYMENT_INTENT_FUNCTION_URL = "https://createpaymentintent-yzlih5wcva-uc.a.run.app";
const SEND_CONTRACT_NOTIFICATION_FUNCTION_URL = "https://sendcontractnotification-yzlih5wcva-uc.a.run.app";


export default function ManageInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, isLoading: authLoading, getUserIdToken } = useAuth();
  const { toast } = useToast();

  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoadingContract, setIsLoadingContract] = useState(true);
  const [generatedInvoiceHtml, setGeneratedInvoiceHtml] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");
  const [invoiceStatus, setInvoiceStatus] = useState<Contract['invoiceStatus']>('none');
  const [isGenerating, setIsGenerating] = useState(false);
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
      toast({ title: "Stripe Error", description: "Stripe publishable key is not configured. Payment functionality will be disabled.", variant: "destructive", duration: 9000 });
    }
  }, [toast]);

  useEffect(() => {
    if (id && user && !authLoading) {
      setIsLoadingContract(true);
      const fetchContract = async () => {
        try {
          const contractDocRef = doc(db, 'contracts', id);
          const contractSnap = await getDoc(contractDocRef);
          if (contractSnap.exists() && contractSnap.data().userId === user.uid) {
            const data = contractSnap.data() as Contract;
            setContract({ ...data, id: contractSnap.id });
            if (data.invoiceHtmlContent) {
              setGeneratedInvoiceHtml(data.invoiceHtmlContent);
            }
            setInvoiceNumber(data.invoiceNumber || `INV-${data.brand?.substring(0,3).toUpperCase() || 'AAA'}-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${id.substring(0,4).toUpperCase()}`);
            setInvoiceStatus(data.invoiceStatus || 'none');
             if (typeof window !== 'undefined') {
              setPayUrl(`${window.location.origin}/pay/contract/${id}`);
            }
          } else {
            toast({ title: "Error", description: "Contract not found or access denied.", variant: "destructive" });
            router.push('/contracts');
          }
        } catch (error) {
          console.error("Error fetching contract:", error);
          toast({ title: "Fetch Error", description: "Could not load contract details.", variant: "destructive" });
        } finally {
          setIsLoadingContract(false);
        }
      };
      fetchContract();
    } else if (!authLoading && !user) {
      router.push('/login');
    }
  }, [id, user, authLoading, router, toast]);


  const handleGenerateInvoice = async () => {
    if (!contract || !user || !invoiceNumber) {
        toast({ title: "Cannot Generate", description: "Contract details or invoice number missing.", variant: "destructive" });
        return;
    }
    setIsGenerating(true);
    try {
      const deliverablesForAI = contract.extractedTerms?.deliverables?.map((desc) => ({
        description: desc,
        quantity: 1,
        unitPrice: contract.extractedTerms?.deliverables && contract.extractedTerms.deliverables.length > 0 ? contract.amount / contract.extractedTerms.deliverables.length : contract.amount,
        total: contract.extractedTerms?.deliverables && contract.extractedTerms.deliverables.length > 0 ? contract.amount / contract.extractedTerms.deliverables.length : contract.amount,
      })) || [{ description: contract.projectName || `Services for ${contract.brand}`, quantity: 1, unitPrice: contract.amount, total: contract.amount }];

      const currentPayUrl = typeof window !== 'undefined' ? `${window.location.origin}/pay/contract/${id}` : "";


      const input: GenerateInvoiceHtmlInput = {
        creatorName: user.displayName || undefined,
        creatorAddress: user.address || undefined,
        creatorEmail: user.email || undefined,
        clientName: contract.clientName || undefined,
        clientAddress: contract.clientAddress || undefined,
        clientEmail: contract.clientEmail || undefined,
        invoiceNumber: invoiceNumber,
        invoiceDate: new Date().toISOString().split('T')[0],
        dueDate: contract.dueDate,
        contractId: contract.id,
        projectName: contract.projectName || undefined,
        deliverables: deliverablesForAI,
        totalAmount: contract.amount,
        paymentInstructions: contract.paymentInstructions || undefined,
        payInvoiceLink: currentPayUrl || undefined,
      };
      const result = await generateInvoiceHtml(input);
      setGeneratedInvoiceHtml(result.invoiceHtml);
      toast({ title: "Invoice Generated", description: "AI has generated the invoice HTML." });
    } catch (error) {
      console.error("Error generating invoice:", error);
      toast({ title: "Generation Failed", description: "Could not generate invoice with AI.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveInvoice = async () => {
    if (!contract || !generatedInvoiceHtml || !invoiceNumber) {
      toast({ title: "Cannot Save", description: "No invoice HTML or number to save.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const contractDocRef = doc(db, 'contracts', contract.id);
      const newStatus = invoiceStatus === 'none' ? 'draft' : invoiceStatus;

      const historyEntry = {
        timestamp: Timestamp.now(),
        action: `Invoice Saved (Status: ${newStatus})`,
        details: `Invoice number: ${invoiceNumber}`,
      };

      await updateDoc(contractDocRef, {
        invoiceHtmlContent: generatedInvoiceHtml,
        invoiceNumber: invoiceNumber,
        invoiceStatus: newStatus,
        invoiceHistory: arrayUnion(historyEntry),
        updatedAt: serverTimestamp(),
      });
      setContract(prev => prev ? {...prev, invoiceHtmlContent: generatedInvoiceHtml, invoiceNumber: invoiceNumber, invoiceStatus: newStatus } : null);
      setInvoiceStatus(newStatus);
      toast({ title: "Invoice Saved", description: "Invoice details have been saved." });
      console.log('SIMULATE_LOG: Invoice generated/updated for contract ID:', contract.id, 'Invoice Number:', invoiceNumber);
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
      setContract(prev => prev ? {...prev, invoiceStatus: newStatus} : null);
      setInvoiceStatus(newStatus);
      toast({ title: "Status Updated", description: `Invoice status changed to ${newStatus}.` });
      console.log('SIMULATE_LOG: Invoice status changed to', newStatus, 'for contract ID:', contract.id);
    } catch (error) {
      console.error("Error updating status:", error);
      toast({ title: "Update Failed", description: "Could not update invoice status.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInvoice = async () => {
    if (!contract || (!generatedInvoiceHtml && !contract.invoiceHtmlContent) || !user) {
      toast({ title: "Cannot Send", description: "No invoice content or user session available.", variant: "destructive" });
      return;
    }
    if (!contract.clientEmail) {
      toast({ title: "Missing Client Email", description: "Client email is required to send an invoice. Please add it to the contract.", variant: "destructive" });
      return;
    }

    setIsSending(true);
    try {
      const idToken = await getUserIdToken();
      if (!idToken) {
        toast({ title: "Authentication Error", description: "Could not get user token. Please try again.", variant: "destructive" });
        setIsSending(false);
        return;
      }

      const invoiceContentToSend = generatedInvoiceHtml || contract.invoiceHtmlContent;
      const currentPayUrl = typeof window !== 'undefined' ? `${window.location.origin}/pay/contract/${id}` : "";

      const emailBody = {
        to: contract.clientEmail,
        subject: `Invoice ${invoiceNumber || contract.invoiceNumber} from ${user.displayName || 'Your Service Provider'}`,
        text: `Hello ${contract.clientName || contract.brand},\n\nPlease find attached your invoice ${invoiceNumber || contract.invoiceNumber} for ${contract.projectName || 'services rendered'}.\n\nTotal Amount Due: $${contract.amount}\nDue Date: ${new Date(contract.dueDate).toLocaleDateString()}\n\nClick here to pay: ${currentPayUrl}\n\nThank you,\n${user.displayName || 'Your Service Provider'}`,
        html: invoiceContentToSend,
        contractId: contract.id,
      };

      const response = await fetch(SEND_CONTRACT_NOTIFICATION_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(emailBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Server returned an error, but failed to parse its response." }));
        // The root cause is likely in the backend's `sendContractNotification` function (e.g., Firestore write error with serverTimestamp in arrayUnion).
        // This frontend code correctly reports the failure from the backend.
        const detailedErrorMessage = `Server error: ${errorData.message || `Failed to send email. Status: ${response.status}`}`;
        toast({ title: "Send Invoice Failed", description: detailedErrorMessage, variant: "destructive", duration: 7000 });
        throw new Error(detailedErrorMessage);
      }

      // If backend is responsible for history and status update, this client-side update might be redundant
      // or could be done optimistically / after a re-fetch. For now, keeping it.
      const contractDocRef = doc(db, 'contracts', contract.id);
      const historyEntry = {
        timestamp: Timestamp.now(),
        action: 'Invoice Sent to Client',
        details: `To: ${contract.clientEmail}`,
      };
      await updateDoc(contractDocRef, {
        invoiceStatus: 'sent',
        invoiceHistory: arrayUnion(historyEntry),
        updatedAt: serverTimestamp(),
      });
      setContract(prev => prev ? {...prev, invoiceStatus: 'sent' } : null);
      setInvoiceStatus('sent');
      toast({ title: "Invoice Sent", description: `Invoice ${invoiceNumber} sent to ${contract.clientEmail}.` });

    } catch (error: any) {
      console.error("Error sending invoice:", error);
      // The toast for backend failure is now handled above if response.ok is false
      // This catch block will handle other errors (e.g., network issues before fetch, getUserIdToken failure)
      if (!String(error.message).startsWith("Server error:")) {
         toast({ title: "Send Invoice Failed", description: error.message || "Could not send invoice email.", variant: "destructive" });
      }
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
      console.error("Stripe publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) is missing.");
      return;
    }

    setIsFetchingClientSecret(true);
    setClientSecret(null);

    try {
      const idToken = await getUserIdToken();
      if (!idToken) {
        toast({ title: "Authentication Error", description: "Could not get user token for payment. Please try again.", variant: "destructive" });
        setIsFetchingClientSecret(false);
        return;
      }

      const response = await fetch(CREATE_PAYMENT_INTENT_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          amount: contract.amount, // amount in cents
          currency: 'usd',
          contractId: contract.id,
          clientEmail: contract.clientEmail || undefined, // Pass clientEmail for metadata
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to create payment intent. Status: ${response.status}`);
      }

      const { clientSecret: receivedClientSecret } = await response.json();

      if (!receivedClientSecret) {
        throw new Error("Client secret not received from payment intent function.");
      }

      setClientSecret(receivedClientSecret);
      toast({ title: "Payment Form Ready", description: "Please enter your card details below." });

    } catch (error: any) {
      console.error("Payment intent creation error:", error);
      toast({ title: "Payment Setup Failed", description: error.message || "Could not initiate payment.", variant: "destructive" });
      setClientSecret(null);
    } finally {
      setIsFetchingClientSecret(false);
    }
  };

  if (isLoadingContract || authLoading) {
    return (
      <div className="space-y-4 p-4">
        <PageHeader title="Manage Invoice" description="Loading contract details..." />
        <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Contract Not Found</h2>
        <Button asChild variant="outline" onClick={() => router.push('/contracts')}>
         <Link href="/contracts"> <ArrowLeft className="mr-2 h-4 w-4" /> Back to Contracts </Link>
        </Button>
      </div>
    );
  }

  const canPay = (invoiceStatus === 'draft' || invoiceStatus === 'sent' || invoiceStatus === 'overdue') && contract.amount > 0 && !clientSecret;
  const canSendInvoice = (!!generatedInvoiceHtml || !!contract.invoiceHtmlContent) && (invoiceStatus === 'draft' || invoiceStatus === 'none' || invoiceStatus === 'sent');


  const appearance = {
    theme: 'stripe' as const,
    variables: {
      colorPrimary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    },
  };
  const elementsOptions = clientSecret ? { clientSecret, appearance } : undefined;


  return (
    <>
      <PageHeader
        title={`Invoice for ${contract.brand} - ${contract.projectName || contract.id}`}
        description={contract.invoiceNumber ? `Invoice #: ${contract.invoiceNumber} | Status: ${invoiceStatus || 'None'}` : "Generate and manage the invoice for this contract."}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/contracts/${id}`}> <ArrowLeft className="mr-2 h-4 w-4" /> Back to Contract </Link>
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Invoice Management</CardTitle>
            <CardDescription>
              Update invoice details, status, and process payments.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label htmlFor="invoiceNumberInput" className="block text-sm font-medium text-muted-foreground mb-1">Invoice Number</label>
                <Input
                  id="invoiceNumberInput"
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Enter Invoice Number (e.g. INV-001)"
                  className="max-w-sm"
                />
              </div>
              <div>
                <label htmlFor="invoiceStatusSelect" className="block text-sm font-medium text-muted-foreground mb-1">Invoice Status</label>
                 <Select
                    value={invoiceStatus || 'none'}
                    onValueChange={(value) => handleStatusChange(value as Contract['invoiceStatus'])}
                    disabled={isSaving || isLoadingContract || isSending || !!clientSecret}
                  >
                  <SelectTrigger className="max-w-sm" id="invoiceStatusSelect">
                    <SelectValue placeholder="Set Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="viewed">Viewed</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={handleGenerateInvoice} disabled={isGenerating || isSaving || isFetchingClientSecret || isSending || !invoiceNumber || !!clientSecret}>
                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                {generatedInvoiceHtml || contract.invoiceHtmlContent ? "Re-generate with AI" : "Generate with AI"}
              </Button>
              <Button onClick={handleSaveInvoice} disabled={isSaving || !generatedInvoiceHtml || !invoiceNumber || isFetchingClientSecret || isSending || !!clientSecret}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Invoice
              </Button>
              {canSendInvoice && (
                <Button onClick={handleSendInvoice} disabled={isSending || isGenerating || isSaving || isFetchingClientSecret || !!clientSecret || !contract.clientEmail}>
                  {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Send to Client
                </Button>
              )}
               {canPay && (
                <Button onClick={handleInitiatePayment} disabled={isFetchingClientSecret || isGenerating || isSaving || isSending || !stripePromise} variant="default">
                  {isFetchingClientSecret ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  Pay Invoice (${contract.amount.toLocaleString()})
                </Button>
              )}
            </div>
            {!contract.clientEmail && canSendInvoice && (
                <p className="text-xs text-destructive">Client email is missing. Please add it to the contract to enable sending.</p>
            )}
             {!contract.clientEmail && (invoiceStatus === 'draft' || invoiceStatus === 'none') && !canSendInvoice && (
                <p className="text-xs text-orange-600 dark:text-orange-400">Tip: Add a client email to the contract to enable sending the invoice.</p>
            )}
          </CardContent>
        </Card>

        {clientSecret && stripePromise && elementsOptions && (
          <Card>
            <CardHeader>
              <CardTitle>Enter Payment Details</CardTitle>
              <CardDescription>Securely enter your card information below.</CardDescription>
            </CardHeader>
            <CardContent>
              <Elements stripe={stripePromise} options={elementsOptions}>
                <StripePaymentForm clientSecret={clientSecret} contractId={contract.id} />
              </Elements>
            </CardContent>
          </Card>
        )}


        {generatedInvoiceHtml && !clientSecret && (
          <Card>
            <CardHeader> <CardTitle>Invoice Preview</CardTitle> <CardDescription>This is the HTML content of your invoice. You can copy it or use browser print-to-PDF.</CardDescription> </CardHeader>
            <CardContent> <div className="prose dark:prose-invert max-w-none p-4 border rounded-md bg-background overflow-auto max-h-[60vh]" dangerouslySetInnerHTML={{ __html: generatedInvoiceHtml }} /> </CardContent>
          </Card>
        )}
         {!generatedInvoiceHtml && contract.invoiceHtmlContent && !clientSecret && (
           <Card>
            <CardHeader> <CardTitle>Previously Saved Invoice</CardTitle> </CardHeader>
            <CardContent> <div className="prose dark:prose-invert max-w-none p-4 border rounded-md bg-background overflow-auto max-h-[60vh]" dangerouslySetInnerHTML={{ __html: contract.invoiceHtmlContent }} />
               <Button onClick={handleGenerateInvoice} disabled={isGenerating || isSaving || isFetchingClientSecret || isSending || !invoiceNumber || !!clientSecret} variant="link" className="mt-2 text-sm">
                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Re-generate with AI to reflect changes
              </Button>
            </CardContent>
          </Card>
        )}
         {(!generatedInvoiceHtml && !contract.invoiceHtmlContent && !clientSecret) && (
          <Card>
            <CardHeader><CardTitle>No Invoice Generated Yet</CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Enter an invoice number and use the "Generate with AI" button to create an invoice for this contract.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}



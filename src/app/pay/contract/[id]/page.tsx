
"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { db, doc, getDoc } from '@/lib/firebase';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { StripePaymentForm } from '@/components/payments/stripe-payment-form';
import type { Contract } from '@/types';
import { Loader2, AlertTriangle, CreditCard, ShieldCheck } from 'lucide-react';

// This URL should point to your deployed createPaymentIntent Cloud Function
// This function on the backend should be able to handle requests for specific contract IDs
// *without* requiring frontend user authentication if the payment is from a public link,
// but by validating the contract itself and fetching its amount.
const CREATE_PAYMENT_INTENT_FUNCTION_URL = "https://createpaymentintent-yzlih5wcva-uc.a.run.app";

export default function ClientPaymentPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();

  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoadingContract, setIsLoadingContract] = useState(true);
  const [isFetchingClientSecret, setIsFetchingClientSecret] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
      setStripePromise(loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY));
    } else {
      console.error("Stripe publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) is missing.");
      toast({ title: "Configuration Error", description: "Payment system is currently unavailable.", variant: "destructive", duration: 9000 });
    }
  }, [toast]);

  useEffect(() => {
    if (id) {
      setIsLoadingContract(true);
      const fetchContract = async () => {
        try {
          const contractDocRef = doc(db, 'contracts', id);
          const contractSnap = await getDoc(contractDocRef);
          if (contractSnap.exists()) {
            const data = contractSnap.data() as Contract;
            if (data.invoiceStatus === 'paid') {
              toast({ title: "Invoice Already Paid", description: "This invoice has already been settled.", variant: "default" });
            }
            setContract({ ...data, id: contractSnap.id });
          } else {
            toast({ title: "Error", description: "Invoice not found or link is invalid.", variant: "destructive" });
          }
        } catch (error) {
          console.error("Error fetching contract for payment:", error);
          toast({ title: "Fetch Error", description: "Could not load invoice details.", variant: "destructive" });
        } finally {
          setIsLoadingContract(false);
        }
      };
      fetchContract();
    }
  }, [id, toast]);

  const handleInitiatePayment = async () => {
    if (!contract || !stripePromise) {
      toast({ title: "Error", description: "Contract details missing or Stripe not loaded.", variant: "destructive" });
      return;
    }
    if (contract.invoiceStatus === 'paid') {
      toast({ title: "Already Paid", description: "This invoice has already been paid.", variant: "default" });
      return;
    }

    setIsFetchingClientSecret(true);
    setClientSecret(null);

    try {
      const response = await fetch(CREATE_PAYMENT_INTENT_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // No Authorization header here for public payments,
          // backend should verify contractId and fetch amount securely.
        },
        body: JSON.stringify({
          contractId: contract.id,
          amount: contract.amount, // Send amount in cents
          currency: 'usd', // Or derive from contract if it has a currency field
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
      setShowPaymentForm(true);
      toast({ title: "Payment Form Ready", description: "Please enter your card details below." });

    } catch (error: any) {
      console.error("Payment intent creation error:", error);
      toast({ title: "Payment Setup Failed", description: error.message || "Could not initiate payment.", variant: "destructive" });
      setClientSecret(null);
      setShowPaymentForm(false);
    } finally {
      setIsFetchingClientSecret(false);
    }
  };

  if (isLoadingContract) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading Invoice Details...</p>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Invoice Not Found</h2>
        <p className="text-muted-foreground mb-6">The payment link may be invalid or the invoice has been removed.</p>
      </div>
    );
  }

  const appearance = {
    theme: 'stripe' as const,
    variables: {
      colorPrimary: '#3F8CFF', // Verza Blue
    },
  };
  const elementsOptions = clientSecret ? { clientSecret, appearance } : undefined;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-100 to-sky-100 p-4 sm:p-6 md:p-8">
      <Card className="w-full max-w-lg shadow-2xl rounded-xl overflow-hidden">
        <CardHeader className="bg-slate-800 text-primary-foreground p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-10 w-10" />
            <div>
              <CardTitle className="text-2xl md:text-3xl">Pay Invoice</CardTitle>
              <CardDescription className="text-slate-300">For {contract.brand} - {contract.projectName || `Contract ID: ${contract.id.substring(0,8)}...`}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {contract.invoiceStatus === 'paid' ? (
            <div className="text-center py-8">
              <ShieldCheck className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-green-600">Invoice Already Paid</h3>
              <p className="text-muted-foreground mt-2">This invoice has already been settled. Thank you!</p>
            </div>
          ) : !showPaymentForm ? (
            <>
              <div className="space-y-3 text-center">
                <p className="text-4xl font-bold text-slate-700">
                  ${contract.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-muted-foreground">Amount Due</p>
              </div>
              <Button
                onClick={handleInitiatePayment}
                disabled={isFetchingClientSecret || !stripePromise}
                className="w-full text-lg py-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md shadow-md hover:shadow-lg transition-all duration-150 ease-in-out"
                size="lg"
              >
                {isFetchingClientSecret ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CreditCard className="mr-2 h-5 w-5" />}
                Proceed to Secure Payment
              </Button>
            </>
          ) : (
            clientSecret && stripePromise && elementsOptions && (
              <div>
                <p className="text-sm text-center text-muted-foreground mb-4">
                  Please enter your payment details below. Total:
                  <span className="font-semibold text-slate-700"> ${contract.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </p>
                <Elements stripe={stripePromise} options={elementsOptions}>
                  <StripePaymentForm clientSecret={clientSecret} contractId={contract.id} />
                </Elements>
                <Button variant="link" onClick={() => { setClientSecret(null); setShowPaymentForm(false); }} className="mt-4 text-xs">
                  Cancel Payment
                </Button>
              </div>
            )
          )}
           <p className="text-xs text-muted-foreground text-center pt-4">
            Payments are securely processed by Stripe. Your payment information is not stored on our servers.
          </p>
        </CardContent>
      </Card>
       <p className="text-center text-xs text-muted-foreground mt-6">
        Verza &copy; {new Date().getFullYear()}
      </p>
    </div>
  );
}



"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { StripePaymentForm } from '@/components/payments/stripe-payment-form';
import type { Contract } from '@/types';
import { Loader2, AlertTriangle, CreditCard, ShieldCheck } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import Image from 'next/image';

const CREATE_PAYMENT_INTENT_FUNCTION_URL = "https://createpaymentintent-cpmccwbluq-uc.a.run.app";

type PublicContractData = Pick<Contract, 'id' | 'brand' | 'projectName' | 'amount' | 'invoiceStatus' | 'clientEmail'>;

export default function ClientPaymentPage() {
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();

  const [contract, setContract] = useState<PublicContractData | null>(null);
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
      const getPublicContractDetailsCallable = httpsCallable(functions, 'getPublicContractDetails');
      
      getPublicContractDetailsCallable({ contractId: id })
        .then((result) => {
          const data = result.data as PublicContractData;
          if (data.invoiceStatus === 'paid') {
            toast({ title: "Invoice Already Paid", description: "This invoice has already been settled.", variant: "default" });
          }
          setContract(data);
        })
        .catch((error) => {
          console.error("Error fetching public contract details:", error);
          toast({ title: "Error", description: error.message || "Could not load invoice details.", variant: "destructive" });
        })
        .finally(() => {
          setIsLoadingContract(false);
        });
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
        },
        body: JSON.stringify({
          contractId: contract.id,
          amount: contract.amount,
          currency: 'usd',
           clientEmail: contract.clientEmail || undefined,
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4 text-center">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Invoice Not Found</h2>
        <p className="text-muted-foreground mb-6">The payment link may be invalid or the invoice has been removed.</p>
      </div>
    );
  }

  const appearance = {
    theme: 'stripe' as const,
    variables: {
      colorPrimary: '#6B37FF',
    },
  };
  const elementsOptions = clientSecret ? { clientSecret, appearance } : undefined;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-100 to-sky-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-6 md:p-8">
      <Card className="w-full max-w-lg shadow-2xl rounded-xl overflow-hidden bg-background">
        <CardHeader className="bg-slate-800 text-primary-foreground p-6">
          <div className="flex items-center gap-3">
             <Image src="/verza-icon.svg" alt="Verza Icon" width={40} height={40} />
            <div>
              <CardTitle className="text-2xl md:text-3xl text-white">Pay Invoice</CardTitle>
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
                <p className="text-muted-foreground">Amount Due</p>
                 <p className="text-5xl font-bold text-slate-800 dark:text-slate-100">
                  ${contract.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="flex flex-col items-center">
                <Button
                  onClick={handleInitiatePayment}
                  disabled={isFetchingClientSecret || !stripePromise}
                  className="w-full text-lg py-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md shadow-lg hover:shadow-xl transition-all duration-150 ease-in-out transform hover:-translate-y-0.5"
                  size="lg"
                >
                  {isFetchingClientSecret ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CreditCard className="mr-2 h-5 w-5" />}
                  Proceed to Secure Payment
                </Button>
                <p className="text-xs text-muted-foreground mt-2">Pay with Card or ACH Direct Debit</p>
              </div>
            </>
          ) : (
            clientSecret && stripePromise && elementsOptions && (
              <div>
                <p className="text-sm text-center text-muted-foreground mb-4">
                  Enter your payment details below. Total:
                  <span className="font-semibold text-slate-700 dark:text-slate-200"> ${contract.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </p>
                <Elements stripe={stripePromise} options={elementsOptions}>
                  <StripePaymentForm clientSecret={clientSecret} contractId={contract.id} />
                </Elements>
                <div className="text-center">
                  <Button variant="link" onClick={() => { setClientSecret(null); setShowPaymentForm(false); }} className="mt-4 text-xs h-auto p-0">
                    Cancel Payment
                  </Button>
                </div>
              </div>
            )
          )}
           <p className="text-xs text-muted-foreground text-center pt-4 flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-green-600"/> Securely processed by Stripe.
          </p>
        </CardContent>
      </Card>
       <p className="text-center text-xs text-muted-foreground mt-6">
        Powered by Verza &copy; {new Date().getFullYear()}
      </p>
    </div>
  );
}

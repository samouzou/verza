
"use client";

import { useState, type FormEvent } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card'; // Added Card for better structure

interface StripePaymentFormProps {
  clientSecret: string;
  contractId: string;
}

export function StripePaymentForm({ clientSecret, contractId }: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!stripe || !elements) {
      // Stripe.js has not yet loaded.
      // Make sure to disable form submission until Stripe.js has loaded.
      toast({ title: "Stripe Error", description: "Stripe.js has not loaded yet. Please wait.", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Make sure to change this to your payment completion page
        return_url: `${window.location.origin}/payment-success?contractId=${contractId}`,
      },
    });

    // This point will only be reached if there is an immediate error when
    // confirming the payment. Otherwise, your customer will be redirected to
    // your `return_url`. For example, for an invalid card, SCA challenges, etc.
    if (error) {
      if (error.type === "card_error" || error.type === "validation_error") {
        setErrorMessage(error.message || "An unexpected error occurred.");
        toast({ title: "Payment Failed", description: error.message || "Please check your card details.", variant: "destructive" });
      } else {
        setErrorMessage("An unexpected error occurred processing your payment.");
        toast({ title: "Payment Error", description: "An unexpected error occurred.", variant: "destructive" });
      }
    } else {
      // Payment has been processed or is processing. The user will be redirected.
      // You might show a success message here if the redirect doesn't happen immediately,
      // but typically the redirect to return_url handles the success confirmation.
      toast({ title: "Payment Processing", description: "Redirecting to confirmation..." });
    }
    setIsProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card className="border-0 shadow-none"> {/* Remove default card styling if used within another card */}
        <CardContent className="p-0"> {/* Remove padding if already handled by parent card */}
          <PaymentElement id="payment-element" options={{ layout: "tabs" }} />
          {errorMessage && <div id="payment-message" className="text-sm text-destructive mt-2">{errorMessage}</div>}
        </CardContent>
        <CardFooter className="p-0 pt-4"> {/* Remove padding if already handled by parent card */}
           <Button disabled={isProcessing || !stripe || !elements} id="submit" className="w-full" type="submit">
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              "Pay Now"
            )}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

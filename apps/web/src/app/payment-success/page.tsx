
"use client";

import { useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Home, FileText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/hooks/use-toast';

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const contractId = searchParams.get('contractId');
  const sessionId = searchParams.get('session_id'); // Stripe session ID

  useEffect(() => {
    if (sessionId) {
      toast({
        title: "Payment Successful!",
        description: "Your payment has been processed. The contract status will be updated shortly.",
      });
      // Typically, you wouldn't update Firestore from here.
      // The backend Stripe webhook is responsible for updating the contract status.
      // This page is for user confirmation.
      console.log("Stripe Checkout Session ID:", sessionId);
      console.log("Associated Contract ID:", contractId);

      // Optional: If you wanted to clear something from local storage or perform
      // a client-side action specific to this session, you could do it here.
    } else {
      // If no session_id, perhaps it was an erroneous navigation
      // Or if you want to allow access even without it for some reason
      // For now, let's assume session_id is expected for a true success page visit
      toast({
        title: "Notice",
        description: "Payment confirmation page.",
        variant: "default",
      });
    }
  }, [sessionId, contractId, toast]);

  return (
    <>
      <PageHeader
        title="Payment Confirmation"
        description="Thank you for your payment!"
      />
      <div className="flex flex-col items-center justify-center space-y-6">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="items-center text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <CardTitle className="text-2xl">Payment Successful!</CardTitle>
            <CardDescription>
              Your payment has been processed successfully. Your contract and invoice status will be updated once confirmed by our system (usually within a few moments).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col space-y-4">
            {contractId && (
              <Button asChild variant="outline">
                <Link href={`/contracts/${contractId}`}>
                  <FileText className="mr-2 h-4 w-4" /> View Contract Details
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/dashboard">
                <Home className="mr-2 h-4 w-4" /> Go to Dashboard
              </Link>
            </Button>
          </CardContent>
        </Card>
         {sessionId && (
           <p className="text-xs text-muted-foreground">Session ID: {sessionId}</p>
         )}
      </div>
    </>
  );
}

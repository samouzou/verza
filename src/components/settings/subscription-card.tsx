
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { getFunctions, httpsCallable, httpsCallableFromURL } from 'firebase/functions'; // Added httpsCallableFromURL
import { functions } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import { Loader2, CreditCard, Settings2, CheckCircle, XCircle, CalendarClock, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { loadStripe } from '@stripe/stripe-js';

// Define the new URL for the Cloud Function
const CREATE_STRIPE_SUBSCRIPTION_CHECKOUT_SESSION_URL = "https://createstripesubscriptioncheckoutsession-yzlih5wcva-uc.a.run.app";

export function SubscriptionCard() {
  const { user, refreshAuthUser } = useAuth(); // Added refreshAuthUser
  const { toast } = useToast();
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);
  const [isProcessingPortal, setIsProcessingPortal] = useState(false);

  if (!user) return null;

  const handleSubscribe = async () => {
    setIsProcessingCheckout(true);
    try {
      const firebaseFunctions = getFunctions(); // Use getFunctions()
      // Use httpsCallableFromURL with the specific URL
      const createCheckoutSessionCallable = httpsCallableFromURL(firebaseFunctions, CREATE_STRIPE_SUBSCRIPTION_CHECKOUT_SESSION_URL);
      
      const result = await createCheckoutSessionCallable(); // No data needs to be passed for this specific function
      const { sessionId } = result.data as { sessionId: string };
      
      if (!sessionId) {
        throw new Error("Could not retrieve a valid session ID from Stripe.");
      }

      const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!stripePublishableKey) {
        console.error("Stripe publishable key (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) is missing.");
        toast({ title: "Stripe Error", description: "Stripe configuration is missing. Cannot proceed to checkout.", variant: "destructive", duration: 9000 });
        setIsProcessingCheckout(false);
        return;
      }
      
      const stripe = await loadStripe(stripePublishableKey);

      if (stripe) {
         const { error } = await stripe.redirectToCheckout({ sessionId });
         if (error) {
           console.error("Stripe redirectToCheckout error:", error);
           toast({
             title: "Redirection Error",
             description: error.message || "Could not redirect to Stripe. Please try again.",
             variant: "destructive",
           });
         }
         // If redirectToCheckout is successful, the user is navigated away.
         // If it fails and returns an error, it will be caught here.
      } else {
        console.error("Stripe.js failed to load.");
        toast({
          title: "Subscription Error",
          description: "Could not connect to Stripe. Please try again later.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Error creating Stripe subscription checkout session:", error);
      toast({
        title: "Subscription Error",
        description: error.message || "Could not initiate subscription. Please try again.",
        variant: "destructive",
      });
    } finally {
      // This might not be reached if redirectToCheckout navigates away successfully
      setIsProcessingCheckout(false);
    }
  };

  const handleManageSubscription = async () => {
    if (!user.stripeCustomerId) {
      toast({ title: "Error", description: "No Stripe customer ID found. Cannot manage subscription.", variant: "destructive" });
      return;
    }
    setIsProcessingPortal(true);
    try {
      const firebaseFunctions = getFunctions(); // Use getFunctions()
      const createPortalSessionCallable = httpsCallable(firebaseFunctions, 'createStripeCustomerPortalSession');
      const result = await createPortalSessionCallable(); 
      const { url } = result.data as { url: string };
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("Could not retrieve customer portal URL.");
      }
    } catch (error: any) {
      console.error("Error creating Stripe customer portal session:", error);
      toast({
        title: "Error",
        description: error.message || "Could not open subscription management. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessingPortal(false);
    }
  };

  const formatDateSafe = (timestamp: any) => {
    if (!timestamp) return "N/A";
    try {
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        return format(timestamp.toDate(), "PPP");
      }
      // Check if it's a Firestore-like object { seconds: number, nanoseconds: number }
      if (timestamp && typeof timestamp.seconds === 'number' && typeof timestamp.nanoseconds === 'number') {
        return format(new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000), "PPP");
      }
      return format(new Date(timestamp), "PPP");
    } catch (e) {
      console.warn("Error formatting date:", e, "Timestamp value:", timestamp);
      return "Invalid Date";
    }
  };

  const renderStatusBadge = () => {
    if (!user.subscriptionStatus || user.subscriptionStatus === 'none') {
      return <Badge variant="outline">No Active Subscription</Badge>;
    }
    switch (user.subscriptionStatus) {
      case 'trialing':
        return <Badge className="bg-blue-500 text-white hover:bg-blue-600">Free Trial</Badge>;
      case 'active':
        return <Badge className="bg-green-500 text-white hover:bg-green-600">Active</Badge>;
      case 'past_due':
        return <Badge variant="destructive">Past Due</Badge>;
      case 'canceled':
        return <Badge variant="secondary">Canceled</Badge>;
      case 'incomplete':
        return <Badge variant="outline">Incomplete</Badge>;
      default:
        return <Badge variant="outline" className="capitalize">{user.subscriptionStatus.replace('_', ' ')}</Badge>;
    }
  };
  
  const canSubscribe = !user.stripeCustomerId || 
                       user.subscriptionStatus === 'none' || 
                       user.subscriptionStatus === 'canceled' ||
                       (user.subscriptionStatus === 'trialing'); 

  const canManage = !!user.stripeCustomerId && 
                    (user.subscriptionStatus === 'active' || 
                     user.subscriptionStatus === 'past_due' || 
                     user.subscriptionStatus === 'trialing' ||
                     user.subscriptionStatus === 'canceled'); 

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" />
          Subscription Plan
        </CardTitle>
        <CardDescription>Manage your Verza Pro subscription and billing details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
          <div>
            <p className="font-semibold text-lg">Verza Pro</p>
            <p className="text-sm text-muted-foreground">$10.00 / month</p>
          </div>
          {renderStatusBadge()}
        </div>

        {user.subscriptionStatus === 'trialing' && user.trialEndsAt && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20 rounded-md">
            <CalendarClock className="h-5 w-5 text-blue-600 dark:text-blue-400"/>
            <span>
              Your free trial {user.trialEndsAt.toMillis() > Date.now() ? `ends on ${formatDateSafe(user.trialEndsAt)}` : `ended on ${formatDateSafe(user.trialEndsAt)}`}.
            </span>
          </div>
        )}

        {user.subscriptionStatus === 'active' && user.subscriptionEndsAt && (
           <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border-l-4 border-green-500 bg-green-50 dark:bg-green-900/20 rounded-md">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400"/>
            <span>
                Your subscription is active. Renews on {formatDateSafe(user.subscriptionEndsAt)}.
            </span>
          </div>
        )}
        
        {user.subscriptionStatus === 'canceled' && user.subscriptionEndsAt && (
           <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border-l-4 border-destructive bg-red-50 dark:bg-red-900/20 rounded-md">
            <XCircle className="h-5 w-5 text-destructive"/>
            <span>
                Your subscription was canceled. Access ends on {formatDateSafe(user.subscriptionEndsAt)}.
            </span>
          </div>
        )}

        {user.subscriptionStatus === 'past_due' && (
           <div className="flex items-center gap-2 text-sm text-destructive p-3 border-l-4 border-destructive bg-red-50 dark:bg-red-900/20 rounded-md">
            <AlertCircle className="h-5 w-5"/>
            <span>
                Your payment is past due. Please update your payment method.
            </span>
          </div>
        )}


        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          {canSubscribe && user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'past_due' && (
            <Button
              onClick={handleSubscribe}
              disabled={isProcessingCheckout || isProcessingPortal}
              className="flex-1"
            >
              {isProcessingCheckout ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="mr-2 h-4 w-4" />
              )}
              {user.subscriptionStatus === 'trialing' && user.trialEndsAt && user.trialEndsAt.toMillis() > Date.now() 
                ? 'Subscribe Now (End Trial Early)' 
                : 'Subscribe to Verza Pro'}
            </Button>
          )}

          {canManage && (
            <Button
              onClick={handleManageSubscription}
              disabled={isProcessingCheckout || isProcessingPortal || !user.stripeCustomerId}
              variant="outline"
              className="flex-1"
            >
              {isProcessingPortal ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Settings2 className="mr-2 h-4 w-4" />
              )}
              Manage Subscription
            </Button>
          )}
        </div>
         <p className="text-xs text-muted-foreground text-center pt-2">
            Subscription management and payments are securely handled by Stripe.
          </p>
      </CardContent>
    </Card>
  );
}

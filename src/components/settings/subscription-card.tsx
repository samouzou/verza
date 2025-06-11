
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { getFunctions, httpsCallable, httpsCallableFromURL } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import { Loader2, CreditCard, Settings2, CheckCircle, XCircle, CalendarClock, AlertCircle, BadgeDollarSign, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { loadStripe } from '@stripe/stripe-js';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

const CREATE_STRIPE_SUBSCRIPTION_CHECKOUT_SESSION_URL = "https://createstripesubscriptioncheckoutsession-cpmccwbluq-uc.a.run.app";

type PlanInterval = 'month' | 'year';

export function SubscriptionCard() {
  const { user, refreshAuthUser } = useAuth();
  const { toast } = useToast();
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);
  const [isProcessingPortal, setIsProcessingPortal] = useState(false);
  const [selectedPlanInterval, setSelectedPlanInterval] = useState<PlanInterval>('month');

  if (!user) return null;

  const handleSubscribe = async () => {
    setIsProcessingCheckout(true);
    try {
      const firebaseFunctions = getFunctions();
      const createCheckoutSessionCallable = httpsCallableFromURL(firebaseFunctions, CREATE_STRIPE_SUBSCRIPTION_CHECKOUT_SESSION_URL);
      
      const result = await createCheckoutSessionCallable({ interval: selectedPlanInterval });
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
      const firebaseFunctions = getFunctions();
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
    let intervalText = "";
    if (user.subscriptionInterval === 'year') intervalText = " (Yearly)";
    else if (user.subscriptionInterval === 'month') intervalText = " (Monthly)";


    switch (user.subscriptionStatus) {
      case 'trialing':
        return <Badge className="bg-blue-500 text-white hover:bg-blue-600">Free Trial{intervalText}</Badge>;
      case 'active':
        return <Badge className="bg-green-500 text-white hover:bg-green-600">Active{intervalText}</Badge>;
      case 'past_due':
        return <Badge variant="destructive">Past Due{intervalText}</Badge>;
      case 'canceled':
        return <Badge variant="secondary">Canceled{intervalText}</Badge>;
      case 'incomplete':
        return <Badge variant="outline">Incomplete{intervalText}</Badge>;
      default:
        return <Badge variant="outline" className="capitalize">{user.subscriptionStatus.replace('_', ' ')}{intervalText}</Badge>;
    }
  };
  
  const canSubscribe = !user.stripeSubscriptionId || 
                       user.subscriptionStatus === 'none' || 
                       user.subscriptionStatus === 'canceled' ||
                       (user.subscriptionStatus === 'trialing'); 

  const canManage = !!user.stripeSubscriptionId && 
                    (user.subscriptionStatus === 'active' || 
                     user.subscriptionStatus === 'past_due' || 
                     user.subscriptionStatus === 'trialing');

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          Verza Pro Subscription
        </CardTitle>
        <CardDescription>Unlock all features and manage your creator business seamlessly.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 border rounded-lg bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-lg">Current Plan</p>
            {renderStatusBadge()}
          </div>
          {user.subscriptionStatus === 'trialing' && user.trialEndsAt && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20 rounded-md my-2">
              <CalendarClock className="h-5 w-5 text-blue-600 dark:text-blue-400"/>
              <span>
                Your free trial {user.trialEndsAt.toMillis() > Date.now() ? `ends on ${formatDateSafe(user.trialEndsAt)}` : `ended on ${formatDateSafe(user.trialEndsAt)}`}.
              </span>
            </div>
          )}
          {(user.subscriptionStatus === 'active' || user.subscriptionStatus === 'canceled') && user.subscriptionEndsAt && (
            <div className={`flex items-center gap-2 text-sm text-muted-foreground p-3 border-l-4 rounded-md my-2 ${user.subscriptionStatus === 'active' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-destructive bg-red-50 dark:bg-red-900/20'}`}>
              {user.subscriptionStatus === 'active' ? <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400"/> : <XCircle className="h-5 w-5 text-destructive"/>}
              <span>
                  {user.subscriptionStatus === 'active' ? 'Subscription renews on' : 'Access ends on'} {formatDateSafe(user.subscriptionEndsAt)}.
              </span>
            </div>
          )}
          {user.subscriptionStatus === 'past_due' && (
             <div className="flex items-center gap-2 text-sm text-destructive p-3 border-l-4 border-destructive bg-red-50 dark:bg-red-900/20 rounded-md my-2">
              <AlertCircle className="h-5 w-5"/>
              <span>
                  Your payment is past due. Please update your payment method via "Manage Subscription".
              </span>
            </div>
          )}
        </div>

        {canSubscribe && (
          <div className="space-y-4 pt-2">
            <p className="font-medium">Choose your plan:</p>
            <RadioGroup value={selectedPlanInterval} onValueChange={(value) => setSelectedPlanInterval(value as PlanInterval)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <RadioGroupItem value="month" id="plan-monthly" className="peer sr-only" />
                <Label
                  htmlFor="plan-monthly"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                >
                  <BadgeDollarSign className="mb-3 h-6 w-6" />
                  Monthly Plan
                  <span className="block text-2xl font-bold mt-1">$10/month</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem value="year" id="plan-yearly" className="peer sr-only" />
                <Label
                  htmlFor="plan-yearly"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer relative"
                >
                  <Badge variant="default" className="absolute -top-2 -right-2 px-2 py-0.5 text-xs bg-green-500 text-white">Save 16%</Badge>
                  <BadgeDollarSign className="mb-3 h-6 w-6" />
                  Yearly Plan
                  <span className="block text-2xl font-bold mt-1">$100/year</span>
                  <span className="text-xs text-muted-foreground">(Equals $8.33/month)</span>
                </Label>
              </div>
            </RadioGroup>

            <Button
              onClick={handleSubscribe}
              disabled={isProcessingCheckout || isProcessingPortal}
              className="w-full"
              size="lg"
            >
              {isProcessingCheckout ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <CreditCard className="mr-2 h-5 w-5" />
              )}
              {user.subscriptionStatus === 'trialing' && user.trialEndsAt && user.trialEndsAt.toMillis() > Date.now() 
                ? `Subscribe to ${selectedPlanInterval === 'month' ? 'Monthly' : 'Yearly'} (End Trial Early)`
                : `Subscribe to ${selectedPlanInterval === 'month' ? 'Monthly' : 'Yearly'}`}
            </Button>
          </div>
        )}
        
        {canManage && (
          <Button
            onClick={handleManageSubscription}
            disabled={isProcessingCheckout || isProcessingPortal || !user.stripeCustomerId}
            variant="outline"
            className="w-full"
          >
            {isProcessingPortal ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Settings2 className="mr-2 h-4 w-4" />
            )}
            Manage Subscription & Billing
          </Button>
        )}

         <p className="text-xs text-muted-foreground text-center pt-2">
            Subscription management and payments are securely handled by Stripe.
          </p>
      </CardContent>
    </Card>
  );
}


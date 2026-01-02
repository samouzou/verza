
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { getFunctions, httpsCallable, httpsCallableFromURL } from 'firebase/functions';
import { useToast } from "@/hooks/use-toast";
import { Loader2, Settings2, CheckCircle, XCircle, CalendarClock, AlertCircle, Zap, Crown, Rocket, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import Link from "next/link";

const CREATE_STRIPE_SUBSCRIPTION_CHECKOUT_SESSION_URL = "https://createshareablecontractversion-cpmccwbluq-uc.a.run.app";

type PlanId = 'individual_monthly' | 'individual_yearly' | 'agency_start_monthly' | 'agency_start_yearly' | 'agency_pro_monthly' | 'agency_pro_yearly';
type BillingFrequency = 'monthly' | 'yearly';

export function SubscriptionCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);
  const [isProcessingPortal, setIsProcessingPortal] = useState(false);
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>('monthly');

  if (!user) return null;

  const handleSubscribe = async (planId: PlanId) => {
    setIsProcessingCheckout(true);
    try {
      const firebaseFunctions = getFunctions();
      const createCheckoutSessionCallable = httpsCallable(firebaseFunctions, 'createStripeSubscriptionCheckoutSession');
      
      const result = await createCheckoutSessionCallable({ planId });
      const { url } = result.data as { url?: string };
      
      if (!url) {
        throw new Error("Could not retrieve a valid checkout session URL from Stripe.");
      }
      
      window.location.href = url;

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
  
  const planDetails: Record<PlanId, { name: string; price: string; talentLimit?: number; icon: React.ElementType; yearlyPrice?: string; yearlySavings?: string }> = {
    'individual_monthly': { name: 'Individual Pro', price: '$25/month', icon: Zap },
    'individual_yearly': { name: 'Individual Pro', price: '$249/year', icon: Zap, yearlySavings: 'Save 17%' },
    'agency_start_monthly': { name: 'Agency Start', price: '$199/month', talentLimit: 10, icon: Crown },
    'agency_start_yearly': { name: 'Agency Start', price: '$1982/year', talentLimit: 10, icon: Crown, yearlySavings: 'Save ~17%' },
    'agency_pro_monthly': { name: 'Agency Pro', price: '$349/month', talentLimit: 25, icon: Rocket },
    'agency_pro_yearly': { name: 'Agency Pro', price: '$3476/year', talentLimit: 25, icon: Rocket, yearlySavings: 'Save ~17%' },
  };

  const getPlanNameFromId = (planId?: string) => {
      if (!planId) return 'Pro Trial'; // Default to Pro Trial name if no plan ID during trial
      if (planId === 'individual_free') return 'Free Forever';
      return planDetails[planId as PlanId]?.name || 'Unknown Plan';
  };

  const renderStatusBadge = () => {
    const status = user.subscriptionStatus;
    const planId = user.subscriptionPlanId;
    
    if (planId === 'individual_free') {
       return <Badge className="bg-green-500 text-white hover:bg-green-600">Free Forever</Badge>;
    }
    if (!status || status === 'none') {
      return <Badge variant="outline">No Active Subscription</Badge>;
    }
    
    const planName = getPlanNameFromId(planId);

    switch (status) {
      case 'trialing': return <Badge className="bg-blue-500 text-white hover:bg-blue-600">{planName}</Badge>;
      case 'active': return <Badge className="bg-green-500 text-white hover:bg-green-600">{planName}</Badge>;
      case 'past_due': return <Badge variant="destructive">{planName} - Past Due</Badge>;
      case 'canceled': return <Badge variant="secondary">{planName} - Canceled</Badge>;
      default: return <Badge variant="outline" className="capitalize">{planName} - {status.replace('_', ' ')}</Badge>;
    }
  };
  
  const canManage = !!user.stripeSubscriptionId && (user.subscriptionStatus === 'active' || user.subscriptionStatus === 'past_due' || user.subscriptionStatus === 'trialing' || user.subscriptionStatus === 'canceled');
  
  const plansToShow = Object.entries(planDetails)
    .filter(([id]) => id.endsWith(billingFrequency))
    .filter(([id]) => user.isAgencyOwner ? id.startsWith('agency') : id.startsWith('individual'));

  if (user.role === 'agency_admin' || user.role === 'agency_member') {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Agency Subscription
          </CardTitle>
          <CardDescription>Your plan is managed by your agency.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 border rounded-lg bg-muted/50 text-center">
             <p className="font-semibold text-lg">Your subscription is managed by your agency.</p>
             <p className="text-sm text-muted-foreground mt-2">Please contact your agency owner to make any changes to the subscription plan or billing details.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render view for agency owners
  if (user.isAgencyOwner) {
    return (
        <Card className="shadow-lg">
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
            <Crown className="h-6 w-6 text-primary" />
            Agency Subscription
            </CardTitle>
            <CardDescription>Manage your agency's subscription plan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="p-4 border rounded-lg bg-muted/50">
            <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-lg">Current Plan</p>
                {renderStatusBadge()}
            </div>
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
            
            <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
                <p className="font-medium text-lg">Available Agency Plans</p>
                <RadioGroup
                value={billingFrequency}
                onValueChange={(value: string) => setBillingFrequency(value as BillingFrequency)}
                className="flex items-center rounded-md bg-muted p-1"
                >
                <RadioGroupItem value="monthly" id="monthly" className="sr-only" />
                <Label htmlFor="monthly" className={cn("px-3 py-1 text-sm rounded-md cursor-pointer", billingFrequency === 'monthly' && 'bg-background shadow-sm')}>Monthly</Label>
                <RadioGroupItem value="yearly" id="yearly" className="sr-only" />
                <Label htmlFor="yearly" className={cn("px-3 py-1 text-sm rounded-md cursor-pointer", billingFrequency === 'yearly' && 'bg-background shadow-sm')}>Yearly</Label>
                </RadioGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {plansToShow.map(([id, details]) => {
                    const planIdKey = id as PlanId;
                    const isCurrentPlan = user.subscriptionPlanId === planIdKey;

                    return (
                    <div key={id} className={cn("relative rounded-lg border-2 p-4 flex flex-col items-center justify-between transition-all", isCurrentPlan ? 'border-primary' : 'border-muted hover:border-primary/50')}>
                        {isCurrentPlan && <Badge className="absolute -top-2 -left-2 px-2 py-0.5 text-xs bg-primary text-white">Current Plan</Badge>}
                        {details.yearlySavings && billingFrequency === 'yearly' && <Badge variant="default" className="absolute -top-2 -right-2 px-2 py-0.5 text-xs bg-green-500 text-white">{details.yearlySavings}</Badge>}
                        
                        <details.icon className="mb-3 h-8 w-8 text-primary" />
                        <p className="font-semibold text-lg">{details.name}</p>
                        <p className="text-2xl font-bold mt-1">{details.price}</p>
                        {details.talentLimit && <p className="text-sm text-muted-foreground">Up to {details.talentLimit} talents</p>}
                        <Button 
                            onClick={(e) => { e.preventDefault(); handleSubscribe(planIdKey); }} 
                            className="w-full mt-4" 
                            disabled={isProcessingCheckout || isCurrentPlan}
                            variant={isCurrentPlan ? 'secondary' : 'default'}
                        >
                            {isProcessingCheckout ? <Loader2 className="h-4 w-4 animate-spin"/> : (isCurrentPlan ? 'Current Plan' : 'Choose Plan')}
                        </Button>
                    </div>
                    );
                })}
            </div>
            </div>
            
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

  // Render view for individual creators
  return (
      <Card className="shadow-lg">
      <CardHeader>
          <CardTitle className="flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          Creator Subscription
          </CardTitle>
          <CardDescription>Manage your subscription plan.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
          <div className="p-4 border rounded-lg bg-muted/50">
            <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-lg">Current Plan</p>
                {renderStatusBadge()}
            </div>
             {(user.subscriptionStatus === 'trialing') && user.trialEndsAt && (
                <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-300 p-3 border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20 rounded-md my-2">
                    <CalendarClock className="h-5 w-5"/>
                    <span>Your free trial ends on {formatDateSafe(user.trialEndsAt)}.</span>
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
                    Your payment is past due. Please update your payment method.
                </span>
                </div>
            )}
          </div>
          
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
                <p className="font-medium text-lg">Individual Pro Plan</p>
                <RadioGroup
                value={billingFrequency}
                onValueChange={(value: string) => setBillingFrequency(value as BillingFrequency)}
                className="flex items-center rounded-md bg-muted p-1"
                >
                <RadioGroupItem value="monthly" id="monthly" className="sr-only" />
                <Label htmlFor="monthly" className={cn("px-3 py-1 text-sm rounded-md cursor-pointer", billingFrequency === 'monthly' && 'bg-background shadow-sm')}>Monthly</Label>
                <RadioGroupItem value="yearly" id="yearly" className="sr-only" />
                <Label htmlFor="yearly" className={cn("px-3 py-1 text-sm rounded-md cursor-pointer", billingFrequency === 'yearly' && 'bg-background shadow-sm')}>Yearly</Label>
                </RadioGroup>
            </div>
             <div className="grid grid-cols-1">
                {plansToShow.map(([id, details]) => {
                    const planIdKey = id as PlanId;
                    const isCurrentPlan = user.subscriptionPlanId === planIdKey;
                    const isSubscribed = user.subscriptionStatus === 'active';

                    return (
                        <div key={id} className={cn("relative rounded-lg border-2 p-4 flex flex-col items-center justify-between transition-all", isCurrentPlan && isSubscribed ? 'border-primary' : 'border-muted hover:border-primary/50')}>
                            {isCurrentPlan && isSubscribed && <Badge className="absolute -top-2 -left-2 px-2 py-0.5 text-xs bg-primary text-white">Current Plan</Badge>}
                            {details.yearlySavings && billingFrequency === 'yearly' && <Badge variant="default" className="absolute -top-2 -right-2 px-2 py-0.5 text-xs bg-green-500 text-white">{details.yearlySavings}</Badge>}
                            
                            <details.icon className="mb-3 h-8 w-8 text-primary" />
                            <p className="font-semibold text-lg">{details.name}</p>
                            <p className="text-2xl font-bold mt-1">{details.price}</p>
                            <ul className="text-sm text-muted-foreground list-disc list-inside mt-2 text-center">
                                <li>All Core Features</li>
                                <li>AI Contract Analysis</li>
                                <li>Secure Payments</li>
                            </ul>
                            <Button 
                                onClick={(e) => { e.preventDefault(); handleSubscribe(planIdKey); }} 
                                className="w-full mt-4" 
                                disabled={isProcessingCheckout || (isCurrentPlan && isSubscribed)}
                                variant={isCurrentPlan && isSubscribed ? 'secondary' : 'default'}
                            >
                                {isProcessingCheckout ? <Loader2 className="h-4 w-4 animate-spin"/> : (isCurrentPlan && isSubscribed ? 'Current Plan' : 'Choose Plan')}
                            </Button>
                        </div>
                    );
                })}
            </div>
          </div>
          
          {canManage && (
            <Button
                onClick={handleManageSubscription}
                disabled={isProcessingCheckout || isProcessingPortal || !user.stripeCustomerId}
                variant="outline"
                className="w-full"
            >
                {isProcessingPortal ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings2 className="mr-2 h-4 w-4" />}
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

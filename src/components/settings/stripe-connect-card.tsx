
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ExternalLink, CheckCircle, XCircle, AlertTriangle as AlertTriangleIcon, Link as LinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// URLs for your Firebase Cloud Functions (onRequest type)
const CREATE_STRIPE_CONNECTED_ACCOUNT_FUNCTION_URL = "https://createstripeconnectedaccount-yzlih5wcva-uc.a.run.app";
const CREATE_STRIPE_ACCOUNT_LINK_FUNCTION_URL = "https://createstripeaccountlink-yzlih5wcva-uc.a.run.app";


export function StripeConnectCard() {
  const { user, refreshAuthUser, getUserIdToken } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  if (!user) return null;

  const handleConnectStripe = async () => {
    setIsProcessing(true);
    toast({
      title: "Connecting to Stripe...",
      description: "Attempting to create your Stripe Connected Account.",
    });
    try {
      const idToken = await getUserIdToken();
      if (!idToken) {
        throw new Error("Authentication token not available.");
      }

      const response = await fetch(CREATE_STRIPE_CONNECTED_ACCOUNT_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to create Stripe account. Status: ${response.status}`);
      }

      const result = await response.json();
      if (result.stripeAccountId) {
        toast({ title: "Stripe Account Created", description: "Your Stripe account ID has been created. Please complete onboarding." });
        await refreshAuthUser(); // Refresh user data to get new stripeAccountId and status
        // The UI should update, and the button might change to "Complete Onboarding"
        // If it does, the user can click it to get the account link.
      } else {
        throw new Error("Stripe Account ID not returned from backend.");
      }
    } catch (error: any) {
      console.error("Error creating Stripe Connected Account:", error);
      toast({ title: "Stripe Connection Failed", description: error.message || "Could not create Stripe account.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManageStripeAccount = async () => {
    setIsProcessing(true);
    toast({
      title: "Fetching Stripe Link...",
      description: "Attempting to generate your Stripe account link.",
    });
    try {
      const idToken = await getUserIdToken();
      if (!idToken) {
        throw new Error("Authentication token not available.");
      }

      const response = await fetch(CREATE_STRIPE_ACCOUNT_LINK_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        // Body is not strictly needed if backend gets stripeAccountId from authenticated user's Firestore doc
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to get Stripe account link. Status: ${response.status}`);
      }
      const result = await response.json();
      if (result.url) {
        window.location.href = result.url; // Redirect user to Stripe
      } else {
        throw new Error("Stripe account link URL not returned from backend.");
      }
    } catch (error: any) {
      console.error("Error creating Stripe Account Link:", error);
      toast({ title: "Stripe Link Failed", description: error.message || "Could not generate Stripe account link.", variant: "destructive" });
    } finally {
      // If redirection happens, this might not be reached immediately
      setIsProcessing(false);
    }
  };


  const renderStatusDetails = () => {
    if (!user.stripeAccountId || user.stripeAccountStatus === 'none') {
      return <Badge variant="outline">Not Connected</Badge>;
    }
    let statusText = user.stripeAccountStatus?.replace(/_/g, ' ') || "Unknown";
    statusText = statusText.charAt(0).toUpperCase() + statusText.slice(1);

    let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
    let Icon = AlertTriangleIcon;

    switch (user.stripeAccountStatus) {
      case 'active':
        badgeVariant = 'default'; Icon = CheckCircle;
        break;
      case 'onboarding_incomplete':
      case 'pending_verification':
        badgeVariant = 'secondary'; Icon = Loader2; statusText = "Onboarding Incomplete";
        break;
      case 'restricted':
      case 'restricted_soon':
        badgeVariant = 'destructive'; Icon = AlertTriangleIcon;
        break;
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
           <Badge variant={badgeVariant} className={`capitalize ${badgeVariant === 'default' ? 'bg-green-500 hover:bg-green-600 text-white' : ''}`}>
            <Icon className={`mr-1 h-3 w-3 ${badgeVariant === 'secondary' && user.stripeAccountStatus !== 'pending_verification' ? 'animate-spin' : ''}`} />
            {statusText}
          </Badge>
        </div>
        {user.stripeAccountId && (
          <p className="text-xs text-muted-foreground">Account ID: {user.stripeAccountId}</p>
        )}
        {user.stripeAccountStatus === 'active' && (
          <>
            <p className={`text-sm flex items-center ${user.stripeChargesEnabled ? 'text-green-600' : 'text-destructive'}`}>
              {user.stripeChargesEnabled ? <CheckCircle className="mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}
              Payments: {user.stripeChargesEnabled ? 'Enabled' : 'Disabled'}
            </p>
            <p className={`text-sm flex items-center ${user.stripePayoutsEnabled ? 'text-green-600' : 'text-destructive'}`}>
              {user.stripePayoutsEnabled ? <CheckCircle className="mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}
              Payouts: {user.stripePayoutsEnabled ? 'Enabled' : 'Disabled'}
            </p>
          </>
        )}
      </div>
    );
  };

  const getButtonAction = () => {
    if (!user.stripeAccountId || user.stripeAccountStatus === 'none') {
      return {
        text: "Connect Stripe Account",
        handler: handleConnectStripe,
        Icon: LinkIcon,
      };
    }
    if (user.stripeAccountStatus === 'onboarding_incomplete' || user.stripeAccountStatus === 'pending_verification') {
      return {
        text: "Complete Stripe Onboarding",
        handler: handleManageStripeAccount, // This function gets the account link for onboarding
        Icon: ExternalLink,
      };
    }
    // For 'active', 'restricted', 'restricted_soon', etc.
    return {
      text: "Manage Stripe Account",
      handler: handleManageStripeAccount,
      Icon: ExternalLink,
    };
  };

  const buttonAction = getButtonAction();

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg viewBox="0 0 42 28" width="32" height="20" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary dark:text-primary">
            <path d="M15.007 27.416c8.284 0 15-6.716 15-15 0-8.284-6.716-15-15-15s-15 6.716-15 15c0 8.284 6.716 15 15 15Z" fill="url(#stripe_connect_gradient)"></path>
            <path d="M27.65 10.716c0-2.339-1.045-3.532-3.865-3.532-1.818 0-3.03.66-3.825 1.602V7.45H16.26v12.96h3.6V14.7c0-1.11.446-1.683 1.338-1.683.852 0 1.338.572 1.338 1.683v5.71h3.704v-5.45c0-1.11.405-1.683 1.257-1.683.893 0 1.339.572 1.339 1.683v5.45h3.704V13.34c0-2.219-.962-3.492-3.532-3.492-.961 0-1.836.32-2.553.884v-.018Z" fill="hsl(var(--primary-foreground))"></path>
            <defs><linearGradient id="stripe_connect_gradient" x1="15.007" y1="-.584" x2="15.007" y2="27.416" gradientUnits="userSpaceOnUse"><stop stopColor="hsl(var(--primary))"></stop><stop offset="1" stopColor="hsl(var(--primary))"></stop></linearGradient></defs>
          </svg>
          Connect with Stripe
        </CardTitle>
        <CardDescription>Connect your Stripe account to receive payments directly from your clients for invoices.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 border rounded-lg bg-muted/50">
          {renderStatusDetails()}
        </div>

        <Button
          onClick={buttonAction.handler}
          disabled={isProcessing}
          className="w-full sm:w-auto"
        >
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <buttonAction.Icon className="mr-2 h-4 w-4" />
          )}
          {buttonAction.text}
        </Button>

        <p className="text-xs text-muted-foreground">
          By connecting your Stripe account, you agree to Stripe's <a href="https://stripe.com/connect-account/legal" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Connected Account Agreement</a>.
          Verza facilitates this connection but does not store your sensitive Stripe credentials.
        </p>
      </CardContent>
    </Card>
  );
}

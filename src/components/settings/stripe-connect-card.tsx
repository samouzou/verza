
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ExternalLink, CheckCircle, XCircle, AlertTriangle as AlertTriangleIcon, Link as LinkIcon, Building } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// URLs for your Firebase Cloud Functions (onRequest type)
const CREATE_STRIPE_CONNECTED_ACCOUNT_FUNCTION_URL = "https://createstripeconnectedaccount-cpmccwbluq-uc.a.run.app";
const CREATE_STRIPE_ACCOUNT_LINK_FUNCTION_URL = "https://createstripeaccountlink-cpmccwbluq-uc.a.run.app";


export function StripeConnectCard() {
  const { user, refreshAuthUser, getUserIdToken } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  if (!user) return null;

  // New logic for team members
  if (user.role === 'agency_admin' || user.role === 'agency_member') {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="h-6 w-6 text-primary" />
            Agency Payments
          </CardTitle>
          <CardDescription>Agency payment settings are managed by the owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 border rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground">
              As a team member, all invoices you send on behalf of the agency will use the agency owner's connected Stripe account for payments. You do not need to connect a personal Stripe account.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

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
          <svg width="42" height="28" viewBox="0 0 42 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-auto">
            <path d="M2.36667 25.1333C1.06667 25.1333 0 24.0667 0 22.7667C0 21.4667 1.06667 20.4 2.36667 20.4H19.5333C20.8333 20.4 21.9 21.4667 21.9 22.7667C21.9 24.0667 20.8333 25.1333 19.5333 25.1333H2.36667Z" fill="#635BFF"></path>
            <path d="M5.13333 2.86667C3.83333 2.86667 2.76667 3.93333 2.76667 5.23333V17.6C2.76667 18.9 3.83333 20 5.13333 20H16.7667C18.0667 20 19.1333 18.9 19.1333 17.6V5.23333C19.1333 3.93333 18.0667 2.86667 16.7667 2.86667H5.13333ZM11.1 14.8333C8.63333 14.8333 6.63333 12.8333 6.63333 10.3667C6.63333 7.9 8.63333 5.9 11.1 5.9C13.5667 5.9 15.5667 7.9 15.5667 10.3667C15.5667 12.8333 13.5667 14.8333 11.1 14.8333Z" fill="#635BFF"></path>
            <path d="M39.6333 2.86667H25.0667C24.4667 2.86667 23.9667 3.23333 23.7667 3.8L22.1 8.5C22.0333 8.66667 22 8.86667 22 9.03333V17.6C22 18.9 23.0667 20 24.3667 20H38.9333C39.5333 20 40.0333 19.6333 40.2333 19.1L41.9 14.4333C41.9667 14.2667 42 14.0667 42 13.9V5.23333C42 3.93333 40.9333 2.86667 39.6333 2.86667Z" fill="#635BFF"></path>
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

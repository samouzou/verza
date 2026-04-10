
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ExternalLink, CheckCircle, XCircle, AlertTriangle as AlertTriangleIcon, Link as LinkIcon, Building, Lightbulb, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/firebase";
import { doc, onSnapshot, updateDoc, query, collection, where, getDocs } from "firebase/firestore";
import type { Agency, TeamMember } from "@/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// URLs for your Firebase Cloud Functions (onRequest type)
const CREATE_STRIPE_CONNECTED_ACCOUNT_FUNCTION_URL = "https://createstripeconnectedaccount-cpmccwbluq-uc.a.run.app";
const CREATE_STRIPE_ACCOUNT_LINK_FUNCTION_URL = "https://createstripeaccountlink-cpmccwbluq-uc.a.run.app";


export function StripeConnectCard() {
  const { user, refreshAuthUser, getUserIdToken } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [isTransferringDelegate, setIsTransferringDelegate] = useState(false);
  const [selectedNewDelegate, setSelectedNewDelegate] = useState<string>("");

  useEffect(() => {
    if (!user?.primaryAgencyId) return;
    const agencyRef = doc(db, "agencies", user.primaryAgencyId);
    const unsubscribe = onSnapshot(agencyRef, (snap) => {
      if (snap.exists()) setAgency({ id: snap.id, ...snap.data() } as Agency);
    });
    return () => unsubscribe();
  }, [user?.primaryAgencyId]);

  if (!user) return null;

  const isAgencyAdmin = user.role === 'agency_admin';
  const isAgencyMember = user.role === 'agency_member';
  const isAgencyOwner = user.role === 'agency_owner';
  const isAgencyTeam = isAgencyAdmin || isAgencyMember || isAgencyOwner;

  // Delegate logic
  const currentDelegateId = agency?.paymentDelegateId;
  const isCurrentDelegate = currentDelegateId === user.uid;
  const hasDelegateSet = !!currentDelegateId;
  // Admins can connect only if no delegate is set yet (first-come-first-serve)
  const canConnectAsDelegate = isAgencyOwner || (isAgencyAdmin && !hasDelegateSet);
  // Pure members can never connect
  const isBlockedMember = isAgencyMember;
  // Admins who aren't the delegate after one's been set are blocked too
  const isBlockedAdmin = isAgencyAdmin && hasDelegateSet && !isCurrentDelegate;

  const handleConnectStripe = async () => {
    setIsProcessing(true);
    toast({
      title: "Connecting to Stripe...",
      description: "You will be redirected to Stripe to securely connect your bank account.",
    });
    try {
      const idToken = await getUserIdToken();
      if (!idToken) throw new Error("Authentication token not available.");

      const response = await fetch(CREATE_STRIPE_CONNECTED_ACCOUNT_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to create Stripe account. Status: ${response.status}`);
      }

      const result = await response.json();
      if (result.stripeAccountId) {
        // First-come-first-serve: if no delegate is set yet, claim it
        if (agency && !hasDelegateSet && (isAgencyAdmin || isAgencyOwner)) {
          await updateDoc(doc(db, "agencies", agency.id), { paymentDelegateId: user.uid });
          toast({ title: "Payment Delegate Set", description: "You are now the payment account holder for this agency." });
        }
        toast({ title: "Stripe Account Created", description: "Redirecting to Stripe to complete setup..." });
        await refreshAuthUser();
        await handleManageStripeAccount();
      } else {
        throw new Error("Stripe Account ID not returned from backend.");
      }
    } catch (error: any) {
      console.error("Error creating Stripe Connected Account:", error);
      toast({ title: "Connection Failed", description: error.message || "Could not start the bank connection process.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManageStripeAccount = async () => {
    setIsProcessing(true);
    toast({ title: "Redirecting to Stripe...", description: "Opening the Stripe portal to manage your account." });
    try {
      const idToken = await getUserIdToken();
      if (!idToken) throw new Error("Authentication token not available.");

      const response = await fetch(CREATE_STRIPE_ACCOUNT_LINK_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to get Stripe account link. Status: ${response.status}`);
      }
      const result = await response.json();
      if (result.url) {
        window.location.href = result.url;
      } else {
        throw new Error("Stripe account link URL not returned from backend.");
      }
    } catch (error: any) {
      console.error("Error creating Stripe Account Link:", error);
      toast({ title: "Redirection Failed", description: error.message || "Could not generate a link to Stripe.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTransferDelegate = async () => {
    if (!agency || !selectedNewDelegate) return;
    setIsTransferringDelegate(true);
    try {
      await updateDoc(doc(db, "agencies", agency.id), { paymentDelegateId: selectedNewDelegate });
      toast({ title: "Billing Rights Transferred", description: "The selected team member is now the payment account holder." });
      setSelectedNewDelegate("");
    } catch (error: any) {
      toast({ title: "Transfer Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsTransferringDelegate(false);
    }
  };

  // ===== BLOCKED STATES =====
  if (isBlockedMember || isBlockedAdmin) {
    const delegateName = agency?.team?.find(
      (m: TeamMember) => m.userId === currentDelegateId
    )?.displayName || (currentDelegateId === agency?.ownerId ? "the agency owner" : "a team member");

    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="h-6 w-6 text-primary" />
            Agency Payments
          </CardTitle>
          <CardDescription>Agency payment settings are managed by {delegateName}.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 border rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground">
              {isBlockedMember
                ? "As a team member, all agency invoices use the designated payment account holder's bank account. You do not need to connect a personal account."
                : `The payment account for this agency has already been connected by ${delegateName}. Contact the agency owner to transfer billing rights if needed.`}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ===== STATUS RENDERING FOR ACTIVE DELEGATE / OWNER =====
  const renderStatusDetails = () => {
    if (!user.stripeAccountId || user.stripeAccountStatus === 'none') {
      return <Badge variant="outline">Not Connected</Badge>;
    }
    let statusText = user.stripeAccountStatus?.replace(/_/g, ' ') || "Unknown";
    statusText = statusText.charAt(0).toUpperCase() + statusText.slice(1);

    let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
    let Icon = AlertTriangleIcon;

    switch (user.stripeAccountStatus) {
      case 'active': badgeVariant = 'default'; Icon = CheckCircle; break;
      case 'onboarding_incomplete':
      case 'pending_verification': badgeVariant = 'secondary'; Icon = Loader2; statusText = "Onboarding Incomplete"; break;
      case 'restricted':
      case 'restricted_soon': badgeVariant = 'destructive'; Icon = AlertTriangleIcon; break;
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant} className={`capitalize ${badgeVariant === 'default' ? 'bg-green-500 hover:bg-green-600 text-white' : ''}`}>
            <Icon className={`mr-1 h-3 w-3 ${badgeVariant === 'secondary' && user.stripeAccountStatus !== 'pending_verification' ? 'animate-spin' : ''}`} />
            {statusText}
          </Badge>
          {isCurrentDelegate && <Badge variant="outline" className="text-xs border-primary/40 text-primary">Agency Payment Account</Badge>}
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

        {user.stripeAccountStatus === 'onboarding_incomplete' && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-start gap-2">
            <AlertTriangleIcon className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-destructive">Action Required</p>
              <p className="text-muted-foreground mt-1">
                Your account is created, but you must click <strong>Complete Onboarding</strong> below to securely add your banking details in Stripe. Payouts cannot be processed until this is finished.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const getButtonAction = () => {
    if (!user.stripeAccountId || user.stripeAccountStatus === 'none') {
      return { text: "Connect Bank Account", handler: handleConnectStripe, Icon: LinkIcon };
    }
    if (user.stripeAccountStatus === 'onboarding_incomplete' || user.stripeAccountStatus === 'pending_verification') {
      return { text: "Complete Onboarding", handler: handleManageStripeAccount, Icon: ExternalLink };
    }
    return { text: "Manage Account via Stripe", handler: handleManageStripeAccount, Icon: ExternalLink };
  };

  const buttonAction = getButtonAction();

  // All active team members eligible to be new delegate (owner can transfer to anyone)
  const eligibleDelegates = [
    ...(agency?.team?.filter((m: TeamMember) => m.status === 'active' && m.userId !== user.uid) || []),
  ].map((m: TeamMember) => ({ uid: m.userId, name: m.displayName || m.email }));

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg width="42" height="28" viewBox="0 0 42 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-auto">
            <path d="M2.36667 25.1333C1.06667 25.1333 0 24.0667 0 22.7667C0 21.4667 1.06667 20.4 2.36667 20.4H19.5333C20.8333 20.4 21.9 21.4667 21.9 22.7667C21.9 24.0667 20.8333 25.1333 19.5333 25.1333H2.36667Z" fill="#635BFF"></path>
            <path d="M5.13333 2.86667C3.83333 2.86667 2.76667 3.93333 2.76667 5.23333V17.6C2.76667 18.9 3.83333 20 5.13333 20H16.7667C18.0667 20 19.1333 18.9 19.1333 17.6V5.23333C19.1333 3.93333 18.0667 2.86667 16.7667 2.86667H5.13333ZM11.1 14.8333C8.63333 14.8333 6.63333 12.8333 6.63333 10.3667C6.63333 7.9 8.63333 5.9 11.1 5.9C13.5667 5.9 15.5667 7.9 15.5667 10.3667C15.5667 12.8333 13.5667 14.8333 11.1 14.8333Z" fill="#635BFF"></path>
            <path d="M39.6333 2.86667H25.0667C24.4667 2.86667 23.9667 3.23333 23.7667 3.8L22.1 8.5C22.0333 8.66667 22 8.86667 22 9.03333V17.6C22 18.9 23.0667 20 24.3667 20H38.9333C39.5333 20 40.0333 19.6333 40.2333 19.1L41.9 14.4333C41.9667 14.2667 42 14.0667 42 13.9V5.23333C42 3.93333 40.9333 2.86667 39.6333 2.86667Z" fill="#635BFF"></path>
          </svg>
          Connect Bank for Payouts
        </CardTitle>
        <CardDescription>
          {isCurrentDelegate
            ? "You are the designated payment account holder for your agency."
            : "We use Stripe to securely connect your bank account and enable direct payouts from your clients."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 border rounded-lg bg-muted/50">
          {renderStatusDetails()}
        </div>

        {(!user.stripeAccountId || user.stripeAccountStatus === 'none') && (
          <div className="bg-primary/5 border border-primary/20 rounded-md p-4 flex gap-3 text-sm">
            <Lightbulb className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="font-semibold text-primary">Setup Tip: Choose "Individual" Account</p>
              <p className="text-muted-foreground mt-1">
                During the Stripe onboarding process, you will be asked for your "Type of Entity". Please ensure you select <strong>"Individual / Sole Proprietor"</strong> unless you possess formal corporate registration documents (like an LLC or C-Corp). Selecting "Company" improperly can lead to payout holds and verification failures.
              </p>
            </div>
          </div>
        )}

        {isAgencyAdmin && !hasDelegateSet && (
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-md p-3 flex gap-2 text-sm">
            <Building className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-muted-foreground">As an admin, you can connect your bank account to become the agency's payment account holder since none has been set yet.</p>
          </div>
        )}

        <Button onClick={buttonAction.handler} disabled={isProcessing} className="w-full sm:w-auto">
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <buttonAction.Icon className="mr-2 h-4 w-4" />
          )}
          {buttonAction.text}
        </Button>

        {/* Transfer Billing Rights — Owner only */}
        {isAgencyOwner && agency && eligibleDelegates.length > 0 && (
          <div className="pt-4 border-t space-y-3">
            <Label className="text-sm font-semibold flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> Transfer Billing Rights
            </Label>
            <p className="text-xs text-muted-foreground">
              Designate a different team member as the agency payment account holder. Their Stripe account will be used for all future payouts.
            </p>
            <div className="flex gap-2">
              <Select value={selectedNewDelegate} onValueChange={setSelectedNewDelegate}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a team member..." />
                </SelectTrigger>
                <SelectContent>
                  {eligibleDelegates.map((m) => (
                    <SelectItem key={m.uid} value={m.uid}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                onClick={handleTransferDelegate}
                disabled={!selectedNewDelegate || isTransferringDelegate}
              >
                {isTransferringDelegate ? <Loader2 className="h-4 w-4 animate-spin" /> : "Transfer"}
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          By connecting your account, you agree to Stripe's <a href="https://stripe.com/connect-account/legal" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Connected Account Agreement</a>.
          Verza uses Stripe for secure payment processing and does not store your sensitive financial details.
        </p>
      </CardContent>
    </Card>
  );
}

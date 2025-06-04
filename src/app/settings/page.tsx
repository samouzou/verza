
"use client";

import { PageHeader } from "@/components/page-header";
import { SubscriptionCard } from "@/components/settings/subscription-card";
import { StripeConnectCard } from "@/components/settings/stripe-connect-card";
import { useAuth } from "@/hooks/use-auth";
import { AlertCircle, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  if (!user) {
    // This case should ideally be handled by AuthGuard redirecting to login
    return (
      <div className="flex flex-col items-center justify-center h-full pt-10">
        <AlertCircle className="w-12 h-12 text-primary mb-4" />
        <p className="text-xl text-muted-foreground">Please log in to view your settings.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your account, subscription, and payment preferences."
      />
      <div className="space-y-6">
        <SubscriptionCard />
        <StripeConnectCard />
      </div>
    </>
  );
}

"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { GmailConnectCard } from "@/components/optic/gmail-connect-card";
import { LeadVault } from "@/components/optic/lead-vault";
import { useOpticGmail } from "@/hooks/use-optic-gmail";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useOpticLeads } from "@/hooks/use-optic-leads";

export default function OpticVaultPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const agencyId = user?.primaryAgencyId ?? null;
  const { leads, error, loading } = useOpticLeads(agencyId);
  const gmail = useOpticGmail({
    connected: Boolean(user?.opticGmailConnected),
    email: user?.opticGmailEmail ?? null,
  });

  if (authLoading) {
    return (
      <div className="container max-w-6xl py-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container max-w-3xl py-10">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Sign in</AlertTitle>
          <AlertDescription>Sign in to view your Optic lead vault.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl space-y-6 py-8">
      <PageHeader
        title="Optic vault"
        description="Outreach leads with Gemini draft emails — same collection as desktop Optic."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/optic">Run discovery</Link>
          </Button>
        }
      />

      {!agencyId && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Brand workspace</AlertTitle>
          <AlertDescription>
            Set up your brand on Verza to see leads scoped to your brand.
          </AlertDescription>
        </Alert>
      )}

      {agencyId && !isAgencyTeam && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Brand team</AlertTitle>
          <AlertDescription>Vault access is for brand owners, admins, and members.</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load leads</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isAgencyTeam && agencyId && (
        <GmailConnectCard
          connected={gmail.connected}
          email={gmail.email}
        />
      )}

      <LeadVault
        leads={leads}
        loading={loading && !!agencyId}
        gmailConnected={gmail.connected}
        onCreateGmailDraft={isAgencyTeam ? gmail.createDraft : undefined}
        draftingLeadId={gmail.draftingLeadId}
      />
    </div>
  );
}

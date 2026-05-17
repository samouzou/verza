"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { GmailConnectCard } from "@/components/optic/gmail-connect-card";
import { LeadVault } from "@/components/optic/lead-vault";
import { OpticCreditsBadge } from "@/components/optic/optic-credits-badge";
import { useOpticGmail } from "@/hooks/use-optic-gmail";
import { useOpticLeadOutreach } from "@/hooks/use-optic-lead-outreach";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useOpticCampaigns } from "@/hooks/use-optic-campaigns";
import { useOpticCredits } from "@/hooks/use-optic-credits";
import { useOpticLeads } from "@/hooks/use-optic-leads";

export default function OpticVaultPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const agencyId = user?.primaryAgencyId ?? null;
  const { leads, error, loading } = useOpticLeads(agencyId);
  const { campaigns, loading: campaignsLoading } = useOpticCampaigns(
    agencyId,
    user?.displayName ?? null
  );
  const [campaignFilter, setCampaignFilter] = useState("__all__");
  const gmail = useOpticGmail({
    connected: Boolean(user?.opticGmailConnected),
    email: user?.opticGmailEmail ?? null,
  });
  const outreach = useOpticLeadOutreach();
  const { balance: opticCredits, loading: creditsLoading } = useOpticCredits(agencyId);

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
        description="Qualified creators land here with a draft note you can send or drop into Gmail."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {agencyId && isAgencyTeam && (
              <OpticCreditsBadge balance={opticCredits} loading={creditsLoading} />
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/optic">Run discovery</Link>
            </Button>
          </div>
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
        campaigns={campaigns}
        campaignsLoading={campaignsLoading && !!agencyId}
        campaignFilter={campaignFilter}
        onCampaignFilterChange={setCampaignFilter}
        onOutreachToggle={isAgencyTeam ? outreach.setOutreachEmailed : undefined}
        outreachUpdatingId={outreach.updatingId}
      />
    </div>
  );
}

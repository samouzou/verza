"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { GmailConnectCard } from "@/components/optic/gmail-connect-card";
import { LeadVault } from "@/components/optic/lead-vault";
import { VaultAskPanel } from "@/components/optic/vault-ask-panel";
import { VaultRoasCard } from "@/components/optic/vault-roas-card";
import { OpticCreditsBadge } from "@/components/optic/optic-credits-badge";
import { useOpticCampaignRoasInsight } from "@/hooks/use-optic-campaign-roas";
import { useOpticGmail } from "@/hooks/use-optic-gmail";
import { useOpticLeadOutreach } from "@/hooks/use-optic-lead-outreach";
import { useOpticVaultChat } from "@/hooks/use-optic-vault-chat";
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
  const [campaignFilter, setCampaignFilter] = useState("__all__");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URLSearchParams(window.location.search).get("campaignId");
    if (fromUrl?.trim()) setCampaignFilter(fromUrl.trim());
  }, []);

  const { leads, error, loading, pagination } = useOpticLeads(agencyId, campaignFilter);
  const { campaigns, loading: campaignsLoading } = useOpticCampaigns(
    agencyId,
    user?.displayName ?? null
  );
  const {
    messages: vaultMessages,
    asking: vaultAsking,
    snapshot: vaultSnapshot,
    ask: askVault,
    clear: clearVaultChat,
  } = useOpticVaultChat();
  const scopedLeadCount = leads.length;
  const selectedCampaignTitle = useMemo(() => {
    if (campaignFilter === "__all__" || campaignFilter === "__pooled__") return undefined;
    return campaigns.find((c) => c.id === campaignFilter)?.title;
  }, [campaigns, campaignFilter]);
  const campaignScoped =
    campaignFilter !== "__all__" && campaignFilter !== "__pooled__";
  const roas = useOpticCampaignRoasInsight(campaignScoped ? campaignFilter : null);

  useEffect(() => {
    clearVaultChat();
  }, [campaignFilter, clearVaultChat]);
  const gmail = useOpticGmail({
    connected: Boolean(user?.opticGmailConnected),
    email: user?.opticGmailEmail ?? null,
  });
  const outreach = useOpticLeadOutreach();
  const { balance: opticCredits, loading: creditsLoading } = useOpticCredits(agencyId);

  if (authLoading) {
    return (
      <div className="w-full py-8">
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
    <div className="w-full space-y-6 py-8">
      <PageHeader
        title="Optic vault"
        description="Qualified creators land here with a draft you can send — plus stage, last contact, replies, and why a pass."
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
          canRead={user.opticGmailCanRead === true}
        />
      )}

      {isAgencyTeam && agencyId && campaignScoped && (
        <VaultRoasCard
          campaignTitle={selectedCampaignTitle}
          insight={roas.insight}
          loading={roas.loading}
          refreshing={roas.refreshing}
          error={roas.error}
          onRefresh={(opts) => void roas.refresh(opts)}
        />
      )}

      {isAgencyTeam && agencyId && (
        <VaultAskPanel
          campaignFilter={campaignFilter}
          campaignTitle={selectedCampaignTitle}
          leadCount={scopedLeadCount}
          messages={vaultMessages}
          asking={vaultAsking}
          snapshot={vaultSnapshot}
          disabled={loading}
          onAsk={(question) =>
            askVault(question, campaignFilter, selectedCampaignTitle)
          }
        />
      )}

      <LeadVault
        leads={leads}
        loading={loading && !!agencyId}
        pagination={pagination}
        gmailConnected={gmail.connected}
        onCreateGmailDraft={isAgencyTeam ? gmail.createDraft : undefined}
        draftingLeadId={gmail.draftingLeadId}
        onSendGmail={isAgencyTeam ? gmail.sendMessage : undefined}
        sendingLeadId={gmail.sendingLeadId}
        gmailCanRead={user.opticGmailCanRead === true}
        onReconnectGmail={isAgencyTeam ? () => void gmail.connect() : undefined}
        onLoadThread={isAgencyTeam ? gmail.loadThread : undefined}
        onLinkThread={isAgencyTeam ? (id) => void gmail.linkThread(id) : undefined}
        linkingLeadId={gmail.linkingLeadId}
        threadLeadId={gmail.threadLeadId}
        threadMessages={gmail.threadMessages}
        threadReplyCount={gmail.threadReplyCount}
        threadLoading={gmail.threadLoadingId != null}
        campaigns={campaigns}
        campaignsLoading={campaignsLoading && !!agencyId}
        campaignFilter={campaignFilter}
        onCampaignFilterChange={setCampaignFilter}
        outreachUpdatingId={outreach.updatingId}
        onCrmChange={isAgencyTeam ? outreach.setLeadCrm : undefined}
        onEmailChange={isAgencyTeam ? outreach.setLeadEmail : undefined}
        emailUpdatingId={outreach.emailUpdatingId}
        onDraftChange={isAgencyTeam ? outreach.setLeadDraft : undefined}
        draftUpdatingId={outreach.draftUpdatingId}
      />
    </div>
  );
}

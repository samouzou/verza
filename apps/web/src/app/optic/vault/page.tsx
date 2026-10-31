"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  MessageCircle,
  Settings2,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useOpticCampaigns } from "@/hooks/use-optic-campaigns";
import { useOpticCredits } from "@/hooks/use-optic-credits";
import { useOpticLeads } from "@/hooks/use-optic-leads";
import { cn } from "@/lib/utils";

type VaultSection = "leads" | "ask" | "performance" | "setup";

const VAULT_SECTIONS: { id: VaultSection; label: string; icon: LucideIcon }[] = [
  { id: "leads", label: "Leads", icon: Users },
  { id: "ask", label: "Ask", icon: MessageCircle },
  { id: "performance", label: "Performance", icon: TrendingUp },
  { id: "setup", label: "Setup", icon: Settings2 },
];

function isVaultSection(value: string | null): value is VaultSection {
  return value === "leads" || value === "ask" || value === "performance" || value === "setup";
}

function replaceVaultQuery(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (!value) params.delete(key);
    else params.set(key, value);
  }
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
}

export default function OpticVaultPage() {
  const { user, isLoading: authLoading, isAgencyTeam } = useAuth();
  const agencyId = user?.primaryAgencyId ?? null;
  const [campaignFilter, setCampaignFilter] = useState("__all__");
  const [section, setSection] = useState<VaultSection>("leads");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("campaignId");
    if (fromUrl?.trim()) setCampaignFilter(fromUrl.trim());
    const requested = params.get("section");
    if (isVaultSection(requested)) setSection(requested);
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

  const selectSection = (next: VaultSection) => {
    setSection(next);
    replaceVaultQuery({
      section: next === "leads" ? null : next,
      campaignId: campaignFilter !== "__all__" ? campaignFilter : null,
    });
  };

  const selectCampaign = (value: string) => {
    setCampaignFilter(value);
    replaceVaultQuery({
      section: section === "leads" ? null : section,
      campaignId: value !== "__all__" ? value : null,
    });
  };

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

  const showTeamVault = isAgencyTeam && !!agencyId;

  const leadVault = (
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
      threadReadOnly={gmail.threadReadOnly}
      threadSyncedByEmail={gmail.threadSyncedByEmail}
      campaigns={campaigns}
      campaignsLoading={campaignsLoading && !!agencyId}
      campaignFilter={campaignFilter}
      onCampaignFilterChange={selectCampaign}
      outreachUpdatingId={outreach.updatingId}
      onCrmChange={isAgencyTeam ? outreach.setLeadCrm : undefined}
      onEmailChange={isAgencyTeam ? outreach.setLeadEmail : undefined}
      emailUpdatingId={outreach.emailUpdatingId}
      onProfileChange={isAgencyTeam ? outreach.setLeadProfile : undefined}
      profileUpdatingId={outreach.profileUpdatingId}
      onDraftChange={isAgencyTeam ? outreach.setLeadDraft : undefined}
      draftUpdatingId={outreach.draftUpdatingId}
      onRegenerateDraft={isAgencyTeam ? outreach.regenerateLeadDraft : undefined}
      regeneratingDraftId={outreach.regeneratingDraftId}
      canAddManual={isAgencyTeam}
    />
  );

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

      {showTeamVault ? (
        <div className="grid grid-cols-1 gap-8 items-start lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-20 space-y-4">
            <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0 -mx-1 px-1">
              {VAULT_SECTIONS.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectSection(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                    {item.id === "leads" && pagination?.totalCount
                      ? (
                        <span className="ml-auto text-[10px] font-semibold tabular-nums bg-muted text-muted-foreground rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                          {pagination.totalCount > 99 ? "99+" : pagination.totalCount}
                        </span>
                      )
                      : null}
                  </button>
                );
              })}
            </nav>
            <div className="space-y-2 px-1">
              <Label className="text-xs text-muted-foreground">Campaign scope</Label>
              <Select
                value={campaignFilter}
                onValueChange={selectCampaign}
                disabled={campaignsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter by campaign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All leads</SelectItem>
                  <SelectItem value="__pooled__">
                    Pooled missions (no single campaign)
                  </SelectItem>
                  {campaigns.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {(g.title || "Campaign").slice(0, 56)}
                      {g.title && g.title.length > 56 ? "…" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            {section === "leads" ? leadVault : null}
            {section === "ask" ? (
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
            ) : null}
            {section === "performance" ? (
              campaignScoped ? (
                <VaultRoasCard
                  campaignTitle={selectedCampaignTitle}
                  insight={roas.insight}
                  loading={roas.loading}
                  refreshing={roas.refreshing}
                  error={roas.error}
                  onRefresh={(opts) => void roas.refresh(opts)}
                />
              ) : (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    Pick a campaign in the left menu to see pipeline and ROAS for that brief.
                  </CardContent>
                </Card>
              )
            ) : null}
            {section === "setup" ? (
              <GmailConnectCard
                connected={gmail.connected}
                email={gmail.email}
                canRead={user.opticGmailCanRead === true}
              />
            ) : null}
          </div>
        </div>
      ) : (
        leadVault
      )}
    </div>
  );
}

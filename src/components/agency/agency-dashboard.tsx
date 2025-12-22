
"use client";

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import type { Agency } from '@/types';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from '@/components/ui/button';
import { ExternalLink, Sparkles } from "lucide-react";
import Link from 'next/link';
import { InviteTalentCard } from './invite-talent-card';
import { CreatePayoutCard } from './create-payout-card';
import { AIGeneratorCard } from './ai-generator-card';
import { TalentRosterCard } from './talent-roster-card';
import { PayoutHistoryCard } from './payout-history-card';
import { InviteTeamMemberCard } from './invite-team-member-card';
import { TeamRosterCard } from './team-roster-card';

interface AgencyDashboardProps {
  agency: Agency;
}

export function AgencyDashboard({ agency }: AgencyDashboardProps) {
  const { user } = useAuth();
  
  const activeTalentCount = agency.talent.filter(t => t.status === 'active').length;
  const talentLimit = user?.talentLimit ?? 0;
  const atTalentLimit = activeTalentCount >= talentLimit;
  const isNotOnAgencyPlan = !user?.subscriptionPlanId?.startsWith('agency_');

  return (
    <div className="space-y-6">
      {(isNotOnAgencyPlan || atTalentLimit) && (
        <Alert className="border-primary/50 bg-primary/5 text-primary-foreground [&>svg]:text-primary">
          <Sparkles className="h-5 w-5" />
          <AlertTitle className="font-semibold text-primary">
            {atTalentLimit ? "Talent Limit Reached" : "Upgrade Your Plan"}
          </AlertTitle>
          <AlertDescription className="text-primary/90">
             {atTalentLimit 
               ? `You have reached your limit of ${talentLimit} active talents. Please upgrade to invite more.`
               : `You are not on an agency plan. Please upgrade to manage talent.`
             }
          </AlertDescription>
          <div className="mt-3">
            <Button variant="default" size="sm" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/settings">
                Manage Subscription <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <InviteTalentCard agencyId={agency.id} disabled={atTalentLimit || isNotOnAgencyPlan} />
        <InviteTeamMemberCard agencyId={agency.id} disabled={isNotOnAgencyPlan} />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CreatePayoutCard agency={agency} disabled={isNotOnAgencyPlan} />
        <AIGeneratorCard agency={agency} disabled={isNotOnAgencyPlan} />
      </div>
      
      <TalentRosterCard agency={agency} />
      <TeamRosterCard agency={agency} />
      
      <PayoutHistoryCard agencyId={agency.id} />
    </div>
  );
}

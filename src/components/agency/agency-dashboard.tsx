
"use client";

import { useState, useEffect } from 'react';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import type { Agency, UserProfileFirestoreData } from '@/types';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from '@/components/ui/button';
import { ExternalLink, Sparkles, Loader2 } from "lucide-react";
import Link from 'next/link';
import { InviteTalentCard } from './invite-talent-card';
import { CreatePayoutCard } from './create-payout-card';
import { AIGeneratorCard } from './ai-generator-card';
import { TalentRosterCard } from './talent-roster-card';
import { InviteTeamMemberCard } from './invite-team-member-card';
import { TeamRosterCard } from './team-roster-card';
import { AgencyGigsCard } from './agency-gigs-card';
import { WebhookIntegrationsCard } from './webhook-integrations-card';
import { collection, query, where, documentId, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface AgencyDashboardProps {
  agency: Agency;
  agencyOwner: UserProfile | null;
}

export function AgencyDashboard({ agency, agencyOwner }: AgencyDashboardProps) {
  const { user } = useAuth();
  const [liveProfiles, setLiveProfiles] = useState<Record<string, UserProfileFirestoreData>>({});
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);

  // Use the agency owner's subscription data if available, otherwise fall back to the current user's
  const subscriptionHolder = agencyOwner || user;

  const activeTalentCount = agency.talent.filter(t => t.status === 'active').length;
  const rawLimit = subscriptionHolder?.talentLimit;
  const talentLimit = rawLimit === 0 ? 3 : (rawLimit ?? 3);
  const atTalentLimit = activeTalentCount >= talentLimit;
  const isNotOnAgencyPlan = !subscriptionHolder?.subscriptionPlanId?.startsWith('agency_');

  const canInviteTeam = user?.isAgencyOwner || user?.agencyMemberships?.some(m => m.role === 'admin');

  useEffect(() => {
    const talentIds = agency.talent.map(t => t.userId);
    const teamIds = agency.team?.map(t => t.userId) || [];
    const allUserIds = Array.from(new Set([...talentIds, ...teamIds])).filter(id => !!id);

    if (allUserIds.length === 0) {
      setLiveProfiles({});
      setIsLoadingProfiles(false);
      return;
    }

    setIsLoadingProfiles(true);
    // Firestore limit is 30 for 'in' queries
    const usersQuery = query(
      collection(db, 'users'),
      where(documentId(), 'in', allUserIds.slice(0, 30))
    );

    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const profiles: Record<string, UserProfileFirestoreData> = {};
      snapshot.docs.forEach(doc => {
        profiles[doc.id] = doc.data() as UserProfileFirestoreData;
      });
      setLiveProfiles(profiles);
      setIsLoadingProfiles(false);
    }, (error) => {
      console.error("Error fetching live agency profiles:", error);
      setIsLoadingProfiles(false);
    });

    return () => unsubscribe();
  }, [agency.talent, agency.team]);

  return (
    <div className="space-y-6">
      {atTalentLimit && (
        <Alert className="border-primary/50 bg-primary/5 text-primary-foreground [&>svg]:text-primary">
          <Sparkles className="h-5 w-5" />
          <AlertTitle className="font-semibold text-primary">
            Talent Limit Reached
          </AlertTitle>
          <AlertDescription className="text-primary/90">
            You have reached your limit of {talentLimit} active talents. Please upgrade your plan to unlock unlimited talent, AI contract generation, and the full management suite.
          </AlertDescription>
          {user?.isAgencyOwner && (
            <div className="mt-3">
              <Button variant="default" size="sm" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/settings">
                  Manage Subscription <ExternalLink className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}
        </Alert>
      )}

      {isLoadingProfiles ? (
        <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Syncing live agency data...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <InviteTalentCard agencyId={agency.id} disabled={atTalentLimit} />
            <InviteTeamMemberCard agencyId={agency.id} disabled={!canInviteTeam} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CreatePayoutCard agency={agency} liveProfiles={liveProfiles} disabled={false} />
            <AIGeneratorCard agency={agency} liveProfiles={liveProfiles} disabled={isNotOnAgencyPlan} />
          </div>

          <TalentRosterCard agency={agency} liveProfiles={liveProfiles} />
          <TeamRosterCard agency={agency} liveProfiles={liveProfiles} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AgencyGigsCard agencyId={agency.id} />
            <WebhookIntegrationsCard agency={agency} disabled={false} />
          </div>
        </>
      )}
    </div>
  );
}

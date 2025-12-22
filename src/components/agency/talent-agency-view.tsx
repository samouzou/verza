
"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X, Briefcase, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { Agency, AgencyMembership } from '@/types';

interface TalentAgencyViewProps {
  agencies: Agency[];
  memberships: AgencyMembership[];
}

export function TalentAgencyView({ agencies, memberships }: TalentAgencyViewProps) {
  const { toast } = useToast();
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  const acceptAgencyInvitationCallable = httpsCallable(functions, 'acceptAgencyInvitation');
  const declineAgencyInvitationCallable = httpsCallable(functions, 'declineAgencyInvitation');

  const handleInvitationAction = async (agencyId: string, action: 'accept' | 'decline') => {
    setProcessingId(agencyId);
    try {
      if (action === 'accept') {
        await acceptAgencyInvitationCallable({ agencyId });
        toast({ title: "Invitation Accepted!", description: "You are now an active member of the agency." });
      } else {
        await declineAgencyInvitationCallable({ agencyId });
        toast({ title: "Invitation Declined", description: "You have declined the invitation." });
      }
    } catch (error: any) {
      console.error(`Error ${action}ing invitation for agency ${agencyId}:`, error);
      toast({ title: "Action Failed", description: error.message || "Could not process your request.", variant: "destructive" });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Briefcase className="text-primary"/> Your Agencies</CardTitle>
        <CardDescription>You are a member of or have been invited to the following agencies.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {agencies.map(agency => {
          const membership = memberships.find(m => m.agencyId === agency.id);
          const isPending = membership?.status === 'pending';

          return (
            <div key={agency.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border rounded-md bg-muted/50 gap-4">
              <div className="flex-grow">
                <div className="font-medium">{agency.name}</div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4"/>
                    <span>{agency.talent.length} Talent</span>
                </div>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                {isPending ? (
                  <>
                    <Button 
                      size="sm" 
                      variant="destructive_outline"
                      onClick={() => handleInvitationAction(agency.id, 'decline')}
                      disabled={processingId === agency.id}
                    >
                      {processingId === agency.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <X className="mr-1 h-3 w-3" />}
                      Decline
                    </Button>
                    <Button 
                      size="sm"
                      onClick={() => handleInvitationAction(agency.id, 'accept')}
                      disabled={processingId === agency.id}
                    >
                       {processingId === agency.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Check className="mr-1 h-3 w-3" />}
                      Accept
                    </Button>
                  </>
                ) : (
                   <Badge variant="default" className="bg-green-500">Active Member</Badge>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

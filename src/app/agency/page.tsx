
"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Building, Users, PlusCircle, UserPlus, Mail, Briefcase, Check, X } from 'lucide-react';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@/hooks/use-toast';
import type { Agency, AgencyMembership } from '@/types';
import { onSnapshot, collection, query, where, getDocs, documentId } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


function CreateAgencyForm({ onAgencyCreated }: { onAgencyCreated: () => void }) {
  const [agencyName, setAgencyName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();
  const createAgencyCallable = httpsCallable(functions, 'createAgency');

  const handleCreateAgency = async () => {
    if (!agencyName.trim()) {
      toast({ title: "Agency name is required", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      await createAgencyCallable({ name: agencyName.trim() });
      toast({ title: "Agency Created!", description: `${agencyName} is now ready.` });
      onAgencyCreated();
    } catch (error: any) {
      console.error("Error creating agency:", error);
      toast({ title: "Creation Failed", description: error.message || "Could not create the agency.", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Your Agency</CardTitle>
        <CardDescription>Give your agency a name to get started. You can manage talent and contracts once it's created.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="agencyName">Agency Name</Label>
          <Input 
            id="agencyName" 
            value={agencyName}
            onChange={(e) => setAgencyName(e.target.value)}
            placeholder="e.g., Creator Collective" 
            disabled={isCreating}
          />
        </div>
        <Button onClick={handleCreateAgency} disabled={isCreating || !agencyName.trim()}>
          {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building className="mr-2 h-4 w-4" />}
          Create Agency
        </Button>
      </CardContent>
    </Card>
  );
}

function AgencyDashboard({ agency }: { agency: Agency }) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const { toast } = useToast();
  const inviteTalentCallable = httpsCallable(functions, 'inviteTalentToAgency');

  const handleInviteTalent = async () => {
    if (!inviteEmail.trim() || !/^\S+@\S+\.\S+$/.test(inviteEmail)) {
      toast({ title: "Invalid Email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    setIsInviting(true);
    try {
      await inviteTalentCallable({ agencyId: agency.id, talentEmail: inviteEmail.trim() });
      toast({ title: "Invitation Sent", description: `An invitation has been sent to ${inviteEmail}.` });
      setInviteEmail("");
    } catch (error: any) {
      console.error("Error inviting talent:", error);
      toast({ title: "Invitation Failed", description: error.message || "Could not invite talent.", variant: "destructive" });
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserPlus className="text-primary"/> Invite Talent</CardTitle>
          <CardDescription>Invite creators to your agency by email. They will be added to your talent roster once they accept.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-grow">
               <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
               <Input 
                type="email" 
                placeholder="creator@example.com" 
                className="pl-10"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={isInviting}
              />
            </div>
            <Button onClick={handleInviteTalent} disabled={isInviting || !inviteEmail.trim()}>
              {isInviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
              Send Invite
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="text-primary"/> Manage Your Talent</CardTitle>
          <CardDescription>View your current roster of creators.</CardDescription>
        </CardHeader>
        <CardContent>
           {agency.talent && agency.talent.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Creator</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agency.talent.map(t => (
                  <TableRow key={t.userId}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>{t.displayName ? t.displayName.charAt(0) : 'T'}</AvatarFallback>
                      </Avatar>
                      {t.displayName || 'N/A'}
                    </TableCell>
                    <TableCell>{t.email}</TableCell>
                    <TableCell><Badge variant={t.status === 'active' ? 'default' : 'secondary'} className={`capitalize ${t.status === 'active' ? 'bg-green-500' : ''}`}>{t.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
           ) : (
            <p className="text-center text-muted-foreground py-6">Your talent roster is empty. Invite some creators to get started!</p>
           )}
        </CardContent>
      </Card>
    </div>
  );
}

function TalentAgencyView({ agencies, memberships }: { agencies: Agency[], memberships: AgencyMembership[] }) {
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


export default function AgencyPage() {
  const { user, isLoading: authLoading, refreshAuthUser } = useAuth();
  const [ownedAgencies, setOwnedAgencies] = useState<Agency[]>([]);
  const [memberAgencies, setMemberAgencies] = useState<Agency[]>([]);
  const [isLoadingAgencies, setIsLoadingAgencies] = useState(true);

  useEffect(() => {
    if (!user || authLoading) {
      if (!authLoading) setIsLoadingAgencies(false);
      return;
    }

    setIsLoadingAgencies(true);

    // Listener for agencies the user owns
    const ownerQuery = query(collection(db, "agencies"), where("ownerId", "==", user.uid));
    const unsubscribeOwner = onSnapshot(ownerQuery, (snapshot) => {
      const agencies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Agency));
      setOwnedAgencies(agencies);
      if (!user.agencyMemberships || user.agencyMemberships.length === 0) {
        setIsLoadingAgencies(false);
      }
    }, (error) => {
      console.error("Error fetching owned agencies:", error);
      setIsLoadingAgencies(false);
    });

    // Fetch agencies the user is a member of (both pending and active)
    const fetchMemberAgencies = async () => {
      const memberAgencyIds = user.agencyMemberships
        ?.map(mem => mem.agencyId)
        .filter(id => !!id) || []; // Filter out any empty/null/undefined IDs

      if (memberAgencyIds.length > 0) {
        try {
          // Firestore 'in' query can take up to 30 elements
          const memberQuery = query(collection(db, "agencies"), where(documentId(), "in", memberAgencyIds));
          const snapshot = await getDocs(memberQuery);
          const agencies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Agency));
          setMemberAgencies(agencies);
        } catch (error) {
          console.error("Error fetching member agencies:", error);
          setMemberAgencies([]);
        }
      } else {
        setMemberAgencies([]);
      }
      setIsLoadingAgencies(false);
    };

    fetchMemberAgencies();

    return () => {
      unsubscribeOwner();
    };
  }, [user, authLoading]);
  
  const handleAgencyCreated = () => {
    // Refresh auth user to get the new role and membership, which will trigger the useEffect
    refreshAuthUser();
  }

  if (authLoading || (user && isLoadingAgencies)) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Please log in to manage your agency.</p>
      </div>
    );
  }
  
  const userOwnsAnAgency = ownedAgencies.length > 0;
  const isMemberOfAnyAgency = (user.agencyMemberships?.filter(m => memberAgencies.some(a => a.id === m.agencyId)).length ?? 0) > 0;

  let pageTitle = "Agency Management";
  let pageDescription = "Create or manage your creator agency.";
  if (userOwnsAnAgency) {
    pageTitle = ownedAgencies[0].name;
    pageDescription = "Manage your agency's talent, contracts, and finances.";
  } else if (isMemberOfAnyAgency) {
    pageTitle = "My Agencies";
    pageDescription = "View and respond to agency invitations.";
  }

  return (
    <>
      <PageHeader
        title={pageTitle}
        description={pageDescription}
      />
      <div className="space-y-6">
        {userOwnsAnAgency ? (
          <AgencyDashboard agency={ownedAgencies[0]} />
        ) : isMemberOfAnyAgency ? (
          <TalentAgencyView agencies={memberAgencies} memberships={user.agencyMemberships || []} />
        ) : (
          <CreateAgencyForm onAgencyCreated={handleAgencyCreated} />
        )}
      </div>
    </>
  );
}

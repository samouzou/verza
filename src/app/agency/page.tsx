
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Building, Users, LifeBuoy } from 'lucide-react';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@/hooks/use-toast';
import type { Agency, AgencyMembership } from '@/types';
import { onSnapshot, collection, query, where, getDocs, documentId, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useTour } from '@/hooks/use-tour';
import { agencyTour } from '@/lib/tours';
import { AgencyDashboard } from '@/components/agency/agency-dashboard';
import { TalentAgencyView } from '@/components/agency/talent-agency-view';

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

export default function AgencyPage() {
  const { user, isLoading: authLoading, refreshAuthUser } = useAuth();
  const [managedAgency, setManagedAgency] = useState<Agency | null>(null);
  const [agencyOwnerData, setAgencyOwnerData] = useState<UserProfile | null>(null);
  const [memberAgencies, setMemberAgencies] = useState<Agency[]>([]);
  const [isLoadingAgencies, setIsLoadingAgencies] = useState(true);
  const { startTour } = useTour();

  const isOwner = user?.isAgencyOwner ?? false;
  const isMemberOrAdmin = user?.agencyMemberships?.some(m => (m.role === 'admin' || m.role === 'member') && m.status === 'active') ?? false;
  const canManage = isOwner || isMemberOrAdmin;

  useEffect(() => {
    if (!user || authLoading) {
      if (!authLoading) setIsLoadingAgencies(false);
      return;
    }
    
    setIsLoadingAgencies(true);
    let unsubscribe: (() => void) | undefined;
    
    const managementMembership = user.agencyMemberships?.find(m => m.role === 'owner' || m.role === 'admin' || m.role === 'member');
    const managementAgencyId = user.primaryAgencyId || managementMembership?.agencyId;

    if (canManage && managementAgencyId) {
      const agencyDocRef = doc(db, "agencies", managementAgencyId);
      unsubscribe = onSnapshot(agencyDocRef, async (docSnap) => {
        if (docSnap.exists()) {
          const agencyData = { id: docSnap.id, ...docSnap.data() } as Agency;
          setManagedAgency(agencyData);
          
          // Fetch the agency owner's user data for subscription info
          if (agencyData.ownerId) {
            const ownerDocRef = doc(db, "users", agencyData.ownerId);
            const ownerDocSnap = await getDoc(ownerDocRef);
            if (ownerDocSnap.exists()) {
              setAgencyOwnerData(ownerDocSnap.data() as UserProfile);
            } else {
              setAgencyOwnerData(null);
            }
          }
        } else {
          setManagedAgency(null);
          setAgencyOwnerData(null);
        }
        setIsLoadingAgencies(false);
      }, (error) => {
        console.error("Error fetching managed agency:", error);
        setManagedAgency(null);
        setAgencyOwnerData(null);
        setIsLoadingAgencies(false);
      });
    } else {
        const memberAgencyIds = user.agencyMemberships?.map(mem => mem.agencyId).filter(id => !!id) || [];
        if (memberAgencyIds.length > 0) {
          const memberQuery = query(collection(db, "agencies"), where(documentId(), "in", memberAgencyIds));
          unsubscribe = onSnapshot(memberQuery, (snapshot) => {
             setMemberAgencies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Agency)));
             setIsLoadingAgencies(false);
          }, (error) => {
            console.error("Error fetching member agencies:", error);
            setMemberAgencies([]);
            setIsLoadingAgencies(false);
          });
        } else {
            setIsLoadingAgencies(false);
        }
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, authLoading, canManage]);
  
  const handleAgencyCreated = () => {
    refreshAuthUser();
  };

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
  
  let pageTitle = "Agency Management";
  let pageDescription = "Create or manage your creator agency.";

  if (managedAgency && canManage) {
    pageTitle = managedAgency.name;
    pageDescription = "Manage your agency's talent, team, and finances.";
  } else if (memberAgencies.length > 0) {
    pageTitle = "My Agencies";
    pageDescription = "View and respond to agency invitations.";
  }

  return (
    <>
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        actions={canManage && managedAgency ? <Button variant="outline" onClick={() => startTour(agencyTour)}><LifeBuoy className="mr-2 h-4 w-4" /> Take a Tour</Button> : undefined}
      />
      <div className="space-y-6">
        {canManage && managedAgency ? (
          <AgencyDashboard agency={managedAgency} agencyOwner={agencyOwnerData} />
        ) : memberAgencies.length > 0 ? (
          <TalentAgencyView agencies={memberAgencies} memberships={user.agencyMemberships || []} />
        ) : (
          <CreateAgencyForm onAgencyCreated={handleAgencyCreated} />
        )}
      </div>
    </>
  );
}

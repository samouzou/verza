
"use client";

import { useState, useEffect } from 'react';
import { useAuth, type UserProfile } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Building, Users, LifeBuoy, ArrowLeft, Briefcase, ChevronRight, PlusCircle, Shield } from 'lucide-react';
import { functions, db } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@/hooks/use-toast';
import type { Agency } from '@/types';
import { onSnapshot, collection, query, where, documentId, doc, getDoc } from 'firebase/firestore';
import { useTour } from '@/hooks/use-tour';
import { agencyTour } from '@/lib/tours';
import { AgencyDashboard } from '@/components/agency/agency-dashboard';
import { TalentAgencyView } from '@/components/agency/talent-agency-view';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';

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
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [isLoadingAgencies, setIsLoadingAgencies] = useState(true);
  const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(null);
  const [selectedAgencyOwner, setSelectedAgencyOwner] = useState<UserProfile | null>(null);
  const { startTour } = useTour();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!user || authLoading) {
      if (!authLoading) setIsLoadingAgencies(false);
      return;
    }

    setIsLoadingAgencies(true);
    
    const membershipIds = user.agencyMemberships?.map(m => m.agencyId) || [];
    const giggingIds = user.giggingForAgencies || [];
    const allAgencyIds = Array.from(new Set([...membershipIds, ...giggingIds, user.primaryAgencyId])).filter(id => !!id) as string[];

    if (allAgencyIds.length === 0) {
      setIsLoadingAgencies(false);
      return;
    }

    const q = query(collection(db, "agencies"), where(documentId(), "in", allAgencyIds.slice(0, 30)));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedAgencies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Agency));
      setAgencies(fetchedAgencies);
      
      if (fetchedAgencies.length === 1 && !selectedAgencyId) {
        setSelectedAgencyId(fetchedAgencies[0].id);
      }
      
      setIsLoadingAgencies(false);
    }, (error) => {
      console.error("Error fetching agencies:", error);
      toast({ title: "Error", description: "Could not fetch agency list.", variant: "destructive" });
      setIsLoadingAgencies(false);
    });

    return () => unsubscribe();
  }, [user, authLoading, selectedAgencyId, toast]);

  useEffect(() => {
    if (!selectedAgencyId || !agencies.length) return;
    
    const agency = agencies.find(a => a.id === selectedAgencyId);
    if (!agency) return;

    const fetchOwner = async () => {
      try {
        const ownerSnap = await getDoc(doc(db, 'users', agency.ownerId));
        if (ownerSnap.exists()) {
          setSelectedAgencyOwner(ownerSnap.data() as UserProfile);
        }
      } catch (e) {
        console.error("Error fetching agency owner:", e);
      }
    };
    fetchOwner();
  }, [selectedAgencyId, agencies]);

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
        <p className="text-muted-foreground">Please log in to manage your agencies.</p>
      </div>
    );
  }

  if (selectedAgencyId) {
    const agency = agencies.find(a => a.id === selectedAgencyId);
    if (agency) {
      const membership = user.agencyMemberships?.find(m => m.agencyId === agency.id);
      const isPending = membership?.status === 'pending';
      const isManager = agency.ownerId === user.uid || (membership && membership.status === 'active' && (membership.role === 'admin' || membership.role === 'member'));
      
      return (
        <>
          <PageHeader
            title={agency.name}
            description={isPending ? "You have been invited to join this agency." : isManager ? "Agency Management Dashboard" : "Your relationship with this agency."}
            actions={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setSelectedAgencyId(null)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Switch Agency
                </Button>
                {isManager && !isPending && <Button variant="outline" onClick={() => startTour(agencyTour)}><LifeBuoy className="mr-2 h-4 w-4" /> Take a Tour</Button>}
              </div>
            }
          />
          <div className="space-y-6">
            {isPending ? (
              <TalentAgencyView agencies={[agency]} memberships={user.agencyMemberships || []} />
            ) : isManager ? (
              <AgencyDashboard agency={agency} agencyOwner={selectedAgencyOwner} />
            ) : (
              <TalentAgencyView agencies={[agency]} memberships={user.agencyMemberships || []} />
            )}
          </div>
        </>
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Agency Hub"
        description="Select an agency to manage or view your representation."
      />
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agencies.length > 0 ? (
          agencies.map(agency => {
            const membership = user.agencyMemberships?.find(m => m.agencyId === agency.id);
            const isPending = membership?.status === 'pending';
            const isOwner = agency.ownerId === user.uid;
            const isTalent = membership?.role === 'talent';
            
            return (
              <Card key={agency.id} className="hover:shadow-md transition-shadow cursor-pointer group" onClick={() => setSelectedAgencyId(agency.id)}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-lg truncate pr-2">{agency.name}</CardTitle>
                  <Briefcase className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {isOwner && <Badge className="bg-purple-500">Owner</Badge>}
                    {isPending && <Badge variant="secondary" className="animate-pulse">Pending Invite</Badge>}
                    {isTalent && <Badge variant="outline">Talent</Badge>}
                    {membership && !isTalent && !isOwner && !isPending && <Badge variant="secondary">{membership.role}</Badge>}
                  </div>
                  <div className="flex items-center text-sm text-muted-foreground gap-4">
                    <span className="flex items-center gap-1"><Users className="h-4 w-4" /> {agency.talent?.length || 0} Talent</span>
                    {agency.team && <span className="flex items-center gap-1"><Shield className="h-4 w-4" /> {agency.team.length} Team</span>}
                  </div>
                </CardContent>
                <CardFooter className="pt-0 border-t bg-muted/5 group-hover:bg-muted/20 transition-colors">
                  <Button variant="ghost" className="w-full justify-between mt-2" onClick={(e) => { e.stopPropagation(); setSelectedAgencyId(agency.id); }}>
                    {isPending ? 'View Invitation' : (isOwner || (membership && membership.role !== 'talent') ? 'Manage Agency' : 'View Representation')}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            );
          })
        ) : (
          <div className="col-span-full">
            <CreateAgencyForm onAgencyCreated={handleAgencyCreated} />
          </div>
        )}
        
        {agencies.length > 0 && !user.isAgencyOwner && (
          <Card className="border-dashed border-2 flex flex-col items-center justify-center p-6 text-center hover:bg-muted/5 transition-colors cursor-pointer" onClick={() => router.push('/onboarding')}>
            <PlusCircle className="h-10 w-10 text-muted-foreground mb-4" />
            <CardTitle className="text-base">Start Your Own Agency</CardTitle>
            <CardDescription className="mt-1">Manage your own roster and brand deals.</CardDescription>
          </Card>
        )}
      </div>
    </>
  );
}

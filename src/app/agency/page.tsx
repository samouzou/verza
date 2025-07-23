
"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Building, Users } from 'lucide-react';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@/hooks/use-toast';
import type { Agency } from '@/types';
import { onSnapshot, collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const CREATE_AGENCY_FUNCTION_URL = "https://createagency-cpmccwbluq-uc.a.run.app";

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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="text-primary"/> Manage Your Talent</CardTitle>
        <CardDescription>Invite creators to your agency and manage their contracts and payouts.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Talent management features coming soon!</p>
        {/* Placeholder for talent list and invite form */}
      </CardContent>
    </Card>
  );
}

export default function AgencyPage() {
  const { user, isLoading: authLoading, refreshAuthUser } = useAuth();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [isLoadingAgencies, setIsLoadingAgencies] = useState(true);

  useEffect(() => {
    if (user && user.role === 'agency_owner') {
      setIsLoadingAgencies(true);
      const agencyQuery = query(collection(db, "agencies"), where("ownerId", "==", user.uid));
      const unsubscribe = onSnapshot(agencyQuery, 
        (snapshot) => {
          const userAgencies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Agency));
          setAgencies(userAgencies);
          setIsLoadingAgencies(false);
        }, 
        (error) => {
          console.error("Error fetching agencies:", error);
          setIsLoadingAgencies(false);
        }
      );
      return () => unsubscribe();
    } else if (user) {
      // User is not an agency owner, no need to query
      setIsLoadingAgencies(false);
    }
  }, [user]);

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
  
  const userOwnsAgency = user.role === 'agency_owner' && agencies.length > 0;

  return (
    <>
      <PageHeader
        title={userOwnsAgency ? agencies[0].name : "Agency Management"}
        description={userOwnsAgency ? "Manage your agency's talent, contracts, and finances." : "Create and manage your creator agency."}
      />
      <div className="space-y-6">
        {userOwnsAgency ? <AgencyDashboard agency={agencies[0]} /> : <CreateAgencyForm onAgencyCreated={refreshAuthUser} />}
      </div>
    </>
  );
}

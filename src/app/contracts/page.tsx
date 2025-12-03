
"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { ContractList } from "@/components/contracts/contract-list";
import { UploadContractDialog } from "@/components/contracts/upload-contract-dialog";
import type { Agency, Contract, UserProfile } from "@/types";
import { Input } from "@/components/ui/input";
import { Search, Download, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, onSnapshot, orderBy as firestoreOrderBy, Timestamp, getDocs, doc } from '@/lib/firebase';
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTour } from "@/hooks/use-tour";
import { contractsTour } from "@/lib/tours";

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isLoadingContracts, setIsLoadingContracts] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const { startTour } = useTour();
  
  const [agencyForDialog, setAgencyForDialog] = useState<Agency | null>(null);

  useEffect(() => {
    if (!user || authLoading) {
        if (!authLoading) setIsLoadingContracts(false);
        return;
    }

    setIsLoadingContracts(true);
    const contractsCol = collection(db, 'contracts');
    let unsubscribe: (() => void) | undefined;

    const mapDocToContract = (doc: any): Contract => {
        const data = doc.data();
        // Ensure Timestamps are correctly handled, defaulting to now() if invalid/missing
        const createdAt = data.createdAt instanceof Timestamp ? data.createdAt : (data.createdAt?.seconds ? new Timestamp(data.createdAt.seconds, data.createdAt.nanoseconds) : Timestamp.now());
        const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt : (data.updatedAt?.seconds ? new Timestamp(data.updatedAt.seconds, data.updatedAt.nanoseconds) : createdAt);
        
        return { 
            id: doc.id, 
            ...data,
            createdAt: createdAt,
            updatedAt: updatedAt,
            status: data.status || 'pending',
            invoiceStatus: data.invoiceStatus || 'none',
        } as Contract;
    };
    
    // Determine the agency context first
    const agencyId = user.isAgencyOwner 
        ? user.agencyMemberships?.[0]?.agencyId 
        : user.primaryAgencyId;
        
    if (agencyId) {
        const agencyDocRef = doc(db, "agencies", agencyId);
        getDoc(agencyDocRef).then(docSnap => {
            if (docSnap.exists()) {
                setAgencyForDialog({ id: docSnap.id, ...docSnap.data() } as Agency);
            }
        });
    } else {
        setAgencyForDialog(null);
    }


    if (user.isAgencyOwner) {
        const agencyId = user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId;
        if (!agencyId) {
            setIsLoadingContracts(false);
            return;
        }
        
        // Agency owners need to see their personal contracts AND all agency contracts.
        const fetchAllAgencyData = async () => {
            try {
                const agencyQuery = query(contractsCol, where('ownerId', '==', agencyId));
                const personalQuery = query(contractsCol, where('ownerType', '==', 'user'), where('userId', '==', user.uid));
                
                const [agencySnapshot, personalSnapshot] = await Promise.all([
                    getDocs(agencyQuery),
                    getDocs(personalQuery),
                ]);

                const agencyContracts = agencySnapshot.docs.map(mapDocToContract);
                const personalContracts = personalSnapshot.docs.map(mapDocToContract);
                
                const contractMap = new Map<string, Contract>();
                [...agencyContracts, ...personalContracts].forEach(c => contractMap.set(c.id, c));
                
                const combinedContracts = Array.from(contractMap.values()).sort((a,b) => b.createdAt.toMillis() - a.createdAt.toMillis());
                setContracts(combinedContracts);

            } catch (error) {
                 console.error("Error fetching all agency/personal contracts:", error);
                 toast({ title: "Error", description: "Could not fetch all contracts.", variant: "destructive" });
            } finally {
                setIsLoadingContracts(false);
            }
        };
        fetchAllAgencyData();

    } else if (user.primaryAgencyId) {
        // This is a team member, they see all agency contracts
        const agencyQuery = query(contractsCol, where('ownerId', '==', user.primaryAgencyId), firestoreOrderBy('createdAt', 'desc'));
        unsubscribe = onSnapshot(agencyQuery, (snapshot) => {
            const fetchedContracts = snapshot.docs.map(mapDocToContract);
            setContracts(fetchedContracts);
            setIsLoadingContracts(false);
        }, (error) => {
            console.error("Error fetching team member contracts:", error);
            toast({ title: "Error", description: "Could not fetch agency contracts.", variant: "destructive" });
            setIsLoadingContracts(false);
        });

    } else if (user.agencyMemberships?.some(m => m.role === 'talent')) {
        // This is a talent, they see their personal contracts AND agency contracts where they are the talent
         const fetchTalentData = async () => {
            try {
                const personalQuery = query(contractsCol, where('ownerType', '==', 'user'), where('userId', '==', user.uid));
                const agencyTalentQuery = query(contractsCol, where('ownerType', '==', 'agency'), where('userId', '==', user.uid));
                
                const [personalSnapshot, agencyTalentSnapshot] = await Promise.all([
                    getDocs(personalQuery),
                    getDocs(agencyTalentQuery),
                ]);

                const personalContracts = personalSnapshot.docs.map(mapDocToContract);
                const agencyTalentContracts = agencyTalentSnapshot.docs.map(mapDocToContract);

                const contractMap = new Map<string, Contract>();
                [...personalContracts, ...agencyTalentContracts].forEach(c => contractMap.set(c.id, c));
                
                const combinedContracts = Array.from(contractMap.values()).sort((a,b) => b.createdAt.toMillis() - a.createdAt.toMillis());
                setContracts(combinedContracts);
                
            } catch (error) {
                 console.error("Error fetching talent contracts:", error);
                 toast({ title: "Error", description: "Could not fetch your contracts.", variant: "destructive" });
            } finally {
                setIsLoadingContracts(false);
            }
        };
        fetchTalentData();

    } else {
        // This is an individual creator with no agency affiliations
        const individualQuery = query(contractsCol, where('ownerType', '==', 'user'), where('userId', '==', user.uid), firestoreOrderBy('createdAt', 'desc'));
        unsubscribe = onSnapshot(individualQuery, (snapshot) => {
            const fetchedContracts = snapshot.docs.map(mapDocToContract);
            setContracts(fetchedContracts);
            setIsLoadingContracts(false);
        }, (error) => {
            console.error("Error fetching individual contracts:", error);
            toast({ title: "Error", description: "Could not fetch your contracts.", variant: "destructive" });
            setIsLoadingContracts(false);
        });
    }
    
    return () => {
        if (unsubscribe) {
            unsubscribe();
        }
    };
    
  }, [user, authLoading, toast]);


  const filteredContracts = contracts.filter(contract =>
    (contract.brand || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (contract.fileName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (contract.contractType || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderContractList = () => {
    if (authLoading || (user && isLoadingContracts)) {
      return (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      );
    }
    if (!user) {
      return <p className="text-muted-foreground mt-4">Please log in to view your contracts.</p>;
    }
    if (contracts.length === 0 && !isLoadingContracts) {
      return <p className="text-muted-foreground mt-4">No contracts found. Add your first contract to get started!</p>;
    }
    return <ContractList contracts={filteredContracts} />;
  };

  return (
    <>
      <PageHeader
        title="Contracts"
        description="Manage all your brand deals and agreements."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => startTour(contractsTour)}><LifeBuoy className="mr-2 h-4 w-4" /> Take a Tour</Button>
            {user && <UploadContractDialog userProfile={user} agency={agencyForDialog}/>}
          </div>
        }
      />

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            id="contract-search-input"
            type="search"
            placeholder="Search contracts by brand, file, or type..."
            className="pl-10 w-full md:w-1/2 lg:w-1/3"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={!user || isLoadingContracts} 
          />
        </div>
      </div>
      
      {renderContractList()}
    </>
  );
}

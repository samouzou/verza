
"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { ContractList } from "@/components/contracts/contract-list";
import { UploadContractDialog } from "@/components/contracts/upload-contract-dialog";
import type { Contract } from "@/types";
import { Input } from "@/components/ui/input";
import { Search, Download, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, onSnapshot, orderBy as firestoreOrderBy, Timestamp, getDocs } from '@/lib/firebase';
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

  useEffect(() => {
    if (!user || authLoading) {
      if (!authLoading) setIsLoadingContracts(false);
      return;
    }

    setIsLoadingContracts(true);

    const processAndSetContracts = (newContracts: Contract[]) => {
      const processed = newContracts.map(data => {
        // ... (Timestamp processing logic remains the same)
        const effectiveDisplayStatus: Contract['status'] = data.status || 'pending';
        // (Status calculation logic can be simplified or enhanced here if needed)
        return { ...data, status: effectiveDisplayStatus } as Contract;
      });

      // Deduplicate and set contracts
      const contractMap = new Map<string, Contract>();
      processed.forEach(c => contractMap.set(c.id, c));
      setContracts(Array.from(contractMap.values()));
    };

    const contractsCol = collection(db, 'contracts');
    let unsubscribe: () => void = () => {};

    if (user.isAgencyOwner) {
        const agencyId = user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId;
        if (agencyId) {
            // Query for agency-owned contracts
            const agencyQuery = query(contractsCol, where('ownerType', '==', 'agency'), where('ownerId', '==', agencyId));
            // Query for owner's personal contracts
            const personalQuery = query(contractsCol, where('ownerType', '==', 'user'), where('userId', '==', user.uid));

            const agencyUnsubscribe = onSnapshot(agencyQuery, async (agencySnapshot) => {
                const agencyContracts = agencySnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Contract));
                // Manually get personal contracts to merge, as combining onSnapshot is complex
                const personalSnapshot = await getDocs(personalQuery);
                const personalContracts = personalSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Contract));
                processAndSetContracts([...agencyContracts, ...personalContracts]);
                setIsLoadingContracts(false);
            }, (error) => {
                console.error("Error fetching agency contracts:", error);
                toast({ title: "Error", description: "Could not fetch agency contracts.", variant: "destructive" });
                setIsLoadingContracts(false);
            });
            
            // Also listen to personal contracts for real-time updates
             const personalUnsubscribe = onSnapshot(personalQuery, async (personalSnapshot) => {
                const personalContracts = personalSnapshot.docs.map(d => ({ id: d.id, ...d.data()} as Contract));
                 const agencySnapshot = await getDocs(agencyQuery);
                 const agencyContracts = agencySnapshot.docs.map(d => ({ id: d.id, ...d.data()} as Contract));
                 processAndSetContracts([...agencyContracts, ...personalContracts]);
            });
            
            unsubscribe = () => {
              agencyUnsubscribe();
              personalUnsubscribe();
            }

        } else {
            // Fallback for agency owner without a proper agencyId (should not happen)
            setIsLoadingContracts(false);
            setContracts([]);
        }
    } else if (user.primaryAgencyId) {
        // This is a team member
        const q = query(contractsCol, where('ownerType', '==', 'agency'), where('ownerId', '==', user.primaryAgencyId));
        unsubscribe = onSnapshot(q, (snapshot) => {
            processAndSetContracts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Contract)));
            setIsLoadingContracts(false);
        }, (error) => {
            console.error("Error fetching team contracts:", error);
            toast({ title: "Error", description: "Could not fetch team contracts.", variant: "destructive" });
            setIsLoadingContracts(false);
        });
    } else {
        // This is an individual creator
        const q = query(contractsCol, where('ownerType', '==', 'user'), where('userId', '==', user.uid));
        unsubscribe = onSnapshot(q, (snapshot) => {
            processAndSetContracts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Contract)));
            setIsLoadingContracts(false);
        }, (error) => {
            console.error("Error fetching personal contracts:", error);
            toast({ title: "Error", description: "Could not fetch your contracts.", variant: "destructive" });
            setIsLoadingContracts(false);
        });
    }
    
    return () => unsubscribe();
    
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
            {user && <UploadContractDialog />}
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

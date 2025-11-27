
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

    const contractsCol = collection(db, 'contracts');
    let q: any;
    let unsubscribe: (() => void) | undefined;

    if (user.isAgencyOwner) {
        const agencyId = user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId;
        if (!agencyId) {
            setIsLoadingContracts(false);
            return;
        }

        const fetchAllAgencyData = async () => {
            try {
                const agencyQuery = query(contractsCol, where('ownerType', '==', 'agency'), where('ownerId', '==', agencyId));
                const personalQuery = query(contractsCol, where('ownerType', '==', 'user'), where('userId', '==', user.uid));
                
                const [agencySnapshot, personalSnapshot] = await Promise.all([
                    getDocs(agencyQuery),
                    getDocs(personalQuery),
                ]);

                const mapDocToContract = (doc: any): Contract => {
                    const data = doc.data();
                    return { id: doc.id, ...data } as Contract;
                };

                const agencyContracts = agencySnapshot.docs.map(mapDocToContract);
                const personalContracts = personalSnapshot.docs.map(mapDocToContract);

                const contractMap = new Map<string, Contract>();
                [...agencyContracts, ...personalContracts].forEach(c => contractMap.set(c.id, c));
                
                setContracts(Array.from(contractMap.values()));
            } catch (error) {
                 console.error("Error fetching all agency/personal contracts:", error);
                 toast({ title: "Error", description: "Could not fetch all contracts.", variant: "destructive" });
            } finally {
                setIsLoadingContracts(false);
            }
        };

        fetchAllAgencyData();
        // For simplicity in this complex query scenario, we are not using a real-time listener.
        // This means the user may need to refresh to see new contracts added by team members.
        // A production app might implement a more sophisticated real-time solution.

    } else {
        if (user.primaryAgencyId) {
            // This is a team member
            q = query(contractsCol, where('ownerType', '==', 'agency'), where('ownerId', '==', user.primaryAgencyId));
        } else {
            // This is an individual creator
            q = query(contractsCol, where('ownerType', '==', 'user'), where('userId', '==', user.uid));
        }
        
        unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedContracts = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Contract));
            setContracts(fetchedContracts);
            setIsLoadingContracts(false);
        }, (error) => {
            console.error("Error fetching contracts:", error);
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

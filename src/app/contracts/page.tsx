
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
import { db, collection, query, where, onSnapshot, orderBy as firestoreOrderBy, Timestamp, getDoc, doc, getDocs } from '@/lib/firebase';
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
    let unsubscribe: (() => void) | undefined;
    const unsubscribes: (()=>void)[] = [];

    const mapDocToContract = (doc: any): Contract => {
        const data = doc.data();
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
    
    // Determine the agency ID for the dialog, whether owner or team member
    const agencyIdForDialog = user.isAgencyOwner 
        ? user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId
        : user.primaryAgencyId;
        
    if (agencyIdForDialog) {
        const agencyDocRef = doc(db, "agencies", agencyIdForDialog);
        getDoc(agencyDocRef).then(docSnap => {
            if (docSnap.exists()) {
                setAgencyForDialog({ id: docSnap.id, ...docSnap.data() } as Agency);
            }
        });
    } else {
        setAgencyForDialog(null);
    }

    const contractsCol = collection(db, 'contracts');

    // This combined function will replace the old logic
    const setupListeners = async () => {
        const agencyId = user.primaryAgencyId || user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId;

        // Listener for personal contracts (for owners)
        if (user.isAgencyOwner) {
            const personalQuery = query(contractsCol, where('userId', '==', user.uid), where('ownerType', '!=', 'agency'));
            const unsubPersonal = onSnapshot(personalQuery, (snapshot) => {
                const personalContracts = snapshot.docs.map(mapDocToContract);
                setContracts(current => {
                    const otherContracts = current.filter(c => c.userId !== user.uid || c.ownerType === 'agency');
                    return [...otherContracts, ...personalContracts].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
                });
            });
            unsubscribes.push(unsubPersonal);
        }

        // Listener for agency-related contracts (for owners and team members)
        if (agencyId) {
            const agencyDocRef = doc(db, "agencies", agencyId);
            const unsubAgencyDoc = onSnapshot(agencyDocRef, (agencySnap) => {
                if (agencySnap.exists()) {
                    const agencyData = agencySnap.data() as Agency;
                    const talentIds = agencyData.talent?.map(t => t.userId) || [];
                    const allUserIds = [...new Set([agencyData.ownerId, ...talentIds])];

                    // Now, query for all contracts associated with these users OR the agency itself
                    if (allUserIds.length > 0) {
                        const agencyContractsQuery = query(
                            contractsCol,
                            where('ownerType', '==', 'agency'),
                            where('ownerId', '==', agencyId)
                        );
                        
                        const talentContractsQuery = query(
                            contractsCol,
                            where('userId', 'in', allUserIds),
                            where('ownerType', '!=', 'agency') // To avoid duplicates if a talent is also an owner of another agency
                        );
                        
                        const unsubAgencyContracts = onSnapshot(agencyContractsQuery, (agencyContractsSnap) => {
                           const agencyContracts = agencyContractsSnap.docs.map(mapDocToContract);
                           setContracts(current => {
                               const filteredCurrent = current.filter(c => c.ownerType !== 'agency' || c.ownerId !== agencyId);
                               return [...filteredCurrent, ...agencyContracts].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
                           });
                        });
                        
                         // This part has a limitation: `in` queries are limited to 30 items.
                         // For larger agencies, a different data model would be needed.
                        const unsubTalentContracts = onSnapshot(talentContractsQuery, (talentContractsSnap) => {
                           const talentContracts = talentContractsSnap.docs.map(mapDocToContract);
                           setContracts(current => {
                                const filteredCurrent = current.filter(c => !allUserIds.includes(c.userId) || c.ownerType === 'agency');
                               return [...filteredCurrent, ...talentContracts].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
                           });
                        });
                        unsubscribes.push(unsubAgencyContracts, unsubTalentContracts);
                    }
                }
                 setIsLoadingContracts(false);
            }, (error) => {
                 console.error("Error fetching agency document:", error);
                 toast({ title: "Error", description: "Could not fetch agency details for contract lookup.", variant: "destructive" });
                 setIsLoadingContracts(false);
            });
            unsubscribes.push(unsubAgencyDoc);
        } else if (!user.isAgencyOwner) {
            // Individual user (not owner, not team member)
             const personalQuery = query(contractsCol, where('userId', '==', user.uid), where('ownerType', '!=', 'agency'));
             const unsub = onSnapshot(personalQuery, (snapshot) => {
                setContracts(snapshot.docs.map(mapDocToContract));
                setIsLoadingContracts(false);
             }, (error) => {
                console.error("Error fetching individual contracts:", error);
                toast({ title: "Error", description: "Could not fetch your contracts.", variant: "destructive" });
                setIsLoadingContracts(false);
             });
             unsubscribes.push(unsub);
        }
    };

    setupListeners();
    
    return () => {
        unsubscribes.forEach(unsub => unsub());
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

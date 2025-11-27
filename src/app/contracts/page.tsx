
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
import { db, collection, query, where, onSnapshot, orderBy as firestoreOrderBy, Timestamp, documentId } from '@/lib/firebase';
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
      return newContracts.map(data => {
        let createdAtTimestamp: Timestamp;
        if (data.createdAt instanceof Timestamp) {
          createdAtTimestamp = data.createdAt;
        } else if (data.createdAt && typeof (data.createdAt as any).seconds === 'number') {
          createdAtTimestamp = new Timestamp((data.createdAt as any).seconds, (data.createdAt as any).nanoseconds);
        } else {
          createdAtTimestamp = Timestamp.now();
        }

        let updatedAtTimestamp: Timestamp | undefined = undefined;
        if (data.updatedAt instanceof Timestamp) {
          updatedAtTimestamp = data.updatedAt;
        } else if (data.updatedAt && typeof (data.updatedAt as any).seconds === 'number') {
            updatedAtTimestamp = new Timestamp((data.updatedAt as any).seconds, (data.updatedAt as any).nanoseconds);
        } else if (typeof data.updatedAt === 'string') {
            updatedAtTimestamp = Timestamp.fromDate(new Date(data.updatedAt));
        }

        let effectiveDisplayStatus: Contract['status'] = data.status || 'pending';
        const invoiceStatus = data.invoiceStatus || 'none';
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        const contractDueDate = data.dueDate ? new Date(data.dueDate + 'T00:00:00') : null;

        if (invoiceStatus === 'paid') {
          effectiveDisplayStatus = 'paid';
        } else if (invoiceStatus === 'overdue') {
          effectiveDisplayStatus = 'overdue';
        } else if ((invoiceStatus === 'sent' || invoiceStatus === 'viewed') && contractDueDate && contractDueDate < todayMidnight) {
          effectiveDisplayStatus = 'overdue';
        } else if (invoiceStatus === 'sent' || invoiceStatus === 'viewed') {
          effectiveDisplayStatus = 'invoiced';
        } else if (effectiveDisplayStatus === 'pending' && contractDueDate && contractDueDate < todayMidnight) {
          effectiveDisplayStatus = 'overdue';
        }

        return {
          ...data,
          createdAt: createdAtTimestamp,
          updatedAt: updatedAtTimestamp,
          status: effectiveDisplayStatus,
          invoiceStatus: invoiceStatus,
        } as Contract;
      });
    };

    const contractsCol = collection(db, 'contracts');
    let q;

    // Agency Owner: See all their agency contracts and their personal contracts
    if (user.isAgencyOwner) {
       const agencyId = user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId;
       q = query(
         contractsCol,
         where('ownerId', '==', agencyId),
         where('ownerType', '==', 'agency')
         // Note: to also see personal contracts, we'd need a composite query or a separate listener.
         // For now, focusing on the primary agency role.
       );
    } 
    // Agency Team Member: See all contracts for their primary agency
    else if (user.primaryAgencyId) {
      q = query(
        contractsCol,
        where('ownerId', '==', user.primaryAgencyId),
        where('ownerType', '==', 'agency')
      );
    } 
    // Individual Creator: See only their personal contracts
    else {
      q = query(
        contractsCol,
        where('userId', '==', user.uid),
        where('ownerType', '==', 'user') // Explicitly check for personal contracts
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const contractList = processAndSetContracts(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Contract)));
      setContracts(contractList);
      setIsLoadingContracts(false);
    }, (error) => {
      console.error("Error fetching contracts:", error);
      toast({ title: "Error", description: "Could not fetch contracts.", variant: "destructive" });
      setIsLoadingContracts(false);
    });

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

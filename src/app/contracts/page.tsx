
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
import { db, collection, query, where, onSnapshot, orderBy as firestoreOrderBy, Timestamp } from '@/lib/firebase';
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
    const unsubscribes: (() => void)[] = [];
  
    const processAndSetContracts = (newContracts: Contract[], existingContracts: Contract[]) => {
      const processed = newContracts.map(data => {
        // ... (your existing timestamp processing logic)
        return {
          ...data,
          // ... (ensure timestamps are valid)
        } as Contract;
      });
  
      // Combine and deduplicate
      const contractMap = new Map<string, Contract>();
      existingContracts.forEach(c => contractMap.set(c.id, c));
      processed.forEach(c => contractMap.set(c.id, c));
      
      const all = Array.from(contractMap.values());
      all.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
      setContracts(all);
    };
  
    // Listener for personal contracts
    const personalQuery = query(contractsCol, where('userId', '==', user.uid));
    const personalUnsubscribe = onSnapshot(personalQuery, (snapshot) => {
      const personalContracts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract));
      setContracts(prev => {
        const contractMap = new Map(prev.map(c => [c.id, c]));
        personalContracts.forEach(c => contractMap.set(c.id, c));
        const all = Array.from(contractMap.values());
        all.sort((a,b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
        return all;
      });
      setIsLoadingContracts(false);
    }, (error) => {
      console.error("Error fetching personal contracts:", error);
      toast({ title: "Error", description: "Could not fetch personal contracts.", variant: "destructive" });
      setIsLoadingContracts(false);
    });
    unsubscribes.push(personalUnsubscribe);
  
    // Listener for agency contracts if user is part of an agency
    if (user.primaryAgencyId) {
      const agencyQuery = query(contractsCol, where('ownerId', '==', user.primaryAgencyId));
      const agencyUnsubscribe = onSnapshot(agencyQuery, (snapshot) => {
        const agencyContracts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract));
        setContracts(prev => {
          const contractMap = new Map(prev.map(c => [c.id, c]));
          agencyContracts.forEach(c => contractMap.set(c.id, c));
          const all = Array.from(contractMap.values());
          all.sort((a,b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
          return all;
        });
        setIsLoadingContracts(false); 
      }, (error) => {
        console.error("Error fetching agency contracts:", error);
        toast({ title: "Error", description: "Could not fetch agency contracts.", variant: "destructive" });
        setIsLoadingContracts(false);
      });
      unsubscribes.push(agencyUnsubscribe);
    } else {
       // If not in an agency, we can set loading to false after personal query is setup
       // The personal listener's callback will handle it
    }
  
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

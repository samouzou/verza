
"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { ContractList } from "@/components/contracts/contract-list";
import { UploadContractDialog } from "@/components/contracts/upload-contract-dialog";
import type { Contract } from "@/types";
import { Input } from "@/components/ui/input";
import { Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, onSnapshot, orderBy as firestoreOrderBy, Timestamp } from '@/lib/firebase';
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isLoadingContracts, setIsLoadingContracts] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (user && user.uid && !authLoading) {
      setIsLoadingContracts(true);
      const contractsCol = collection(db, 'contracts');
      const q = query(
        contractsCol,
        where('userId', '==', user.uid),
        firestoreOrderBy('createdAt', 'desc')
      );

      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const contractList = querySnapshot.docs.map(docSnap => {
          const data = docSnap.data();
          
          let createdAtTimestamp: Timestamp;
          if (data.createdAt instanceof Timestamp) {
            createdAtTimestamp = data.createdAt;
          } else if (data.createdAt && typeof data.createdAt.seconds === 'number' && typeof data.createdAt.nanoseconds === 'number') {
            createdAtTimestamp = new Timestamp(data.createdAt.seconds, data.createdAt.nanoseconds);
          } else if (typeof data.createdAt === 'string') { 
            try {
              createdAtTimestamp = Timestamp.fromDate(new Date(data.createdAt));
            } catch (e) {
              console.warn("Error parsing createdAt string, using current time for contract ID:", docSnap.id, data.createdAt);
              createdAtTimestamp = Timestamp.now();
            }
          } else {
            console.warn("Contract createdAt field was not a valid Timestamp, using current time as fallback. Document ID:", docSnap.id);
            createdAtTimestamp = Timestamp.now(); 
          }

          let updatedAtTimestamp: Timestamp | undefined = undefined;
          if (data.updatedAt instanceof Timestamp) {
            updatedAtTimestamp = data.updatedAt;
          } else if (data.updatedAt && typeof data.updatedAt.seconds === 'number' && typeof data.updatedAt.nanoseconds === 'number') {
             updatedAtTimestamp = new Timestamp(data.updatedAt.seconds, data.updatedAt.nanoseconds);
          } else if (typeof data.updatedAt === 'string') {
             try {
                updatedAtTimestamp = Timestamp.fromDate(new Date(data.updatedAt));
             } catch(e) {
                console.warn("Error parsing updatedAt string for contract ID:", docSnap.id, data.updatedAt);
             }
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
            id: docSnap.id,
            ...data,
            createdAt: createdAtTimestamp, 
            updatedAt: updatedAtTimestamp,
            status: effectiveDisplayStatus, 
            invoiceStatus: invoiceStatus,
          } as Contract;
        });
        setContracts(contractList);
        setIsLoadingContracts(false);
      }, (error) => {
        console.error("Error fetching contracts with onSnapshot:", error);
        toast({ title: "Error Listening to Contracts", description: "Could not load contract updates in real-time. Please refresh.", variant: "destructive" });
        setContracts([]);
        setIsLoadingContracts(false);
      });

      return () => unsubscribe();
    } else if (!authLoading && !user) {
      setContracts([]);
      setIsLoadingContracts(false);
    }
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
            <Button variant="outline" disabled>
              <Download className="mr-2 h-4 w-4" /> Export All
            </Button>
            {user && <UploadContractDialog />}
          </div>
        }
      />

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
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


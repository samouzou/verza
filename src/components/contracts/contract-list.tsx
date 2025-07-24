
"use client";

import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ExternalLink, Edit3, Trash2, Eye, User, Briefcase } from "lucide-react";
import type { Contract } from "@/types";
import { ContractStatusBadge } from "./contract-status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { Timestamp } from 'firebase/firestore'; 
import { useAuth } from "@/hooks/use-auth";

interface ContractListProps {
  contracts: Contract[];
}

export function ContractList({ contracts }: ContractListProps) {
  const { user } = useAuth();
  
  if (contracts.length === 0) {
    return <p className="text-muted-foreground mt-4">No contracts found. Add your first contract to get started!</p>;
  }

  const formatDate = (dateInput: string | Timestamp | undefined): string => {
    if (!dateInput) return 'N/A';
    if (dateInput instanceof Timestamp) {
      return dateInput.toDate().toLocaleDateString();
    }
    try {
      return new Date(dateInput + 'T00:00:00').toLocaleDateString(); 
    } catch (e) {
      return 'Invalid Date';
    }
  };

  const isAgencyView = user?.role === 'agency_owner';

  return (
    <div className="overflow-hidden rounded-lg border shadow-sm bg-card text-card-foreground">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            {isAgencyView && <TableHead className="hidden md:table-cell">Associated With</TableHead>}
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="hidden sm:table-cell">Due Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">File Name</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map((contract) => (
            <TableRow key={contract.id}>
              <TableCell className="font-medium">{contract.brand}</TableCell>
              {isAgencyView && (
                <TableCell className="hidden md:table-cell">
                  <div className="flex items-center gap-2">
                    {contract.ownerType === 'agency' ? (
                      <>
                        <Briefcase className="h-4 w-4 text-muted-foreground"/>
                        <span>{contract.talentName || 'Talent'}</span>
                      </>
                    ) : (
                       <>
                        <User className="h-4 w-4 text-muted-foreground"/>
                        <span>Personal</span>
                      </>
                    )}
                  </div>
                </TableCell>
              )}
              <TableCell className="hidden md:table-cell capitalize">{contract.contractType}</TableCell>
              <TableCell className="text-right">${contract.amount.toLocaleString()}</TableCell>
              <TableCell className="hidden sm:table-cell">{formatDate(contract.dueDate)}</TableCell>
              <TableCell>
                <ContractStatusBadge status={contract.status} />
              </TableCell>
              <TableCell className="hidden lg:table-cell text-sm text-card-foreground/70 truncate max-w-[150px]">
                {contract.fileName || 'N/A'}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <span className="sr-only">Open menu</span>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/contracts/${contract.id}`}>
                        <Eye className="mr-2 h-4 w-4" /> View Details
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/contracts/${contract.id}/edit`}>
                        <Edit3 className="mr-2 h-4 w-4" /> Edit
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="text-destructive focus:text-destructive focus:bg-destructive/10">
                      <Link href={`/contracts/${contract.id}`}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete (from details page)
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

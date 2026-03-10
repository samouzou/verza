
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownLeft, Receipt, Briefcase, FileText, Send, Wallet } from "lucide-react";
import type { InternalPayout } from "@/types";
import { format } from 'date-fns';
import { cn } from "@/lib/utils";

interface TransactionHistoryProps {
  transactions: InternalPayout[];
  currentUserId: string;
}

export function TransactionHistory({ transactions, currentUserId }: TransactionHistoryProps) {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
        <CardDescription>Recent activity in your Verza wallet.</CardDescription>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No transactions yet.</p>
        ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="hidden md:table-cell">Entity</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((txn) => {
                const isReceived = txn.talentId === currentUserId;
                
                return (
                  <TableRow key={txn.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isReceived ? (
                          <>
                            <ArrowUpRight className="h-4 w-4 text-green-500" />
                            <span className="capitalize font-medium">Received</span>
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4 text-muted-foreground" />
                            <span className="capitalize font-medium">Sent</span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{txn.description}</TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {txn.paymentDate ? format(txn.paymentDate.toDate(), "PP") : format(txn.initiatedAt.toDate(), "PP")}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      <div className="flex items-center gap-1.5 text-xs">
                        {isReceived ? (
                          <>
                            <Briefcase className="h-3 w-3" />
                            <span>From {txn.agencyName}</span>
                          </>
                        ) : (
                          <>
                            <User className="h-3 w-3" />
                            <span>To {txn.talentName}</span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant={txn.status === 'paid' ? 'default' : 'secondary'} 
                             className={`capitalize text-xs ${txn.status === 'paid' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'}`}>
                        {txn.status}
                      </Badge>
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-semibold font-mono",
                      isReceived ? "text-green-600" : "text-foreground"
                    )}>
                      {isReceived ? '+' : '-'}${txn.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

function User(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

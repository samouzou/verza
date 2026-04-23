
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownCircle, Briefcase, Send, Wallet } from "lucide-react";
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
        <CardTitle>Earnings History</CardTitle>
        <CardDescription>Recent payouts received into your Verza wallet.</CardDescription>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No earnings recorded yet.</p>
        ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="hidden md:table-cell">From</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((txn) => {
                const isWithdrawal = txn.type === "creator_withdrawal";

                return (
                  <TableRow key={txn.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isWithdrawal ? (
                          <>
                            <ArrowDownCircle className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">Withdrawn</span>
                          </>
                        ) : (
                          <>
                            <ArrowUpRight className="h-4 w-4 text-green-500" />
                            <span className="font-medium">Received</span>
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
                        {isWithdrawal ? (
                          <>
                            <Wallet className="h-3 w-3" />
                            <span>Bank Transfer</span>
                          </>
                        ) : (
                          <>
                            <Briefcase className="h-3 w-3" />
                            <span>{txn.agencyName}</span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary"
                             className={`capitalize text-xs ${txn.status === 'paid' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'}`}>
                        {txn.status === 'paid' ? (isWithdrawal ? 'Paid Out' : 'Paid') : 'In Wallet'}
                      </Badge>
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-semibold font-mono",
                      isWithdrawal ? "text-muted-foreground" : "text-green-600"
                    )}>
                      {isWithdrawal ? '-' : '+'}${txn.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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


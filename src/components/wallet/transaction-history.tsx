
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownLeft, Receipt, Briefcase, FileText } from "lucide-react";

// Expanded mock data to be more realistic for a creator/agency
const mockTransactions = [
  { id: "txn_1", type: "payout", description: "From Nike - Q2 Campaign", amount: 4500, date: "2024-07-15", status: "completed", relatedTo: { type: "Contract", name: "Nike Q2"} },
  { id: "txn_2", type: "withdrawal", description: "Withdrawal to Chase Bank ****5678", amount: -2000, date: "2024-07-10", status: "completed", relatedTo: null },
  { id: "txn_3", type: "payout", description: "From Adobe - Creative Jam", amount: 1800, date: "2024-07-05", status: "pending", relatedTo: { type: "Contract", name: "Adobe Collab"} },
  { id: "txn_4", type: "fee", description: "Platform Fee (2.5%)", amount: -112.50, date: "2024-07-15", status: "completed", relatedTo: { type: "Contract", name: "Nike Q2"} },
  { id: "txn_5", type: "payout", description: "Agency Payout for June", amount: 3200, date: "2024-07-01", status: "completed", relatedTo: { type: "Agency", name: "Creator Collective"} },
  { id: "txn_6", type: "expense", description: "Camera Gear - Adorama", amount: -899.99, date: "2024-06-28", status: "completed", relatedTo: { type: "Receipt", name: "INV-AD-456"} },
  { id: "txn_7", type: "payout", description: "From Squarespace - Podcast Ad", amount: 3000, date: "2024-06-28", status: "completed", relatedTo: { type: "Contract", name: "Podcast Sponsorship"} },
];

export function TransactionHistory() {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
        <CardDescription>Recent activity in your creator wallet.</CardDescription>
      </CardHeader>
      <CardContent>
        {mockTransactions.length === 0 ? (
          <p className="text-muted-foreground">No transactions yet.</p>
        ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="hidden md:table-cell">Related To</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockTransactions.map((txn) => (
                <TableRow key={txn.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {txn.amount > 0 ? <ArrowUpRight className="h-4 w-4 text-green-500" /> : <ArrowDownLeft className="h-4 w-4 text-red-500" />}
                      <span className="capitalize font-medium">{txn.type}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{txn.description}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">{new Date(txn.date).toLocaleDateString()}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {txn.relatedTo && (
                        <div className="flex items-center gap-1.5 text-xs">
                          {txn.relatedTo.type === 'Contract' && <FileText className="h-3 w-3" />}
                          {txn.relatedTo.type === 'Agency' && <Briefcase className="h-3 w-3" />}
                          {txn.relatedTo.type === 'Receipt' && <Receipt className="h-3 w-3" />}
                          <span>{txn.relatedTo.name}</span>
                        </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant={txn.status === 'completed' ? 'default' : 'secondary'} 
                           className={`capitalize text-xs ${txn.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'}`}>
                      {txn.status}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right font-semibold font-mono ${txn.amount > 0 ? 'text-green-600' : 'text-slate-700 dark:text-slate-300'}`}>
                    {txn.amount > 0 ? '+' : ''}${Math.abs(txn.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

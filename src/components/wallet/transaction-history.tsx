"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";

const mockTransactions = [
  { id: "txn_1", type: "payout", description: "Payment from Nike", amount: 4500, date: "2024-07-15", status: "completed" },
  { id: "txn_2", type: "withdrawal", description: "Withdrawal to Bank Account", amount: -2000, date: "2024-07-10", status: "completed" },
  { id: "txn_3", type: "payout", description: "Payment from Adobe", amount: 1800, date: "2024-07-05", status: "pending" },
  { id: "txn_4", type: "fee", description: "Platform Fee", amount: -22.50, date: "2024-07-15", status: "completed" },
  { id: "txn_5", type: "payout", description: "Payment from Squarespace", amount: 3000, date: "2024-06-28", status: "completed" },
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="hidden sm:table-cell">Date</TableHead>
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
                <TableCell>{txn.description}</TableCell>
                <TableCell className="hidden sm:table-cell">{new Date(txn.date).toLocaleDateString()}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant={txn.status === 'completed' ? 'default' : 'secondary'} 
                         className={`${txn.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'} capitalize dark:bg-transparent`}>
                    {txn.status}
                  </Badge>
                </TableCell>
                <TableCell className={`text-right font-semibold ${txn.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {txn.amount > 0 ? '+' : ''}${txn.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </CardContent>
    </Card>
  );
}

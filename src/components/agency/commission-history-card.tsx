
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import type { InternalPayout } from "@/types";
import { format } from "date-fns";
import type { Timestamp } from "firebase/firestore";

interface CommissionHistoryCardProps {
  commissions: InternalPayout[];
}

export function CommissionHistoryCard({ commissions }: CommissionHistoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" /> Commission Earnings
        </CardTitle>
        <CardDescription>Commissions earned from your talent's deployments.</CardDescription>
      </CardHeader>
      <CardContent>
        {commissions.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">No commissions earned yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Talent</TableHead>
                <TableHead>Deployment</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.talentName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{c.description}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {format((c.initiatedAt as Timestamp).toDate(), "PP")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`capitalize text-xs ${c.status === "paid" ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300"}`}
                      variant="secondary"
                    >
                      {c.status === "paid" ? "Paid Out" : "In Wallet"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold font-mono text-green-600">
                    +${c.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

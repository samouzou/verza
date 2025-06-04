"use client";

import { TrendingUp, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { UpcomingIncome } from "@/types";
import Link from "next/link";

interface UpcomingIncomeProps {
  incomeSources: UpcomingIncome[];
}

export function UpcomingIncomeList({ incomeSources }: UpcomingIncomeProps) {
   if (incomeSources.length === 0) {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            Upcoming Income
          </CardTitle>
          <CardDescription>Expected payments in the near future.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No upcoming income scheduled.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-green-500" />
          Upcoming Income
        </CardTitle>
        <CardDescription>Expected payments in the near future. ({incomeSources.length} items)</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Expected Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {incomeSources.map((income) => (
              <TableRow key={income.id}>
                <TableCell className="font-medium">{income.brand}</TableCell>
                <TableCell className="text-right">${income.amount.toLocaleString()}</TableCell>
                <TableCell>{new Date(income.dueDate).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                   <Button variant="ghost" size="sm" asChild>
                    <Link href={`/contracts/${income.id}`}>
                      View <ExternalLink className="ml-2 h-3 w-3" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

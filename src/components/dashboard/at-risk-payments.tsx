"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AtRiskPayment } from "@/types";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface AtRiskPaymentsProps {
  payments: AtRiskPayment[];
}

export function AtRiskPayments({ payments }: AtRiskPaymentsProps) {
  if (payments.length === 0) {
    return (
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            At-Risk Payments
          </CardTitle>
          <CardDescription>Payments needing attention.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No at-risk payments found. Great job!</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          At-Risk Payments
        </CardTitle>
        <CardDescription>Payments needing attention. ({payments.length} items)</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className="font-medium">{payment.brand}</TableCell>
                <TableCell className="text-right">${payment.amount.toLocaleString()}</TableCell>
                <TableCell>{new Date(payment.dueDate).toLocaleDateString()}</TableCell>
                <TableCell>{payment.riskReason}</TableCell>
                <TableCell>
                  <Badge variant={payment.status === 'overdue' ? 'destructive' : 'outline'} className="capitalize">
                    {payment.status.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/contracts/${payment.id}`}>
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

"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Contract, UserProfile } from "@/types";
import { Printer } from "lucide-react";
import { format } from "date-fns";
import { Timestamp } from "firebase/firestore";

interface IncomeSummaryReportProps {
  payerName: string;
  year: string;
  creator: UserProfile | null;
  contracts: Contract[];
  totalIncome: number;
}

export function IncomeSummaryReport({ payerName, year, creator, contracts, totalIncome }: IncomeSummaryReportProps) {
  const handlePrint = () => {
    window.print();
  };
  
  const payerInfo = contracts.length > 0 ? {
      address: contracts[0].clientAddress,
      tin: contracts[0].clientTin
  } : { address: 'N/A', tin: 'N/A' };

  const formatDate = (date: Timestamp | Date | undefined) => {
    if (!date) return 'N/A';
    if (date instanceof Timestamp) return format(date.toDate(), "PPP");
    return format(date, "PPP");
  };

  return (
    <div className="print-container">
      <Card className="w-full max-w-4xl mx-auto shadow-lg print-form-container">
        <CardHeader className="bg-muted/50 p-6 print:bg-gray-100">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl">Income Summary Report</CardTitle>
              <CardDescription>
                Summary of payments received from {payerName} for the tax year {year}.
              </CardDescription>
            </div>
            <Button onClick={handlePrint} variant="outline" size="sm" className="hide-on-print">
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6 md:p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <h3 className="font-semibold text-lg border-b pb-2">Payee Information (You)</h3>
              <p><strong>Name:</strong> {creator?.displayName || 'N/A'}</p>
              <p><strong>Address:</strong> {creator?.address || 'Address not set in profile'}</p>
              <p><strong>Taxpayer ID (TIN):</strong> {creator?.tin || 'TIN not set in profile'}</p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-lg border-b pb-2">Payer Information (Client)</h3>
              <p><strong>Name:</strong> {payerName}</p>
              <p><strong>Address:</strong> {payerInfo.address || 'Address not available'}</p>
              <p><strong>Taxpayer ID (TIN):</strong> {payerInfo.tin || 'TIN not available'}</p>
            </div>
          </div>

          <div className="text-center bg-primary/10 p-6 rounded-lg">
            <p className="text-sm font-medium text-primary uppercase tracking-wider">Total Income Received in {year}</p>
            <p className="text-4xl font-bold text-primary">${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>

          <div>
            <h3 className="font-semibold text-lg border-b pb-2 mb-4">Transaction Details</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">Date Paid</th>
                    <th className="p-2">Contract / Project</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(contract => (
                    <tr key={contract.id} className="border-b">
                      <td className="p-2">{formatDate(contract.updatedAt)}</td>
                      <td className="p-2">{contract.projectName || `Contract ${contract.id.substring(0, 6)}`}</td>
                      <td className="p-2 text-right font-mono">${contract.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
           <div className="mt-8 pt-4 border-t text-center text-xs text-muted-foreground">
            <p className="font-semibold">Disclaimer</p>
            <p>This is a non-official document generated for informational purposes to assist with your tax preparation. Please consult with a qualified tax professional.</p>
           </div>
        </CardContent>
      </Card>
    </div>
  );
}

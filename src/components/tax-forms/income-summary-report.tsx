
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Contract, UserProfile } from "@/types";
import { Printer, Landmark } from "lucide-react";
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

  const taxClassificationLabels: Record<string, string> = {
    'individual': 'Individual/Sole Proprietor',
    'c_corp': 'C Corporation',
    's_corp': 'S Corporation',
    'partnership': 'Partnership',
    'trust_estate': 'Trust/Estate',
    'llc': 'Limited Liability Company',
  };

  return (
    <div className="print-container">
      <Card className="w-full max-w-4xl mx-auto shadow-lg print-form-container">
        <CardHeader className="bg-muted/50 p-6 print:bg-gray-100 border-b">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-full hide-on-print">
                <Landmark className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold">Annual Income Summary</CardTitle>
                <CardDescription className="text-base">
                  Reporting Period: January 1, {year} - December 31, {year}
                </CardDescription>
              </div>
            </div>
            <Button onClick={handlePrint} variant="outline" size="sm" className="hide-on-print">
              <Printer className="mr-2 h-4 w-4" /> Print Report
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6 md:p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <h3 className="font-bold text-sm uppercase text-muted-foreground tracking-wider border-b pb-1">Payee (Creator)</h3>
              <div className="space-y-1 text-sm">
                <p><span className="font-semibold">Legal Name:</span> {creator?.legalName || creator?.displayName || 'N/A'}</p>
                <p><span className="font-semibold">Tax Classification:</span> {creator?.taxClassification ? taxClassificationLabels[creator.taxClassification] : 'Not specified'}</p>
                <p><span className="font-semibold">Address:</span> {creator?.address || 'Address not set in profile'}</p>
                <p><span className="font-semibold">Taxpayer ID (TIN):</span> {creator?.tin ? 'XXX-XX-' + creator.tin.slice(-4) : 'TIN not set'}</p>
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="font-bold text-sm uppercase text-muted-foreground tracking-wider border-b pb-1">Payer (Client)</h3>
              <div className="space-y-1 text-sm">
                <p><span className="font-semibold">Company Name:</span> {payerName}</p>
                <p><span className="font-semibold">Address:</span> {payerInfo.address || 'Address not available'}</p>
                <p><span className="font-semibold">Taxpayer ID (TIN):</span> {payerInfo.tin || 'TIN not available'}</p>
              </div>
            </div>
          </div>

          <div className="text-center bg-primary/5 p-8 rounded-xl border border-primary/10">
            <p className="text-xs font-bold text-primary/60 uppercase tracking-widest mb-1">Total Compensation Received</p>
            <p className="text-5xl font-black text-primary">${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-sm text-muted-foreground mt-2">Calculated from {contracts.length} settled transaction(s).</p>
          </div>

          <div>
            <h3 className="font-bold text-sm uppercase text-muted-foreground tracking-wider border-b pb-1 mb-4">Settled Invoices</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-muted-foreground bg-muted/30">
                  <tr>
                    <th className="p-3 font-semibold">Date Paid</th>
                    <th className="p-3 font-semibold">Invoice #</th>
                    <th className="p-3 font-semibold">Contract / Project</th>
                    <th className="p-3 text-right font-semibold">Gross Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {contracts.map(contract => (
                    <tr key={contract.id}>
                      <td className="p-3">{formatDate(contract.updatedAt)}</td>
                      <td className="p-3 font-mono text-xs">{contract.invoiceNumber || 'N/A'}</td>
                      <td className="p-3">{contract.projectName || `Contract ${contract.id.substring(0, 6)}`}</td>
                      <td className="p-3 text-right font-mono font-medium">${contract.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/10">
                    <td colSpan={3} className="p-3 text-right font-bold">Total</td>
                    <td className="p-3 text-right font-bold font-mono text-primary">${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          
           <div className="mt-12 pt-6 border-t text-center space-y-4">
            <div className="flex justify-center gap-8 text-[10px] text-muted-foreground uppercase tracking-widest">
              <p>Generated: {format(new Date(), "PPpp")}</p>
              <p>Report ID: VERZA-TX-{year}-{creator?.uid.substring(0,8)}</p>
            </div>
            <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-lg text-[11px] text-amber-800 dark:text-amber-200">
              <p className="font-bold mb-1 uppercase">Tax Compliance Disclaimer</p>
              <p>This report is a summary of payments recorded in the Verza platform. It is intended to assist the recipient in preparing tax documents such as IRS Form 1099-NEC. This is not an official IRS document. All financial figures should be verified against actual bank records. Please consult with a qualified tax professional regarding your reporting obligations.</p>
            </div>
           </div>
        </CardContent>
      </Card>
    </div>
  );
}

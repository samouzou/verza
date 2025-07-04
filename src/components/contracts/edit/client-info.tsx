
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ClientInfoProps {
  clientName: string;
  setClientName: (value: string) => void;
  clientEmail: string;
  setClientEmail: (value: string) => void;
  clientAddress: string;
  setClientAddress: (value: string) => void;
  clientTin: string;
  setClientTin: (value: string) => void;
  paymentInstructions: string;
  setPaymentInstructions: (value: string) => void;
}

export function ClientInfo({
  clientName,
  setClientName,
  clientEmail,
  setClientEmail,
  clientAddress,
  setClientAddress,
  clientTin,
  setClientTin,
  paymentInstructions,
  setPaymentInstructions,
}: ClientInfoProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Client & Payment Info</CardTitle>
        <CardDescription>
          Provide client details for invoicing and tax purposes. This information will appear on generated documents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label htmlFor="clientName">Client Name</Label>
            <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="clientEmail">Client Email</Label>
            <Input id="clientEmail" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="clientTin">Client Taxpayer ID (TIN) (Optional)</Label>
            <Input id="clientTin" value={clientTin} onChange={(e) => setClientTin(e.target.value)} className="mt-1" />
          </div>
        </div>
        <div>
          <Label htmlFor="clientAddress">Client Address</Label>
          <Textarea id="clientAddress" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} rows={3} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="paymentInstructions">Payment Instructions</Label>
          <Textarea id="paymentInstructions" value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={3} className="mt-1" />
        </div>
      </CardContent>
    </Card>
  );
}

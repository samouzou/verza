
"use client";

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Form1099Nec } from '@/components/tax-forms/form-1099-nec';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Printer, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

function Form1099NecContent() {
    const searchParams = useSearchParams();

    const formData = {
        year: searchParams.get('year') || new Date().getFullYear().toString(),
        payerName: searchParams.get('payerName') || 'N/A',
        payerAddress: searchParams.get('payerAddress') || 'N/A',
        payerTin: searchParams.get('payerTin') || 'N/A',
        recipientName: searchParams.get('recipientName') || 'N/A',
        recipientAddress: searchParams.get('recipientAddress') || 'N/A',
        recipientTin: searchParams.get('recipientTin') || 'N/A',
        nonemployeeCompensation: parseFloat(searchParams.get('amount') || '0'),
    };
    
    const isDataMissing = Object.values(formData).some(val => val === 'N/A' || val === '');

    if (isDataMissing) {
        return (
            <div className="flex flex-col items-center justify-center h-full pt-10">
                <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
                <h2 className="text-2xl font-semibold mb-2">Missing Information</h2>
                <p className="text-muted-foreground mb-6">Could not generate the 1099 draft because some information is missing.</p>
                <Button asChild variant="outline">
                    <Link href="/tax-forms">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Tax Forms
                    </Link>
                </Button>
            </div>
        );
    }
    
    return <Form1099Nec formData={formData} />;
}


export default function Form1099NecPage() {
    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="print-container">
            <PageHeader
                title="Form 1099-NEC Draft"
                description="This is a draft generated for your records. It is not an official IRS document."
                className="hide-on-print"
                actions={
                    <div className="flex gap-2">
                         <Button asChild variant="outline">
                            <Link href="/tax-forms">
                                <ArrowLeft className="mr-2 h-4 w-4" /> Back
                            </Link>
                        </Button>
                        <Button onClick={handlePrint}>
                            <Printer className="mr-2 h-4 w-4" /> Print Form
                        </Button>
                    </div>
                }
            />
            <Suspense fallback={<Skeleton className="h-[800px] w-full" />}>
                <Form1099NecContent />
            </Suspense>
        </div>
    );
}

// Add some print-specific styles to globals.css if they don't exist
// This is a placeholder comment to remind you.
// You'll want to hide the PageHeader etc when printing.
// I'll add the necessary CSS classes to the PageHeader and the main container.

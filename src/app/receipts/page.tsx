
"use client";

import { useState, type ChangeEvent } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, UploadCloud, AlertTriangle, Wand2 } from 'lucide-react';
import { extractReceiptDetails, type ExtractReceiptDetailsOutput } from '@/ai/flows/extract-receipt-details-flow';
import Image from 'next/image';

export default function ReceiptsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrResult, setOcrResult] = useState<ExtractReceiptDetailsOutput | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) { // Limit file size (e.g., 4MB)
        toast({
          title: "File Too Large",
          description: "Please upload an image smaller than 4MB.",
          variant: "destructive",
        });
        setSelectedFile(null);
        setImagePreview(null);
        return;
      }
      setSelectedFile(file);
      setOcrResult(null);
      setProcessingError(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProcessReceipt = async () => {
    if (!selectedFile || !imagePreview) {
      toast({ title: "No File", description: "Please select a receipt image to process.", variant: "destructive" });
      return;
    }
    if (!user) {
        toast({ title: "Not Authenticated", description: "Please log in to process receipts.", variant: "destructive"});
        return;
    }

    setIsProcessing(true);
    setOcrResult(null);
    setProcessingError(null);

    try {
      // The imagePreview is already a data URI
      const result = await extractReceiptDetails({ imageDataUri: imagePreview });
      setOcrResult(result);
      toast({ title: "Receipt Processed", description: "Data extracted successfully." });
    } catch (error: any) {
      console.error("Error processing receipt:", error);
      setProcessingError(error.message || "Failed to process receipt with AI.");
      toast({ title: "Processing Failed", description: error.message || "Could not extract data from receipt.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
       <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Please log in to manage receipts.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Receipt Capture"
        description="Upload and process receipts for expense tracking and reimbursement."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Upload Receipt</CardTitle>
            <CardDescription>Select an image file of your receipt (JPG, PNG, max 4MB).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="receiptFile">Receipt Image</Label>
              <Input
                id="receiptFile"
                type="file"
                accept="image/jpeg, image/png"
                onChange={handleFileChange}
                className="mt-1"
                disabled={isProcessing}
              />
            </div>
            {imagePreview && (
              <div className="mt-4 border rounded-md p-2 bg-muted max-h-96 overflow-auto">
                <Image
                  src={imagePreview}
                  alt="Receipt preview"
                  width={400}
                  height={600}
                  className="rounded-md object-contain max-h-80 w-auto mx-auto"
                  data-ai-hint="receipt image"
                />
              </div>
            )}
            <Button
              onClick={handleProcessReceipt}
              disabled={!selectedFile || isProcessing}
              className="w-full"
            >
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Process with AI
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Extracted Information</CardTitle>
            <CardDescription>Data extracted from the receipt by AI. (JSON view for now)</CardDescription>
          </CardHeader>
          <CardContent>
            {isProcessing && (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">Extracting data...</p>
              </div>
            )}
            {processingError && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive border border-destructive/20">
                <p className="font-semibold">Error:</p>
                <p className="text-sm">{processingError}</p>
              </div>
            )}
            {ocrResult && !isProcessing && (
              <pre className="mt-2 p-3 text-sm bg-muted rounded-md overflow-auto max-h-96">
                {JSON.stringify(ocrResult, null, 2)}
              </pre>
            )}
            {!ocrResult && !isProcessing && !processingError && (
              <p className="text-muted-foreground">Upload a receipt and click "Process with AI" to see extracted data here.</p>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Placeholder for future receipt list and management */}
      <Card className="mt-6">
        <CardHeader>
            <CardTitle>Saved Receipts (Coming Soon)</CardTitle>
            <CardDescription>This section will display your processed and saved receipts.</CardDescription>
        </CardHeader>
        <CardContent>
            <p className="text-muted-foreground">Functionality to save and manage receipts will be added in a future update.</p>
        </CardContent>
      </Card>
    </>
  );
}

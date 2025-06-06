
"use client";

import { useState, type ChangeEvent } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, UploadCloud, AlertTriangle, Wand2, Save, FileText, CalendarDays, Tags, ShoppingCart, TextQuote } from 'lucide-react';
import { extractReceiptDetails, type ExtractReceiptDetailsOutput } from '@/ai/flows/extract-receipt-details-flow';
import Image from 'next/image';
import { db, storage, addDoc, collection, serverTimestamp, Timestamp, ref as storageFileRef, uploadBytes, getDownloadURL } from '@/lib/firebase';
import type { Receipt } from '@/types'; // Assuming Receipt type is updated

export default function ReceiptsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
      setImagePreview(null); // Clear previous preview
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
    setIsSaving(false); // Reset saving state
    setOcrResult(null);
    setProcessingError(null);

    try {
      const result = await extractReceiptDetails({ imageDataUri: imagePreview });
      setOcrResult(result);
      toast({ title: "Receipt Processed by AI", description: "Data extracted. Review and save below." });

      // Now, attempt to save it automatically (or you can add a separate save button)
      await saveReceiptToFirestore(result, selectedFile, imagePreview);

    } catch (error: any) {
      console.error("Error processing receipt with AI:", error);
      setProcessingError(error.message || "Failed to process receipt with AI.");
      toast({ title: "AI Processing Failed", description: error.message || "Could not extract data from receipt.", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const saveReceiptToFirestore = async (extractedData: ExtractReceiptDetailsOutput, file: File, previewDataUri: string) => {
    if (!user) {
      toast({ title: "Error", description: "User not authenticated.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      // 1. Upload image to Firebase Storage
      const filePath = `receipts/${user.uid}/${Date.now()}_${file.name}`;
      const imageRef = storageFileRef(storage, filePath);
      const uploadResult = await uploadBytes(imageRef, file);
      const imageUrl = await getDownloadURL(uploadResult.ref);

      // 2. Prepare data for Firestore
      const receiptData: Omit<Receipt, 'id' | 'createdAt' | 'updatedAt'> = {
        userId: user.uid,
        receiptImageUrl: imageUrl,
        receiptFileName: file.name,
        uploadedAt: Timestamp.now(), // Use client-side timestamp for upload time
        ocrData: extractedData,
        status: 'needs_review',
        category: extractedData.categorySuggestion || undefined, // Use AI suggestion or undefined
        // userEditedData will be null initially
      };

      // 3. Add document to Firestore
      const docRef = await addDoc(collection(db, 'receipts'), {
        ...receiptData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast({ title: "Receipt Saved", description: `Receipt ${file.name} processed and saved successfully. ID: ${docRef.id}` });
      // Optionally, clear the form after successful save
      // setSelectedFile(null);
      // setImagePreview(null);
      // setOcrResult(null); // Or keep it displayed with a "Saved" confirmation

    } catch (error: any) {
      console.error("Error saving receipt to Firestore:", error);
      toast({ title: "Save Failed", description: error.message || "Could not save receipt data.", variant: "destructive" });
      setProcessingError( (prevError) => prevError ? `${prevError}\nSave failed: ${error.message}` : `Save failed: ${error.message}`);
    } finally {
      setIsSaving(false);
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
                disabled={isProcessing || isSaving}
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
              disabled={!selectedFile || isProcessing || isSaving}
              className="w-full"
            >
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" /> }
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null }
              {isProcessing ? 'Processing with AI...' : (isSaving ? 'Saving...' : 'Process & Save with AI')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Extracted Information</CardTitle>
            <CardDescription>Data extracted from the receipt by AI. Review and edit if necessary (editing coming soon).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(isProcessing || isSaving) && !ocrResult && !processingError && (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">{isProcessing ? "Extracting data..." : "Saving data..."}</p>
              </div>
            )}
            {processingError && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive border border-destructive/20">
                <p className="font-semibold">Error:</p>
                <p className="text-sm whitespace-pre-wrap">{processingError}</p>
              </div>
            )}
            {ocrResult && !isProcessing && (
              <>
                {ocrResult.vendorName && <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground"/><strong>Vendor:</strong> {ocrResult.vendorName}</div>}
                {ocrResult.receiptDate && <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground"/><strong>Date:</strong> {ocrResult.receiptDate}</div>}
                {ocrResult.totalAmount !== undefined && (
                  <div className="flex items-center gap-2">
                    <strong className="text-lg text-primary">Total: {ocrResult.totalAmount.toLocaleString(undefined, {style: 'currency', currency: ocrResult.currency || 'USD' })}</strong>
                  </div>
                )}
                {ocrResult.categorySuggestion && <div className="flex items-center gap-2"><Tags className="h-4 w-4 text-muted-foreground"/><strong>Suggested Category:</strong> {ocrResult.categorySuggestion}</div>}
                
                {ocrResult.lineItems && ocrResult.lineItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mt-2 mb-1"><ShoppingCart className="h-4 w-4 text-muted-foreground"/><strong>Line Items:</strong></div>
                    <ul className="list-disc list-inside pl-4 space-y-1 text-xs">
                      {ocrResult.lineItems.map((item, index) => (
                        <li key={index}>
                          {item.description || 'N/A'}
                          {item.quantity && ` (Qty: ${item.quantity})`}
                          {item.unitPrice && ` @ ${item.unitPrice.toLocaleString(undefined, {style:'currency', currency: ocrResult.currency || 'USD'})}`}
                          {item.totalPrice && ` - Total: ${item.totalPrice.toLocaleString(undefined, {style:'currency', currency: ocrResult.currency || 'USD'})}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {ocrResult.rawText && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 mb-1"><TextQuote className="h-4 w-4 text-muted-foreground"/><strong>Raw Text (Excerpt):</strong></div>
                    <pre className="text-xs bg-muted p-2 rounded-md max-h-40 overflow-auto whitespace-pre-wrap">
                      {ocrResult.rawText.substring(0, 500)}{ocrResult.rawText.length > 500 ? '...' : ''}
                    </pre>
                  </div>
                )}
              </>
            )}
            {!ocrResult && !isProcessing && !isSaving && !processingError && (
              <p className="text-muted-foreground">Upload a receipt and click "Process & Save with AI" to see extracted data here.</p>
            )}
          </CardContent>
        </Card>
      </div>
      
      <Card className="mt-6">
        <CardHeader>
            <CardTitle>Saved Receipts (Coming Soon)</CardTitle>
            <CardDescription>This section will display your processed and saved receipts, allowing for edits and categorization.</CardDescription>
        </CardHeader>
        <CardContent>
            <p className="text-muted-foreground">Functionality to list, edit, and manage saved receipts will be added in a future update.</p>
        </CardContent>
      </Card>
    </>
  );
}


    
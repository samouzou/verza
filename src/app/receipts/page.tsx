
"use client";

import { useState, type ChangeEvent, useEffect } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, UploadCloud, AlertTriangle, Wand2, Save, FileText, CalendarDays, Tags, ShoppingCart, TextQuote, DollarSign, Link as LinkIcon, Info } from 'lucide-react';
import { extractReceiptDetails, type ExtractReceiptDetailsOutput } from '@/ai/flows/extract-receipt-details-flow';
import Image from 'next/image';
import { db, storage, addDoc, collection, serverTimestamp, Timestamp, ref as storageFileRef, uploadBytes, getDownloadURL, query, where, getDocs, orderBy } from '@/lib/firebase';
import type { Receipt, Contract } from '@/types';

export default function ReceiptsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ocrResult, setOcrResult] = useState<ExtractReceiptDetailsOutput | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Manual input fields
  const [manualVendorName, setManualVendorName] = useState('');
  const [manualAmount, setManualAmount] = useState<string>(''); // Store as string for input
  const [manualDate, setManualDate] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [selectedContractId, setSelectedContractId] = useState<string | undefined>(undefined);
  const [userContracts, setUserContracts] = useState<Contract[]>([]);
  const [category, setCategory] = useState<string>('');

  // Fetch user's contracts for linking
  useEffect(() => {
    if (user) {
      const fetchContracts = async () => {
        const contractsCol = collection(db, 'contracts');
        const q = query(contractsCol, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        setUserContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract)));
      };
      fetchContracts();
    }
  }, [user]);

  const resetForm = () => {
    setSelectedFile(null);
    setImagePreview(null);
    setOcrResult(null);
    setProcessingError(null);
    setManualVendorName('');
    setManualAmount('');
    setManualDate('');
    setManualNotes('');
    setSelectedContractId(undefined);
    setCategory('');
    const fileInput = document.getElementById('receiptFile') as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) { // Limit file size (e.g., 4MB)
        toast({ title: "File Too Large", description: "Please upload an image smaller than 4MB.", variant: "destructive" });
        resetForm();
        return;
      }
      setSelectedFile(file);
      setOcrResult(null); // Clear previous OCR result when new file is selected
      setProcessingError(null);
      setImagePreview(null);
      setManualVendorName(''); setManualAmount(''); setManualDate(''); // Reset manual fields too
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
        // Automatically trigger AI processing after image preview is loaded
        triggerAiProcessing(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const triggerAiProcessing = async (dataUri: string) => {
    if (!user) {
      toast({ title: "Not Authenticated", description: "Please log in.", variant: "destructive" });
      return;
    }
    setIsProcessingAi(true);
    setProcessingError(null);
    try {
      const result = await extractReceiptDetails({ imageDataUri: dataUri });
      setOcrResult(result);
      toast({ title: "AI Suggestion Ready", description: "AI has processed the receipt. You can use suggestions to fill fields." });
    } catch (error: any) {
      console.error("Error processing receipt with AI:", error);
      setProcessingError(error.message || "Failed to process receipt with AI.");
      toast({ title: "AI Processing Failed", description: error.message || "Could not extract data from receipt.", variant: "destructive" });
    } finally {
      setIsProcessingAi(false);
    }
  };

  const handleUseAiSuggestions = () => {
    if (ocrResult) {
      setManualVendorName(ocrResult.vendorName || '');
      setManualAmount(ocrResult.totalAmount?.toString() || '');
      setManualDate(ocrResult.receiptDate || ''); // Assuming YYYY-MM-DD or easily convertible
      setCategory(ocrResult.categorySuggestion || '');
      // Notes could be pre-filled from rawText or lineItems if desired
      // setManualNotes(ocrResult.rawText?.substring(0, 200) || ''); 
      toast({ title: "Fields Populated", description: "Manual fields filled with AI suggestions." });
    } else {
      toast({ title: "No AI Data", description: "No AI suggestions available. Please process an image first.", variant: "default" });
    }
  };

  const handleSaveReceipt = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "User not authenticated.", variant: "destructive" });
      return;
    }
    if (!selectedFile || !imagePreview) {
      toast({ title: "Missing Image", description: "Please upload a receipt image.", variant: "destructive" });
      return;
    }
    const amountValue = parseFloat(manualAmount);
    if (isNaN(amountValue) || amountValue <= 0) {
      toast({ title: "Invalid Amount", description: "Please enter a valid positive amount.", variant: "destructive" });
      return;
    }
    if (!manualVendorName.trim()) {
        toast({ title: "Missing Vendor", description: "Please enter the vendor name.", variant: "destructive"});
        return;
    }
    if (!manualDate.trim()) {
        toast({ title: "Missing Date", description: "Please enter the receipt date.", variant: "destructive"});
        return;
    }


    setIsSaving(true);
    setProcessingError(null);
    try {
      // 1. Upload image to Firebase Storage
      const filePath = `receipts/${user.uid}/${Date.now()}_${selectedFile.name}`;
      const imageRef = storageFileRef(storage, filePath);
      const uploadResult = await uploadBytes(imageRef, selectedFile);
      const imageUrl = await getDownloadURL(uploadResult.ref);

      // 2. Prepare data for Firestore
      const receiptDataToSave: Omit<Receipt, 'id' | 'createdAt' | 'updatedAt' | 'uploadedAt'> & { uploadedAt: Timestamp } = {
        userId: user.uid,
        manualVendorName: manualVendorName.trim(),
        manualAmount: amountValue,
        manualDate: manualDate,
        manualNotes: manualNotes.trim() || undefined,
        category: category.trim() || undefined,
        linkedContractId: selectedContractId || null,
        receiptImageUrl: imageUrl,
        receiptFileName: selectedFile.name,
        ocrData: ocrResult || null,
        status: 'pending_submission',
        uploadedAt: Timestamp.now(),
      };

      // 3. Add document to Firestore
      const docRef = await addDoc(collection(db, 'receipts'), {
        ...receiptDataToSave,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast({ title: "Receipt Saved!", description: `Receipt for ${receiptDataToSave.manualVendorName} saved successfully.` });
      resetForm(); // Clear form for next entry

    } catch (error: any) {
      console.error("Error saving receipt to Firestore:", error);
      setProcessingError(error.message || "Could not save receipt data.");
      toast({ title: "Save Failed", description: error.message || "Could not save receipt data.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };


  if (authLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  if (!user) {
    return <div className="flex flex-col items-center justify-center h-full p-4"><AlertTriangle className="w-16 h-16 text-destructive mb-4" /><h2 className="text-2xl font-semibold mb-2">Access Denied</h2><p className="text-muted-foreground">Please log in to manage receipts.</p></div>;
  }

  return (
    <>
      <PageHeader
        title="Receipt Management"
        description="Upload receipt images, manually enter details, and link them to contracts for reimbursement."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>1. Upload Receipt Image</CardTitle>
            <CardDescription>Select an image (JPG, PNG, max 4MB). AI will attempt to extract data for suggestions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="receiptFile">Receipt Image</Label>
              <Input id="receiptFile" type="file" accept="image/jpeg, image/png" onChange={handleFileChange} className="mt-1" disabled={isSaving || isProcessingAi} />
            </div>
            {isProcessingAi && <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> AI is processing the image...</div>}
            {imagePreview && (
              <div className="mt-4 border rounded-md p-2 bg-muted max-h-72 overflow-auto">
                <Image src={imagePreview} alt="Receipt preview" width={300} height={450} className="rounded-md object-contain max-h-64 w-auto mx-auto" data-ai-hint="receipt image" />
              </div>
            )}
            {ocrResult && !isProcessingAi && (
              <Button onClick={handleUseAiSuggestions} variant="outline" size="sm" className="w-full">
                <Wand2 className="mr-2 h-4 w-4" /> Use AI Suggestions to Fill Fields
              </Button>
            )}
            {processingError && <div className="text-sm text-destructive p-2 border border-destructive/20 rounded-md">{processingError}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Enter Receipt Details</CardTitle>
            <CardDescription>Manually input or adjust the receipt information. Fields marked * are required.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div><Label htmlFor="manualVendorName">Vendor Name*</Label><Input id="manualVendorName" value={manualVendorName} onChange={(e) => setManualVendorName(e.target.value)} className="mt-1" disabled={isSaving} /></div>
            <div><Label htmlFor="manualAmount">Amount* ($)</Label><Input id="manualAmount" type="number" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="0.00" className="mt-1" disabled={isSaving} /></div>
            <div><Label htmlFor="manualDate">Date*</Label><Input id="manualDate" type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} className="mt-1" disabled={isSaving} /></div>
            <div><Label htmlFor="category">Category</Label><Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g., Meals, Travel, Software" className="mt-1" disabled={isSaving} /></div>
            <div>
              <Label htmlFor="linkedContractId">Link to Contract (Optional)</Label>
              <Select value={selectedContractId} onValueChange={setSelectedContractId} disabled={isSaving}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a contract..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none_selected_placeholder" disabled>Select a contract...</SelectItem>
                  {userContracts.map(contract => (
                    <SelectItem key={contract.id} value={contract.id}>{contract.brand} - {contract.projectName || contract.id.substring(0,6)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="manualNotes">Notes/Description</Label><Textarea id="manualNotes" value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} rows={3} className="mt-1" disabled={isSaving} /></div>
            
            <Button onClick={handleSaveReceipt} disabled={isSaving || isProcessingAi || !selectedFile} className="w-full">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save Receipt
            </Button>
          </CardContent>
        </Card>
      </div>
      
      {/* Placeholder for displaying list of saved receipts - To be implemented later */}
      <Card className="mt-6">
        <CardHeader><CardTitle>Saved Receipts (Coming Soon)</CardTitle><CardDescription>This section will display your processed and saved receipts.</CardDescription></CardHeader>
        <CardContent><p className="text-muted-foreground">A list of your saved receipts will appear here.</p></CardContent>
      </Card>
    </>
  );
}

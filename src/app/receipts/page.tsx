
"use client";

import { useState, type ChangeEvent, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, Save, FileText, CalendarDays, Tags, DollarSign, Trash2, AlertTriangle, Wand2 } from 'lucide-react';
import Image from 'next/image';
import { db, storage, addDoc, collection, Timestamp, ref as storageFileRef, uploadBytes, getDownloadURL, query, where, onSnapshot, deleteDoc, doc as firestoreDoc, orderBy } from '@/lib/firebase';
import type { Receipt, Contract } from '@/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { extractReceiptDetails } from '@/ai/flows/extract-receipt-details-flow';

export default function ReceiptsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [receiptDate, setReceiptDate] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [selectedContractId, setSelectedContractId] = useState<string>('');

  const [userContracts, setUserContracts] = useState<Contract[]>([]);
  const [userReceipts, setUserReceipts] = useState<Receipt[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
  const [receiptToDelete, setReceiptToDelete] = useState<Receipt | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const resetForm = useCallback(() => {
    setSelectedFile(null);
    setImagePreview(null);
    setDescription('');
    setCategory('');
    setAmount('');
    setReceiptDate('');
    setVendorName('');
    setSelectedContractId('');
    const fileInput = document.getElementById('receiptFile') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = "";
    }
  }, []);

  useEffect(() => {
    let unsubscribeContractsSnapshot: (() => void) | undefined = undefined;
    let unsubscribeReceiptsSnapshot: (() => void) | undefined = undefined;

    if (user?.uid && !authLoading) {
      const contractsCol = collection(db, 'contracts');
      const qContracts = query(contractsCol, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
      unsubscribeContractsSnapshot = onSnapshot(qContracts, (snapshot) => {
        setUserContracts(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Contract)));
      }, (error) => {
        console.error("Error fetching contracts:", error);
        toast({title: "Error", description: "Could not load contracts.", variant: "destructive"});
      });

      setIsLoadingReceipts(true);
      const receiptsCol = collection(db, 'receipts');
      const qReceipts = query(receiptsCol, where('userId', '==', user.uid), orderBy('uploadedAt', 'desc'));
      unsubscribeReceiptsSnapshot = onSnapshot(qReceipts, (snapshot) => {
        setUserReceipts(snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          let uploadedAtTs = data.uploadedAt;
          if (uploadedAtTs && typeof uploadedAtTs.seconds === 'number' && typeof uploadedAtTs.nanoseconds === 'number' && !(uploadedAtTs instanceof Timestamp)) {
            uploadedAtTs = new Timestamp(uploadedAtTs.seconds, uploadedAtTs.nanoseconds);
          } else if (!uploadedAtTs || !(uploadedAtTs instanceof Timestamp)) {
            console.warn("Receipt uploadedAt was invalid, using current time:", docSnap.id, data.uploadedAt);
            uploadedAtTs = Timestamp.now();
          }
          return { id: docSnap.id, ...data, uploadedAt: uploadedAtTs } as Receipt;
        }));
        setIsLoadingReceipts(false);
      }, (error) => {
        console.error("Error fetching receipts:", error);
        toast({title: "Error", description: "Could not load receipts.", variant: "destructive"});
        setIsLoadingReceipts(false);
      });
    } else if (!authLoading && !user) {
        setUserContracts([]);
        setUserReceipts([]);
        setIsLoadingReceipts(false);
    }

    return () => {
      if (unsubscribeContractsSnapshot) {
        unsubscribeContractsSnapshot();
      }
      if (unsubscribeReceiptsSnapshot) {
        unsubscribeReceiptsSnapshot();
      }
    };
  }, [user, authLoading, toast]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({ title: "File Too Large", description: "Please upload an image smaller than 5MB.", variant: "destructive" });
        if (event.target) event.target.value = ""; 
        setSelectedFile(null);
        setImagePreview(null);
        return;
      }
      setSelectedFile(file);
      const reader = new FileReader();
      
      const dataUriPromise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
            const result = reader.result as string;
            setImagePreview(result);
            resolve(result);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
      });

      try {
        const imageDataUri = await dataUriPromise;
        setIsProcessingAi(true);
        toast({ title: "Scanning Receipt", description: "AI is extracting the total amount..." });
        
        const result = await extractReceiptDetails({ imageDataUri });

        if (result.totalAmount !== undefined) {
          setAmount(result.totalAmount.toString());
          toast({ title: "AI Analysis Complete", description: `Amount set to $${result.totalAmount}.` });
        } else {
          toast({ title: "AI Analysis", description: "Could not automatically determine the amount.", variant: "default" });
        }

      } catch (error) {
         console.error("Error during receipt OCR:", error);
         toast({ title: "AI Error", description: "Could not process the receipt image.", variant: "destructive" });
      } finally {
        setIsProcessingAi(false);
      }
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
    if (!description.trim()) {
      toast({ title: "Missing Description", description: "Please provide a description for the receipt.", variant: "destructive"});
      return;
    }
    if (!selectedContractId) {
      toast({ title: "Missing Contract Link", description: "Please link this receipt to a contract/brand.", variant: "destructive"});
      return;
    }

    setIsSaving(true);
    try {
      const filePath = `receipts/${user.uid}/${Date.now()}_${selectedFile.name}`;
      const imageRef = storageFileRef(storage, filePath);
      const uploadResult = await uploadBytes(imageRef, selectedFile);
      const imageUrl = await getDownloadURL(uploadResult.ref);

      const baseReceiptData: Partial<Receipt> = {
        userId: user.uid,
        description: description.trim(),
        linkedContractId: selectedContractId, 
        receiptImageUrl: imageUrl,
        receiptFileName: selectedFile.name,
        status: 'uploaded',
        uploadedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      
      if (category.trim()) {
        baseReceiptData.category = category.trim();
      }
      const parsedAmount = parseFloat(amount);
      if (amount.trim() && !isNaN(parsedAmount) && parsedAmount >= 0) {
         baseReceiptData.amount = parsedAmount;
      } else if (amount.trim()) {
          toast({title: "Invalid Amount", description: "Amount was not a valid positive number and was not saved.", variant: "default"});
      }
      if (receiptDate) {
        baseReceiptData.receiptDate = receiptDate;
      }
      if (vendorName.trim()) {
        baseReceiptData.vendorName = vendorName.trim();
      }
      
      await addDoc(collection(db, 'receipts'), baseReceiptData);

      toast({ title: "Receipt Saved!", description: `Receipt "${baseReceiptData.description}" saved.` });
      resetForm();

    } catch (error: any) {
      console.error("Error saving receipt:", error);
      toast({ title: "Save Failed", description: error.message || "Could not save receipt data.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteReceipt = async () => {
    if (!receiptToDelete || !user) {
      return;
    }
    setIsDeleting(true);
    try {
      const urlString = receiptToDelete.receiptImageUrl;
      if (urlString && urlString.startsWith('https://firebasestorage.googleapis.com/')) {
        let filePathInStorage = '';
        try {
          const decodedUrl = decodeURIComponent(urlString);
          const pathSegments = new URL(decodedUrl).pathname.split('/o/');
          if (pathSegments.length > 1) {
            filePathInStorage = pathSegments[1].split('?')[0];
          }
        } catch(urlParseError) {
          console.warn("Could not parse URL to get storage path for deletion:", urlString, urlParseError);
        }
        
        if (filePathInStorage) {
          try {
            const imageFileRef = storageFileRef(storage, filePathInStorage);
            await deleteObject(imageFileRef);
          } catch (storageError: any) {
            if (storageError.code !== 'storage/object-not-found') {
                 toast({title: "Storage Warning", description: "Could not delete image file. It might have been removed or path was invalid.", variant: "default"});
            }
          }
        } else {
            console.warn("Could not determine storage path for deletion from URL:", urlString);
        }
      }
      
      await deleteDoc(firestoreDoc(db, 'receipts', receiptToDelete.id));
      
      toast({ title: "Receipt Deleted", description: `Receipt "${receiptToDelete.description || 'this receipt'}" deleted.` });
      setReceiptToDelete(null);
    } catch (error: any) {
      console.error("Error deleting receipt:", error);
      toast({ title: "Deletion Failed", description: error.message || "Could not delete receipt.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  if (authLoading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Please log in to manage receipts.</p>
      </div>
    );
  }
  
  const isFormDisabled = isSaving || isProcessingAi;

  return (
     <>
      <PageHeader
        title="Receipt Management"
        description="Upload receipt images as proof of expenses and link them to contracts/brands for reimbursement."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Upload New Receipt</CardTitle>
            <CardDescription>Add proof of an expense.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="receiptFile">Receipt Image*</Label>
              <Input id="receiptFile" type="file" accept="image/jpeg, image/png, application/pdf" onChange={handleFileChange} className="mt-1" disabled={isFormDisabled} />
            </div>
            
            {imagePreview && selectedFile && !selectedFile.type.includes('pdf') && (
              <div className="mt-4 border rounded-md p-2 bg-muted max-h-60 overflow-auto">
                <Image src={imagePreview} alt="Receipt preview" width={200} height={300} className="rounded-md object-contain max-h-56 w-auto mx-auto" data-ai-hint="receipt proof" />
              </div>
            )}
            {selectedFile?.type.includes('pdf') && imagePreview && (
                 <div className="mt-4 border rounded-md p-3 bg-muted text-sm text-muted-foreground">
                    PDF Preview: <a href={imagePreview} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{selectedFile.name}</a>
                 </div>
            )}

            <div>
              <Label htmlFor="description">Description*</Label>
              <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g., Lunch meeting with client" className="mt-1" disabled={isFormDisabled} />
            </div>

            <div>
              <Label htmlFor="linkedContractId">Link to Contract/Brand*</Label>
              <Select value={selectedContractId} onValueChange={setSelectedContractId} disabled={isFormDisabled || userContracts.length === 0}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a contract..." /></SelectTrigger>
                <SelectContent>
                  {userContracts.length === 0 ? (
                    <SelectItem value="no-contracts-placeholder" disabled>No contracts available</SelectItem>
                  ) : (
                    userContracts.map(contract => (
                      <SelectItem key={contract.id} value={contract.id}>{contract.brand} - {contract.projectName || contract.id.substring(0,6)}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {userContracts.length === 0 && <p className="text-xs text-muted-foreground mt-1">No contracts found. Please add a contract first.</p>}
            </div>

            <div>
              <Label htmlFor="amount">Amount (Optional)</Label>
              <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="mt-1" disabled={isFormDisabled} min="0" step="0.01"/>
            </div>

            <div>
              <Label htmlFor="category">Category (Optional)</Label>
              <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g., Meals, Travel, Software" className="mt-1" disabled={isFormDisabled} />
            </div>
             <div>
              <Label htmlFor="receiptDate">Receipt Date (Optional)</Label>
              <Input id="receiptDate" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className="mt-1" disabled={isFormDisabled} />
            </div>
            <div>
              <Label htmlFor="vendorName">Vendor Name (Optional)</Label>
              <Input id="vendorName" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="e.g., Starbucks" className="mt-1" disabled={isFormDisabled} />
            </div>
            
            <Button onClick={handleSaveReceipt} disabled={isFormDisabled || !selectedFile || !description.trim() || !selectedContractId} className="w-full">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save Receipt
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Uploaded Receipts</CardTitle>
            <CardDescription>Manage your uploaded expense proofs.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingReceipts ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : userReceipts.length === 0 ? (
              <p className="text-muted-foreground text-center py-10">No receipts uploaded yet.</p>
            ) : (
              <ScrollArea className="h-[600px] pr-3">
                <div className="space-y-4">
                  {userReceipts.map(receipt => {
                    const linkedContract = userContracts.find(c => c.id === receipt.linkedContractId);
                    const isPdf = receipt.receiptFileName?.toLowerCase().endsWith('.pdf');
                    const displayImageUrl = (isPdf && receipt.receiptImageUrl && !receipt.receiptImageUrl.startsWith('data:')) 
                                            ? `https://placehold.co/100x100.png?text=PDF`
                                            : (receipt.receiptImageUrl || `https://placehold.co/100x100.png?text=IMG`);
                    return (
                      <Card key={receipt.id} className="flex flex-col sm:flex-row items-start gap-4 p-4">
                        <a href={receipt.receiptImageUrl} target="_blank" rel="noopener noreferrer" className="block w-full sm:w-24 h-24 sm:h-auto flex-shrink-0 rounded-md overflow-hidden border bg-muted group">
                           <Image
                            src={displayImageUrl}
                            alt={receipt.description || "Receipt image"}
                            width={100}
                            height={100}
                            className="object-cover w-full h-full group-hover:opacity-80 transition-opacity"
                            data-ai-hint={isPdf ? "PDF document" : "receipt proof"}
                          />
                        </a>
                        <div className="flex-grow">
                          <h3 className="font-semibold text-md mb-1">{receipt.description}</h3>
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            {receipt.vendorName && <p><FileText className="inline h-3 w-3 mr-1"/>Vendor: {receipt.vendorName}</p>}
                            {typeof receipt.amount === 'number' && <p><DollarSign className="inline h-3 w-3 mr-1"/>Amount: ${receipt.amount.toFixed(2)}</p>}
                            {receipt.receiptDate && <p><CalendarDays className="inline h-3 w-3 mr-1"/>Date: {format(new Date(receipt.receiptDate), "PP")}</p>}
                            {receipt.category && <p><Tags className="inline h-3 w-3 mr-1"/>Category: <Badge variant="secondary" className="text-xs">{receipt.category}</Badge></p>}
                            {linkedContract && <p><FileText className="inline h-3 w-3 mr-1"/>Linked to: {linkedContract.brand} - {linkedContract.projectName || linkedContract.id.substring(0,6)}</p>}
                            <p>Status: <Badge variant={receipt.status === 'reimbursed' ? 'default' : 'outline'} className="capitalize text-xs">{receipt.status?.replace(/_/g, ' ') || 'Uploaded'}</Badge></p>
                             <p>Uploaded: {receipt.uploadedAt instanceof Timestamp ? format(receipt.uploadedAt.toDate(), "PPpp") : 'Invalid Date'}</p>
                          </div>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                             <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 flex-shrink-0" onClick={() => setReceiptToDelete(receipt)}>
                               <Trash2 className="h-4 w-4"/>
                             </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Receipt?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete the receipt: "{receiptToDelete?.description || 'this receipt'}"? This will also remove the image from storage. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setReceiptToDelete(null)} disabled={isDeleting}>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={handleDeleteReceipt} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null} Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

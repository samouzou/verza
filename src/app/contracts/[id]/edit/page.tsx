
"use client";

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, updateDoc, Timestamp, storage, ref as storageFileRefOriginal, uploadBytes, getDownloadURL, deleteObject as deleteStorageObject } from '@/lib/firebase';
import type { Contract, ExtractedTerms, NegotiationSuggestionsOutput } from '@/types';
import { ArrowLeft, Save, Loader2, AlertTriangle, Wand2, UploadCloud, File as FileIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { extractContractDetails, type ExtractContractDetailsOutput as AIExtractOutput } from "@/ai/flows/extract-contract-details";
import { summarizeContractTerms, type SummarizeContractTermsOutput as AISummaryOutput } from "@/ai/flows/summarize-contract-terms";
import { getNegotiationSuggestions, type NegotiationSuggestionsOutput as AINegotiationOutput } from "@/ai/flows/negotiation-suggestions-flow";

export default function EditContractPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoadingContract, setIsLoadingContract] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReparsingAi, setIsReparsingAi] = useState(false);

  // Form state
  const [brand, setBrand] = useState('');
  const [projectName, setProjectName] = useState('');
  const [amount, setAmount] = useState<number | string>('');
  const [dueDate, setDueDate] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [contractType, setContractType] = useState<Contract['contractType']>('other');
  
  // State for editable contract text and its AI-derived data
  const [editedContractText, setEditedContractText] = useState('');
  const [hasContractTextChanged, setHasContractTextChanged] = useState(false);
  const [currentSummary, setCurrentSummary] = useState<string | undefined>(undefined);
  const [currentExtractedTerms, setCurrentExtractedTerms] = useState<ExtractedTerms | null | undefined>(undefined);
  const [currentNegotiationSuggestions, setCurrentNegotiationSuggestions] = useState<NegotiationSuggestionsOutput | null | undefined>(undefined);

  // State for new file upload
  const [newSelectedFile, setNewSelectedFile] = useState<File | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);


  useEffect(() => {
    if (id && user && !authLoading) {
      setIsLoadingContract(true);
      const fetchContract = async () => {
        try {
          const contractDocRef = doc(db, 'contracts', id);
          const contractSnap = await getDoc(contractDocRef);
          if (contractSnap.exists() && contractSnap.data().userId === user.uid) {
            const data = contractSnap.data() as Contract;
            setContract(data);
            // Pre-fill form fields
            setBrand(data.brand || '');
            setProjectName(data.projectName || '');
            setAmount(data.amount || '');
            setDueDate(data.dueDate || '');
            setContractType(data.contractType || 'other');
            setClientName(data.clientName || '');
            setClientEmail(data.clientEmail || '');
            setClientAddress(data.clientAddress || '');
            setPaymentInstructions(data.paymentInstructions || '');
            
            setEditedContractText(data.contractText || '');
            setCurrentSummary(data.summary);
            setCurrentExtractedTerms(data.extractedTerms);
            setCurrentNegotiationSuggestions(data.negotiationSuggestions);
            setCurrentFileName(data.fileName || null);
            setHasContractTextChanged(false);

          } else {
            toast({ title: "Error", description: "Contract not found or access denied.", variant: "destructive" });
            router.push('/contracts');
          }
        } catch (error) {
          console.error("Error fetching contract:", error);
          toast({ title: "Fetch Error", description: "Could not load contract details.", variant: "destructive" });
        } finally {
          setIsLoadingContract(false);
        }
      };
      fetchContract();
    } else if (!authLoading && !user) {
      router.push('/login');
    }
  }, [id, user, authLoading, router, toast]);

  const handleContractTextChange = (newText: string) => {
    setEditedContractText(newText);
    setHasContractTextChanged(true);
  };

  const handleAiReparse = async () => {
    if (!editedContractText.trim()) {
      toast({ title: "Cannot Parse", description: "Contract text is empty.", variant: "destructive" });
      return;
    }
    setIsReparsingAi(true);
    try {
      const [details, summaryOutput, suggestions] = await Promise.all([
        extractContractDetails({ contractText: editedContractText }),
        summarizeContractTerms({ contractText: editedContractText }),
        getNegotiationSuggestions({ contractText: editedContractText }),
      ]);

      // Update form fields with AI extracted details
      setBrand(details.brand || '');
      setAmount(details.amount || 0);
      const aiDueDate = details.dueDate ? new Date(details.dueDate + 'T00:00:00Z').toISOString().split('T')[0] : ''; // Ensure UTC for date input
      setDueDate(aiDueDate);
      
      setCurrentSummary(summaryOutput.summary);
      setCurrentExtractedTerms(details.extractedTerms ? JSON.parse(JSON.stringify(details.extractedTerms)) : null);
      setCurrentNegotiationSuggestions(suggestions ? JSON.parse(JSON.stringify(suggestions)) : null);
      
      setHasContractTextChanged(false); 
      toast({ title: "AI Re-processing Complete", description: "Contract details, summary, and suggestions updated." });
    } catch (error) {
      console.error("Error re-parsing with AI:", error);
      toast({ title: "AI Error", description: "Could not re-process contract text.", variant: "destructive" });
    } finally {
      setIsReparsingAi(false);
    }
  };

  const handleSaveChanges = async (e: FormEvent) => {
    e.preventDefault();
    if (!contract || !user) {
      toast({ title: "Error", description: "Contract or user data missing.", variant: "destructive" });
      return;
    }
    setIsSaving(true);

    const contractAmount = parseFloat(amount as string);
    if (isNaN(contractAmount) || contractAmount < 0) {
        toast({ title: "Invalid Amount", description: "Please enter a valid positive number for the amount.", variant: "destructive" });
        setIsSaving(false);
        return;
    }

    try {
      const contractDocRef = doc(db, 'contracts', id);
      let newFileUrl: string | null = contract.fileUrl;
      let newFileNameToSave: string | null = contract.fileName;

      if (newSelectedFile) {
        // Attempt to delete old file if it exists
        if (contract.fileUrl) {
          try {
            const oldFileStorageRef = storageFileRefOriginal(storage, contract.fileUrl);
            await deleteStorageObject(oldFileStorageRef);
            toast({ title: "Old File Removed", description: "Previous contract file deleted from storage." });
          } catch (deleteError: any) {
            // Log error but don't block update if deletion fails (e.g., file already gone, or permissions)
            console.warn("Could not delete old file from storage:", deleteError.message);
            toast({ title: "Warning", description: "Could not delete old file. It might have been already removed.", variant: "default" });
          }
        }
        // Upload new file
        const fileStorageRef = storageFileRefOriginal(storage, `contracts/${user.uid}/${Date.now()}_${newSelectedFile.name}`);
        const uploadResult = await uploadBytes(fileStorageRef, newSelectedFile);
        newFileUrl = await getDownloadURL(uploadResult.ref);
        newFileNameToSave = newSelectedFile.name;
        toast({ title: "New File Uploaded", description: "New contract file saved to storage." });
      }
      
      const updates: Partial<Contract> = {
        brand: brand.trim(),
        projectName: projectName.trim() || null,
        amount: contractAmount,
        dueDate: dueDate,
        contractType: contractType,
        clientName: clientName.trim() || null,
        clientEmail: clientEmail.trim() || null,
        clientAddress: clientAddress.trim() || null,
        paymentInstructions: paymentInstructions.trim() || null,
        
        contractText: editedContractText.trim() || null,
        summary: currentSummary || null,
        // Ensure plain objects for Firestore
        extractedTerms: currentExtractedTerms ? JSON.parse(JSON.stringify(currentExtractedTerms)) : null,
        negotiationSuggestions: currentNegotiationSuggestions ? JSON.parse(JSON.stringify(currentNegotiationSuggestions)) : null,
        
        fileUrl: newFileUrl,
        fileName: newFileNameToSave,
        updatedAt: Timestamp.now(),
      };

      const finalUpdates: { [key: string]: any } = {};
      for (const key in updates) {
        if ((updates as Record<string, any>)[key] !== undefined) { // Save nulls, but not undefined
          finalUpdates[key] = (updates as Record<string, any>)[key];
        }
      }

      await updateDoc(contractDocRef, finalUpdates);
      toast({ title: "Contract Updated", description: "Changes saved successfully." });
      router.push(`/contracts/${id}`);
    } catch (error) {
      console.error("Error updating contract:", error);
      toast({ title: "Update Failed", description: "Could not save changes.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingContract || authLoading) {
    return (
      <div className="space-y-4 p-4">
        <PageHeader title="Edit Contract" description="Loading contract details..." />
        <Card><CardContent className="p-6"><Skeleton className="h-96 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Contract Not Found</h2>
        <Button asChild variant="outline">
          <Link href="/contracts"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Contracts</Link>
        </Button>
      </div>
    );
  }
  
  const hasAnyChanges = brand.trim() !== (contract.brand || '') ||
                       projectName.trim() !== (contract.projectName || '') ||
                       parseFloat(amount as string) !== contract.amount ||
                       dueDate !== contract.dueDate ||
                       contractType !== contract.contractType ||
                       clientName.trim() !== (contract.clientName || '') ||
                       clientEmail.trim() !== (contract.clientEmail || '') ||
                       clientAddress.trim() !== (contract.clientAddress || '') ||
                       paymentInstructions.trim() !== (contract.paymentInstructions || '') ||
                       editedContractText.trim() !== (contract.contractText || '') ||
                       !!newSelectedFile;


  return (
    <>
      <PageHeader
        title={`Edit Contract: ${contract.brand}`}
        description="Modify the details of your contract."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/contracts/${id}`}><ArrowLeft className="mr-2 h-4 w-4" /> Cancel</Link>
          </Button>
        }
      />
      <form onSubmit={handleSaveChanges}>
        <Card>
          <CardHeader>
            <CardTitle>Contract Details</CardTitle>
            <CardDescription>Update the core information for this agreement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="brand">Brand Name</Label>
                <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="projectName">Project Name (Optional)</Label>
                <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="amount">Amount ($)</Label>
                <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="0" step="0.01" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="dueDate">Due Date</Label>
                <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="contractType">Contract Type</Label>
                <Select value={contractType} onValueChange={(value) => setContractType(value as Contract['contractType'])}>
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="Select contract type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sponsorship">Sponsorship</SelectItem>
                    <SelectItem value="consulting">Consulting</SelectItem>
                    <SelectItem value="affiliate">Affiliate</SelectItem>
                    <SelectItem value="retainer">Retainer</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Client Information</CardTitle>
            <CardDescription>Update client details relevant for invoicing.</CardDescription>
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

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Contract File</CardTitle>
            <CardDescription>Replace the existing contract file if needed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentFileName && !newSelectedFile && (
              <div className="text-sm text-muted-foreground flex items-center">
                <FileIcon className="mr-2 h-4 w-4" /> Current file: {currentFileName}
              </div>
            )}
            {newSelectedFile && (
              <div className="text-sm text-green-600 flex items-center">
                <UploadCloud className="mr-2 h-4 w-4" /> New file selected: {newSelectedFile.name}
              </div>
            )}
            <div>
              <Label htmlFor="newContractFile">Upload New File (Optional - will replace existing)</Label>
              <Input
                id="newContractFile"
                type="file"
                className="mt-1"
                onChange={(e) => setNewSelectedFile(e.target.files ? e.target.files[0] : null)}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Contract Text & AI Analysis</CardTitle>
            <CardDescription>Edit the contract text and re-process with AI if needed. Changes to text or AI results will be saved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="editedContractText">Contract Text</Label>
              <Textarea
                id="editedContractText"
                value={editedContractText}
                onChange={(e) => handleContractTextChange(e.target.value)}
                rows={10}
                className="mt-1 font-mono text-sm"
                placeholder="Paste or edit contract text here..."
              />
            </div>
            <Button
              type="button"
              onClick={handleAiReparse}
              disabled={!hasContractTextChanged || isReparsingAi || isSaving}
              variant="outline"
            >
              {isReparsingAi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Re-process Text with AI
            </Button>
            {currentSummary && (
              <div className="mt-2">
                <Label className="font-semibold">Current AI Summary:</Label>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap p-2 border rounded-md mt-1 bg-muted/50">{currentSummary}</p>
              </div>
            )}
            {currentExtractedTerms && Object.keys(currentExtractedTerms).length > 0 && (
              <div className="mt-4">
                <Label className="font-semibold">Current AI Extracted Terms:</Label>
                <div className="text-sm text-muted-foreground p-2 border rounded-md mt-1 space-y-1 bg-muted/50">
                  {currentExtractedTerms.paymentMethod && <p><strong>Payment Method:</strong> {currentExtractedTerms.paymentMethod}</p>}
                  {currentExtractedTerms.deliverables && currentExtractedTerms.deliverables.length > 0 && (
                    <p><strong>Deliverables:</strong> {currentExtractedTerms.deliverables.join(', ')}</p>
                  )}
                  {currentExtractedTerms.usageRights && <p><strong>Usage Rights:</strong> {currentExtractedTerms.usageRights}</p>}
                  {currentExtractedTerms.terminationClauses && <p><strong>Termination:</strong> {currentExtractedTerms.terminationClauses}</p>}
                  {currentExtractedTerms.lateFeePenalty && <p><strong>Late Fee/Penalty:</strong> {currentExtractedTerms.lateFeePenalty}</p>}
                </div>
              </div>
            )}
            {currentNegotiationSuggestions && 
             (currentNegotiationSuggestions.paymentTerms || currentNegotiationSuggestions.exclusivity || currentNegotiationSuggestions.ipRights || (currentNegotiationSuggestions.generalSuggestions && currentNegotiationSuggestions.generalSuggestions.length > 0)) && (
              <div className="mt-4">
                <Label className="font-semibold">Current AI Negotiation Suggestions:</Label>
                <div className="text-sm text-muted-foreground p-2 border rounded-md mt-1 space-y-1 bg-muted/50">
                  {currentNegotiationSuggestions.paymentTerms && <p><strong>Payment Terms Advice:</strong> {currentNegotiationSuggestions.paymentTerms}</p>}
                  {currentNegotiationSuggestions.exclusivity && <p><strong>Exclusivity Advice:</strong> {currentNegotiationSuggestions.exclusivity}</p>}
                  {currentNegotiationSuggestions.ipRights && <p><strong>IP Rights Advice:</strong> {currentNegotiationSuggestions.ipRights}</p>}
                  {currentNegotiationSuggestions.generalSuggestions && currentNegotiationSuggestions.generalSuggestions.length > 0 && (
                    <div>
                      <strong>General Suggestions:</strong>
                      <ul className="list-disc list-inside ml-4">
                        {currentNegotiationSuggestions.generalSuggestions.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>


        <div className="mt-8 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.push(`/contracts/${id}`)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving || isReparsingAi || !hasAnyChanges}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
          </Button>
        </div>
      </form>
    </>
  );
}

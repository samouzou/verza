
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
import type { Contract, NegotiationSuggestionsOutput } from '@/types';
import { ArrowLeft, Save, Loader2, AlertTriangle, Wand2, UploadCloud, File as FileIcon, Copy, Check, Lightbulb } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { diffChars } from 'diff';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

import { extractContractDetails } from "@/ai/flows/extract-contract-details";
import { summarizeContractTerms } from "@/ai/flows/summarize-contract-terms";
import { getNegotiationSuggestions } from "@/ai/flows/negotiation-suggestions-flow";

const PreviewChanges = ({ original, current }: { original: string; current: string }) => {
  const diff = diffChars(original, current);
  
  return (
      <ScrollArea className="h-[1100px] rounded-md border p-3 font-mono text-sm">
          <pre className="whitespace-pre-wrap">
              {diff.map((part, index) => {
                  if (part.added) {
                      return <ins key={index} className="diff-ins">{part.value}</ins>;
                  }
                  if (part.removed) {
                      return <del key={index} className="diff-del">{part.value}</del>;
                  }
                  return <span key={index}>{part.value}</span>;
              })}
          </pre>
      </ScrollArea>
  );
};


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
  const [originalContractText, setOriginalContractText] = useState('');
  const [editedContractText, setEditedContractText] = useState('');
  const [hasContractTextChanged, setHasContractTextChanged] = useState(false);
  const [currentSummary, setCurrentSummary] = useState<string | undefined>(undefined);
  const [currentNegotiationSuggestions, setCurrentNegotiationSuggestions] = useState<NegotiationSuggestionsOutput | null | undefined>(null);

  // State for new file upload
  const [newSelectedFile, setNewSelectedFile] = useState<File | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);

  const [copiedSuggestion, setCopiedSuggestion] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');


  const handleCopySuggestion = (text: string | undefined) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSuggestion(text);
    toast({ title: "Suggestion Copied!" });
    setTimeout(() => setCopiedSuggestion(null), 2000);
  };

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
            
            setOriginalContractText(data.contractText || '');
            setEditedContractText(data.contractText || '');
            setCurrentSummary(data.summary);
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
        
        previousContractText: hasContractTextChanged ? contract.contractText : contract.previousContractText,
        contractText: editedContractText.trim() || null,
        summary: currentSummary || null,
        negotiationSuggestions: currentNegotiationSuggestions ? JSON.parse(JSON.stringify(currentNegotiationSuggestions)) : null,
        
        fileUrl: newFileUrl,
        fileName: newFileNameToSave,
        updatedAt: Timestamp.now(),
      };

      const finalUpdates: { [key: string]: any } = {};
      for (const key in updates) {
        if ((updates as Record<string, any>)[key] !== undefined) { 
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

  const hasAnyChanges = contract ? (
    brand.trim() !== (contract.brand || '') ||
    projectName.trim() !== (contract.projectName || '') ||
    parseFloat(amount as string) !== contract.amount ||
    dueDate !== contract.dueDate ||
    contractType !== contract.contractType ||
    clientName.trim() !== (contract.clientName || '') ||
    clientEmail.trim() !== (contract.clientEmail || '') ||
    clientAddress.trim() !== (contract.clientAddress || '') ||
    paymentInstructions.trim() !== (contract.paymentInstructions || '') ||
    editedContractText.trim() !== (contract.contractText || '') ||
    !!newSelectedFile
  ) : false;

  if (isLoadingContract || authLoading) {
    return (
      <div className="space-y-4 p-4">
        <PageHeader title="Edit Contract" description="Loading contract details..." />
        <Skeleton className="h-screen w-full" />
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
  
  return (
    <form onSubmit={handleSaveChanges}>
      <PageHeader
        title={`Edit: ${contract.brand || 'Contract'}`}
        description="Modify the contract text and details. Your changes will be saved to a new version."
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(`/contracts/${id}`)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || isReparsingAi || !hasAnyChanges}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
        {/* Main Editor Column */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex-1">
                <CardTitle>Contract Editor</CardTitle>
                <CardDescription>Make changes to the full text of the contract below.</CardDescription>
              </div>
              <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4">
                <RadioGroup value={viewMode} onValueChange={(value) => setViewMode(value as 'edit' | 'preview')} className="flex items-center space-x-2">
                  <div className="flex items-center space-x-1">
                    <RadioGroupItem value="edit" id="edit-mode" />
                    <Label htmlFor="edit-mode" className="cursor-pointer">Edit</Label>
                  </div>
                  <div className="flex items-center space-x-1">
                    <RadioGroupItem value="preview" id="preview-mode" />
                    <Label htmlFor="preview-mode" className="cursor-pointer">Preview</Label>
                  </div>
                </RadioGroup>
                <Button
                  type="button"
                  onClick={handleAiReparse}
                  disabled={!hasContractTextChanged || isReparsingAi || isSaving}
                  variant="outline"
                  size="sm"
                >
                  {isReparsingAi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                  Re-process
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === 'edit' ? (
                <Textarea
                  id="editedContractText"
                  value={editedContractText}
                  onChange={(e) => handleContractTextChange(e.target.value)}
                  rows={95}
                  className="font-mono text-sm resize-y"
                  placeholder="Paste or edit contract text here..."
                />
              ) : (
                <PreviewChanges original={originalContractText} current={editedContractText} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Column */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Lightbulb className="text-yellow-400"/> AI Negotiation Assistant</CardTitle>
              <CardDescription>AI-generated summary and negotiation points.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[350px] pr-3">
                <div className="space-y-4 text-sm">
                  <div>
                    <h4 className="font-semibold mb-1">AI Summary</h4>
                    <p className="text-muted-foreground whitespace-pre-wrap">{currentSummary || "No summary available. Process text with AI to generate one."}</p>
                  </div>
                  {(currentNegotiationSuggestions?.paymentTerms || currentNegotiationSuggestions?.exclusivity || currentNegotiationSuggestions?.ipRights) && (
                    <div className="space-y-3 pt-2">
                       <h4 className="font-semibold mb-1">Negotiation Points</h4>
                       {currentNegotiationSuggestions.paymentTerms && (
                          <div className="p-2 bg-muted/50 rounded-md">
                            <p className="font-medium text-foreground">Payment Terms</p>
                            <p className="text-muted-foreground">{currentNegotiationSuggestions.paymentTerms}</p>
                            <Button type="button" size="sm" variant="ghost" className="h-7 mt-1" onClick={() => handleCopySuggestion(currentNegotiationSuggestions.paymentTerms)}>
                              {copiedSuggestion === currentNegotiationSuggestions.paymentTerms ? <Check className="h-4 w-4 text-green-500"/> : <Copy className="h-4 w-4"/>}
                              <span className="ml-1">Copy Suggestion</span>
                            </Button>
                          </div>
                       )}
                       {currentNegotiationSuggestions.exclusivity && (
                          <div className="p-2 bg-muted/50 rounded-md">
                            <p className="font-medium text-foreground">Exclusivity</p>
                            <p className="text-muted-foreground">{currentNegotiationSuggestions.exclusivity}</p>
                            <Button type="button" size="sm" variant="ghost" className="h-7 mt-1" onClick={() => handleCopySuggestion(currentNegotiationSuggestions.exclusivity)}>
                              {copiedSuggestion === currentNegotiationSuggestions.exclusivity ? <Check className="h-4 w-4 text-green-500"/> : <Copy className="h-4 w-4"/>}
                              <span className="ml-1">Copy Suggestion</span>
                            </Button>
                          </div>
                       )}
                       {currentNegotiationSuggestions.ipRights && (
                          <div className="p-2 bg-muted/50 rounded-md">
                            <p className="font-medium text-foreground">IP Rights</p>
                            <p className="text-muted-foreground">{currentNegotiationSuggestions.ipRights}</p>
                             <Button type="button" size="sm" variant="ghost" className="h-7 mt-1" onClick={() => handleCopySuggestion(currentNegotiationSuggestions.ipRights)}>
                              {copiedSuggestion === currentNegotiationSuggestions.ipRights ? <Check className="h-4 w-4 text-green-500"/> : <Copy className="h-4 w-4"/>}
                              <span className="ml-1">Copy Suggestion</span>
                            </Button>
                          </div>
                       )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
          
          <Accordion type="multiple" className="w-full space-y-6">
            <AccordionItem value="core-details" className="border-b-0">
              <Card>
                <AccordionTrigger className="p-0 hover:no-underline [&>svg]:mx-6">
                  <CardHeader className="flex-1 text-left">
                    <CardTitle>Core Details</CardTitle>
                    <CardDescription>Essential information for this contract.</CardDescription>
                  </CardHeader>
                </AccordionTrigger>
                <AccordionContent>
                  <CardContent className="pt-0 space-y-4">
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
                        <SelectTrigger className="w-full mt-1"><SelectValue placeholder="Select contract type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sponsorship">Sponsorship</SelectItem>
                          <SelectItem value="consulting">Consulting</SelectItem>
                          <SelectItem value="affiliate">Affiliate</SelectItem>
                          <SelectItem value="retainer">Retainer</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </AccordionContent>
              </Card>
            </AccordionItem>

            <AccordionItem value="client-file" className="border-b-0">
              <Card>
                <AccordionTrigger className="p-0 hover:no-underline [&>svg]:mx-6">
                  <CardHeader className="flex-1 text-left">
                    <CardTitle>Client & File</CardTitle>
                    <CardDescription>Details for invoicing and the original file.</CardDescription>
                  </CardHeader>
                </AccordionTrigger>
                <AccordionContent>
                  <CardContent className="pt-0 space-y-4">
                    <div>
                      <Label htmlFor="clientName">Client Name</Label>
                      <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="clientEmail">Client Email</Label>
                      <Input id="clientEmail" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="clientAddress">Client Address</Label>
                      <Textarea id="clientAddress" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} className="mt-1" rows={2} />
                    </div>
                    <div>
                      <Label htmlFor="paymentInstructions">Payment Instructions</Label>
                      <Textarea id="paymentInstructions" value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} className="mt-1" rows={2} placeholder="e.g. Bank Details, PayPal email"/>
                    </div>
                    <div>
                      <Label htmlFor="newContractFile">Replace Contract File (Optional)</Label>
                      {currentFileName && !newSelectedFile && <div className="text-xs text-muted-foreground flex items-center mt-1"><FileIcon className="mr-1 h-3 w-3" /> {currentFileName}</div>}
                      {newSelectedFile && <div className="text-xs text-green-600 flex items-center mt-1"><UploadCloud className="mr-1 h-3 w-3" /> {newSelectedFile.name}</div>}
                      <Input id="newContractFile" type="file" className="mt-1" onChange={(e) => setNewSelectedFile(e.target.files ? e.target.files[0] : null)} />
                    </div>
                  </CardContent>
                </AccordionContent>
              </Card>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </form>
  );
}

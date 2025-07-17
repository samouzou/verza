
"use client";
import { useState, useTransition, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { extractContractDetails, type ExtractContractDetailsOutput } from "@/ai/flows/extract-contract-details";
import { summarizeContractTerms, type SummarizeContractTermsOutput } from "@/ai/flows/summarize-contract-terms";
import { getNegotiationSuggestions, type NegotiationSuggestionsOutput } from "@/ai/flows/negotiation-suggestions-flow";
import { extractTextFromDocument } from "@/ai/flows/extract-text-from-document-flow";
import { Loader2, UploadCloud, FileText, Wand2, AlertTriangle, ExternalLink, Sparkles } from "lucide-react";
import type { Contract } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, addDoc, serverTimestamp as firebaseServerTimestamp, Timestamp, storage } from '@/lib/firebase';
import { ref as storageRefOriginal, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


export function UploadContractDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [contractText, setContractText] = useState("");
  const [fileName, setFileName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { user } = useAuth();

  const [parsedDetails, setParsedDetails] = useState<ExtractContractDetailsOutput | null>(null);
  const [summary, setSummary] = useState<SummarizeContractTermsOutput | null>(null);
  const [negotiationSuggestions, setNegotiationSuggestions] = useState<NegotiationSuggestionsOutput | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");

  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<Contract['recurrenceInterval'] | undefined>(undefined);


  const now = Date.now();
  const canPerformProAction =
    user?.subscriptionStatus === 'active' ||
    (user?.subscriptionStatus === 'trialing' &&
      user.trialEndsAt &&
      user.trialEndsAt.toMillis() > now);

  const resetState = useCallback(() => {
    setContractText("");
    setFileName("");
    setProjectName("");
    setSelectedFile(null);
    setParsedDetails(null);
    setSummary(null);
    setNegotiationSuggestions(null);
    setParseError(null);
    setIsSaving(false);
    setIsParsing(false);
    setClientName("");
    setClientEmail("");
    setClientAddress("");
    setPaymentInstructions("");
    setIsRecurring(false);
    setRecurrenceInterval(undefined);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);


  const handleParseContract = useCallback(async (textToParse: string) => {
    if (!textToParse.trim()) {
      toast({
        title: "Error",
        description: "Cannot parse empty text.",
        variant: "destructive",
      });
      return;
    }

    setParseError(null);
    setParsedDetails(null);
    setSummary(null);
    setNegotiationSuggestions(null);
    setIsParsing(true);
    toast({ title: "AI Analysis Started", description: "Extracting details, summarizing, and generating suggestions..." });

    try {
      const [details, termsSummary, negSuggestions] = await Promise.all([
        extractContractDetails({ contractText: textToParse }),
        summarizeContractTerms({ contractText: textToParse }),
        getNegotiationSuggestions({ contractText: textToParse }),
      ]);
      setParsedDetails(details);
      setSummary(termsSummary);
      setNegotiationSuggestions(negSuggestions);
      
      // Auto-populate client and payment details
      if (details.clientName) setClientName(details.clientName);
      if (details.clientEmail) setClientEmail(details.clientEmail);
      if (details.clientAddress) setClientAddress(details.clientAddress);
      if (details.paymentInstructions) setPaymentInstructions(details.paymentInstructions);
      
      toast({
        title: "AI Analysis Successful",
        description: "Contract details have been extracted and relevant fields populated.",
      });
    } catch (error) {
      console.error("AI Parsing error:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during AI processing.";
      setParseError(errorMessage);
      toast({
        title: "AI Analysis Failed",
        description: `Could not process contract with AI: ${errorMessage}`,
        variant: "destructive",
      });
    } finally {
      setIsParsing(false);
    }
  }, [toast]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files ? e.target.files[0] : null;
      if (!file) return;

      setSelectedFile(file);
      if (!fileName.trim()) {
        setFileName(file.name);
      }

      setIsParsing(true);
      toast({ title: "Processing Document...", description: "Extracting text from your file with OCR." });

      try {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = async () => {
            const dataUri = reader.result as string;
            const ocrResult = await extractTextFromDocument({ documentDataUri: dataUri });
            if (ocrResult.extractedText) {
                setContractText(ocrResult.extractedText);
                // Automatically trigger the next step
                await handleParseContract(ocrResult.extractedText);
            } else {
                throw new Error("OCR could not extract any text from the document.");
            }
        };
        reader.onerror = (error) => {
           throw new Error("Failed to read the file.");
        }
      } catch (error) {
          console.error("Error during file processing and OCR:", error);
          const errorMessage = error instanceof Error ? error.message : "Could not process the uploaded file.";
          setParseError(errorMessage);
          toast({ title: "File Processing Failed", description: errorMessage, variant: "destructive" });
          setIsParsing(false);
      }
  };


  const handleSaveContract = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to save a contract.", variant: "destructive" });
      return;
    }
    if (!canPerformProAction) {
      toast({ title: "Upgrade Required", description: "Please upgrade to Verza Pro to add new contracts.", variant: "destructive" });
      return;
    }
    if (!parsedDetails && !selectedFile && !contractText.trim()) {
      toast({ title: "Cannot Save", description: "No contract details available (AI parse, file, or pasted text).", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    let fileUrlToSave: string | null = null;

    try {
      if (selectedFile) {
        const fileStorageRef = storageRefOriginal(storage, `contracts/${user.uid}/${Date.now()}_${selectedFile.name}`);
        const uploadResult = await uploadBytes(fileStorageRef, selectedFile);
        fileUrlToSave = await getDownloadURL(uploadResult.ref);
      }

      const currentParsedDetails = parsedDetails || {
        brand: "Unknown Brand",
        amount: 0,
        dueDate: new Date().toISOString().split('T')[0],
        extractedTerms: {}
      };
      
      const currentSummary = summary || { summary: contractText.trim() ? "Summary not generated by AI." : "No summary available." };

      const cleanedExtractedTerms = currentParsedDetails.extractedTerms
        ? JSON.parse(JSON.stringify(currentParsedDetails.extractedTerms)) 
        : {};
      
      const suggestionsToSave = negotiationSuggestions 
        ? JSON.parse(JSON.stringify(negotiationSuggestions)) 
        : null;

      const contractDataForFirestore: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'> & { createdAt: any, updatedAt: any } = {
        userId: user.uid,
        brand: currentParsedDetails.brand || "Unknown Brand",
        amount: currentParsedDetails.amount || 0,
        dueDate: currentParsedDetails.dueDate || new Date().toISOString().split('T')[0],
        status: 'pending' as Contract['status'],
        contractType: 'other' as Contract['contractType'],
        contractText: contractText,
        fileName: fileName.trim() || (selectedFile ? selectedFile.name : (contractText.trim() ? "Pasted Contract" : "Untitled Contract")),
        fileUrl: fileUrlToSave || null,
        summary: currentSummary.summary,
        extractedTerms: cleanedExtractedTerms,
        negotiationSuggestions: suggestionsToSave,
        invoiceStatus: 'none', 
        createdAt: firebaseServerTimestamp(),
        updatedAt: firebaseServerTimestamp(),
      };
      
      const trimmedProjectName = projectName.trim();
      if (trimmedProjectName) {
        contractDataForFirestore.projectName = trimmedProjectName;
      }

      const trimmedClientName = clientName.trim();
      if (trimmedClientName) {
        contractDataForFirestore.clientName = trimmedClientName;
      }
      const trimmedClientEmail = clientEmail.trim();
      if (trimmedClientEmail) {
        contractDataForFirestore.clientEmail = trimmedClientEmail;
      }
      const trimmedClientAddress = clientAddress.trim();
      if (trimmedClientAddress) {
        contractDataForFirestore.clientAddress = trimmedClientAddress;
      }
      const trimmedPaymentInstructions = paymentInstructions.trim();
      if (trimmedPaymentInstructions) {
        contractDataForFirestore.paymentInstructions = trimmedPaymentInstructions;
      }

      if (isRecurring) {
        contractDataForFirestore.isRecurring = true;
        if (recurrenceInterval) {
          contractDataForFirestore.recurrenceInterval = recurrenceInterval;
        }
      }


      await addDoc(collection(db, 'contracts'), contractDataForFirestore);
      
      toast({ title: "Contract Saved", description: `${contractDataForFirestore.brand} contract added successfully.` });
      setIsOpen(false);
    } catch (error) {
      console.error("Error saving contract:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      toast({
        title: "Save Failed",
        description: `Could not save contract: ${errorMessage}`,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <UploadCloud className="mr-2 h-4 w-4" /> Add Contract
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Add New Contract
          </DialogTitle>
          <DialogDescription>
            Upload a contract file to automatically extract text and analyze it with AI, or paste the text manually.
          </DialogDescription>
        </DialogHeader>
        
        {!canPerformProAction && (
          <Alert variant="default" className="border-primary/50 bg-primary/5 text-primary-foreground [&>svg]:text-primary">
            <Sparkles className="h-5 w-5" />
            <AlertTitle className="font-semibold text-primary">Upgrade to Verza Pro</AlertTitle>
            <AlertDescription className="text-primary/90">
              Adding new contracts is a Pro feature. Please upgrade your plan to continue.
              Your free trial may have ended or you are on the free plan.
            </AlertDescription>
            <div className="mt-3">
                <Button variant="default" size="sm" asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Link href="/settings">
                    Manage Subscription <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
            </div>
          </Alert>
        )}

        <ScrollArea className="max-h-[calc(80vh-250px-50px)]">
        <div className="grid gap-6 p-1 pr-4">
           <div>
            <Label htmlFor="fileName">File Name (Optional - auto-fills on upload)</Label>
            <Input
              id="fileName"
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="e.g., BrandX_Sponsorship_Q4.pdf"
              className="mt-1"
              disabled={isParsing || isSaving}
            />
          </div>
          <div>
            <Label htmlFor="projectName">Project Name (Optional)</Label>
            <Input
              id="projectName"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g., Q3 YouTube Campaign"
              className="mt-1"
              disabled={isParsing || isSaving}
            />
          </div>
          <div>
            <Label htmlFor="contractFile">Upload Contract File (PDF, PNG, JPG)</Label>
            <Input
              id="contractFile"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="mt-1"
              onChange={handleFileChange}
              disabled={isParsing || isSaving}
            />
            <p className="text-xs text-muted-foreground mt-1">Uploading a file will automatically trigger OCR and AI analysis.</p>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-lg">Client & Payment Details (for Invoicing)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="clientName">Client Name</Label>
                <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client Company Inc." className="mt-1" disabled={isParsing || isSaving} />
              </div>
              <div>
                <Label htmlFor="clientEmail">Client Email</Label>
                <Input id="clientEmail" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="contact@client.com" className="mt-1" disabled={isParsing || isSaving} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="clientAddress">Client Address</Label>
                <Textarea id="clientAddress" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="123 Client St, City, Country" className="mt-1" rows={3} disabled={isParsing || isSaving}/>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="paymentInstructions">Payment Instructions (Bank details, PayPal, etc.)</Label>
                <Textarea id="paymentInstructions" value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} placeholder="Bank: XYZ, Account: 12345, Swift: ABCDE..." className="mt-1" rows={3} disabled={isParsing || isSaving}/>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Contract Recurrence (Optional)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isRecurring"
                  checked={isRecurring}
                  onCheckedChange={(checked) => setIsRecurring(checked as boolean)}
                  disabled={isParsing || isSaving}
                />
                <Label htmlFor="isRecurring" className="font-normal">
                  Is this a recurring contract?
                </Label>
              </div>
              {isRecurring && (
                <div>
                  <Label htmlFor="recurrenceInterval">Recurrence Interval</Label>
                  <Select
                    value={recurrenceInterval}
                    onValueChange={(value) => setRecurrenceInterval(value as Contract['recurrenceInterval'])}
                    disabled={isParsing || isSaving}
                  >
                    <SelectTrigger id="recurrenceInterval" className="mt-1">
                      <SelectValue placeholder="Select interval" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>


          <div>
            <Label htmlFor="contractText">Contract Text (auto-filled from upload)</Label>
            <Textarea
              id="contractText"
              value={contractText}
              onChange={(e) => setContractText(e.target.value)}
              placeholder="Paste the full text of your contract here, or upload a file to automatically fill this."
              rows={8}
              className="mt-1"
              disabled={isParsing || isSaving}
            />
            <Button onClick={() => handleParseContract(contractText)} disabled={isParsing || !contractText.trim() || isSaving} className="w-full sm:w-auto mt-2">
                {isParsing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                Re-process Text with AI
            </Button>
          </div>

          {isParsing && (
              <div className="flex items-center justify-center p-6 text-muted-foreground">
                  <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                  <span>AI is analyzing your document... This may take a moment.</span>
              </div>
          )}


          {parseError && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">AI Processing Error</p>
                <p className="text-sm">{parseError}</p>
              </div>
            </div>
          )}

          {!isParsing && (parsedDetails || summary || negotiationSuggestions) && !parseError && (
            <div className="mt-2 space-y-4">
              <h3 className="text-lg font-semibold text-foreground">AI Analysis Results</h3>
              {parsedDetails && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-md">Extracted Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p><strong>Brand:</strong> {parsedDetails.brand || 'N/A'}</p>
                    <p><strong>Amount:</strong> {parsedDetails.amount ? `$${parsedDetails.amount.toLocaleString()}` : 'N/A'}</p>
                    <p><strong>Due Date:</strong> {parsedDetails.dueDate ? new Date(parsedDetails.dueDate + 'T00:00:00').toLocaleDateString() : 'N/A'}</p>
                    {parsedDetails.extractedTerms?.paymentMethod && <p><strong>Payment Method:</strong> {parsedDetails.extractedTerms.paymentMethod}</p>}
                    {parsedDetails.extractedTerms?.deliverables && parsedDetails.extractedTerms.deliverables.length > 0 && (
                        <p><strong>Deliverables:</strong> {parsedDetails.extractedTerms.deliverables.join(', ')}</p>
                    )}
                  </CardContent>
                </Card>
              )}
              {summary && (
                 <Card>
                  <CardHeader>
                    <CardTitle className="text-md">Contract Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{summary.summary || 'No summary generated.'}</p>
                  </CardContent>
                </Card>
              )}
              {negotiationSuggestions && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-md">Negotiation Suggestions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {negotiationSuggestions.paymentTerms && <p><strong>Payment Terms:</strong> {negotiationSuggestions.paymentTerms}</p>}
                    {negotiationSuggestions.exclusivity && <p><strong>Exclusivity:</strong> {negotiationSuggestions.exclusivity}</p>}
                    {negotiationSuggestions.ipRights && <p><strong>IP Rights:</strong> {negotiationSuggestions.ipRights}</p>}
                    {negotiationSuggestions.generalSuggestions && negotiationSuggestions.generalSuggestions.length > 0 && (
                      <div>
                        <strong>General Suggestions:</strong>
                        <ul className="list-disc list-inside ml-4 text-muted-foreground">
                          {negotiationSuggestions.generalSuggestions.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                    {(!negotiationSuggestions.paymentTerms && !negotiationSuggestions.exclusivity && !negotiationSuggestions.ipRights && (!negotiationSuggestions.generalSuggestions || negotiationSuggestions.generalSuggestions.length === 0)) && (
                      <p className="text-muted-foreground">No specific negotiation suggestions generated by AI for this text.</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
        </ScrollArea>
        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving || isParsing}>Cancel</Button>
          <Button 
            onClick={handleSaveContract} 
            disabled={isParsing || (!selectedFile && !contractText.trim() && !parsedDetails) || isSaving || !canPerformProAction}
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Contract
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


"use client";
import { useState, useTransition, useEffect, useRef } from "react";
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
import { convertDocumentToSfdt } from "@/ai/flows/ocr-flow";
import { Loader2, UploadCloud, FileText, Wand2, AlertTriangle, ExternalLink, Sparkles, Users } from "lucide-react";
import type { Agency, Contract, Talent } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, addDoc, serverTimestamp as firebaseServerTimestamp, Timestamp, storage, query, where, getDoc, doc } from '@/lib/firebase';
import { ref as storageRefOriginal, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentEditorContainerComponent, Inject, Toolbar } from '@syncfusion/ej2-react-documenteditor';
import { registerLicense } from '@syncfusion/ej2-base';

if (process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY) {
  registerLicense(process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY);
}

export function UploadContractDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { user } = useAuth();
  
  const [agency, setAgency] = useState<Agency | null>(null);
  const [selectedOwner, setSelectedOwner] = useState<string>("personal"); // 'personal' or a talent's UID

  const [parsedDetails, setParsedDetails] = useState<ExtractContractDetailsOutput | null>(null);
  const [summary, setSummary] = useState<SummarizeContractTermsOutput | null>(null);
  const [negotiationSuggestions, setNegotiationSuggestions] = useState<NegotiationSuggestionsOutput | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [contractText, setContractText] = useState('');

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");

  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<Contract['recurrenceInterval'] | undefined>(undefined);
  
  const editorRef = useRef<DocumentEditorContainerComponent | null>(null);


  const now = Date.now();
  const canPerformProAction =
    user?.subscriptionStatus === 'active' ||
    (user?.subscriptionStatus === 'trialing' &&
      user.trialEndsAt &&
      user.trialEndsAt.toMillis() > now);

  useEffect(() => {
    if (!isOpen) {
      if (editorRef.current) {
        editorRef.current.documentEditor.open(JSON.stringify({ sfdt: '' }));
      }
      setFileName("");
      setProjectName("");
      setSelectedFile(null);
      setParsedDetails(null);
      setSummary(null);
      setNegotiationSuggestions(null);
      setParseError(null);
      setIsSaving(false);
      setClientName("");
      setClientEmail("");
      setClientAddress("");
      setPaymentInstructions("");
      setIsRecurring(false);
      setRecurrenceInterval(undefined);
      setAgency(null);
      setSelectedOwner("personal");
    } else if (user?.role === 'agency_owner' && user.agencyMemberships?.[0]?.agencyId) {
      const agencyId = user.agencyMemberships[0].agencyId;
      const agencyDocRef = doc(db, "agencies", agencyId);
      getDoc(agencyDocRef).then(docSnap => {
        if (docSnap.exists()) {
          setAgency({ id: docSnap.id, ...docSnap.data() } as Agency);
        }
      });
    }
  }, [isOpen, user]);

  const handleFullAnalysis = async (textToAnalyze: string) => {
    toast({ title: "Analyzing Contract", description: "AI is extracting details, summarizing, and providing suggestions..." });
    setIsProcessingAi(true);
    setParseError(null);
    setParsedDetails(null);
    setSummary(null);
    setNegotiationSuggestions(null);

    try {
      const [details, termsSummary, negSuggestions] = await Promise.all([
        extractContractDetails({ contractText: textToAnalyze }),
        summarizeContractTerms({ contractText: textToAnalyze }),
        getNegotiationSuggestions({ contractText: textToAnalyze }),
      ]);
      setParsedDetails(details);
      setSummary(termsSummary);
      setNegotiationSuggestions(negSuggestions);
      toast({
        title: "AI Analysis Successful",
        description: "Contract details extracted, summarized, and negotiation suggestions provided.",
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
      setIsProcessingAi(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    if (!fileName.trim()) {
      setFileName(file.name);
    }

    setIsProcessingAi(true);
    setParseError(null);
    setContractText(''); // Clear text
    toast({ title: "File Uploaded", description: "Extracting text with OCR and converting to document..." });

    try {
      const reader = new FileReader();
      const dataUriPromise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
      });
      const documentDataUri = await dataUriPromise;

      const ocrResult = await convertDocumentToSfdt({ documentDataUri });
      if (!ocrResult || !ocrResult.sfdt) {
        throw new Error("OCR process failed to extract text or convert to SFDT.");
      }
      
      setContractText(ocrResult.sfdt); // This is now an SFDT string

      if (editorRef.current) {
        editorRef.current.documentEditor.open(ocrResult.sfdt);
        const plainText = editorRef.current.documentEditor.text;
        await handleFullAnalysis(plainText);
      } else {
        throw new Error("Editor is not available to process the document text.");
      }

    } catch (error) {
      console.error("Error during file processing and OCR:", error);
      const errorMessage = error instanceof Error ? error.message : "Could not process file.";
      setParseError(errorMessage);
      toast({
        title: "File Processing Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessingAi(false);
    }
  };
  
  const handlePastedText = async () => {
    if (!editorRef.current) return;
    const textToAnalyze = editorRef.current.documentEditor.text;
    await handleFullAnalysis(textToAnalyze);
  };
  
  useEffect(() => {
    if (editorRef.current && contractText) {
        try {
            editorRef.current.documentEditor.open(contractText);
        } catch (e) {
            console.error("Failed to open SFDT content:", e);
            // Fallback to opening as plain text if SFDT parsing fails
            editorRef.current.documentEditor.open(JSON.stringify({ "sfdt": `{"sections":[{"blocks":[{"inlines":[{"text":"${contractText.replace(/"/g, '\\"')}"}]}]}]}` }));
        }
    }
  }, [contractText]);


  const handleSaveContract = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to save a contract.", variant: "destructive" });
      return;
    }
    if (!canPerformProAction) {
      toast({ title: "Upgrade Required", description: "Please upgrade to Verza Pro to add new contracts.", variant: "destructive" });
      return;
    }
    if (!editorRef.current) {
      toast({ title: "Editor Not Ready", description: "The document processor is not ready. Please wait a moment and try again.", variant: "destructive"});
      return;
    }

    setIsSaving(true);
    let fileUrlToSave: string | null = null;
    
    let ownerType: 'user' | 'agency' = 'user';
    let ownerId = user.uid;
    let finalUserId = user.uid;
    let talentName: string | undefined | null = undefined;

    if (user.role === 'agency_owner' && selectedOwner !== 'personal' && agency) {
        ownerType = 'agency';
        ownerId = agency.id;
        finalUserId = selectedOwner;
        talentName = agency.talent?.find(t => t.userId === finalUserId)?.displayName;
    }

    try {
      if (selectedFile) {
        const filePath = `contracts/${ownerId}/${Date.now()}_${selectedFile.name}`;
        const fileStorageRef = storageRefOriginal(storage, filePath);
        const uploadResult = await uploadBytes(fileStorageRef, selectedFile);
        fileUrlToSave = await getDownloadURL(uploadResult.ref);
      }
      
      const sfdtString = editorRef.current.documentEditor.serialize();

      const currentParsedDetails = parsedDetails || {
        brand: "Unknown Brand",
        amount: 0,
        dueDate: new Date().toISOString().split('T')[0],
        extractedTerms: {}
      };
      
      const currentSummary = summary || { summary: editorRef.current.documentEditor.text.trim() ? "Summary not generated by AI." : "No summary available." };

      const cleanedExtractedTerms = currentParsedDetails.extractedTerms
        ? JSON.parse(JSON.stringify(currentParsedDetails.extractedTerms)) 
        : {};
      
      const suggestionsToSave = negotiationSuggestions 
        ? JSON.parse(JSON.stringify(negotiationSuggestions)) 
        : null;

      const contractDataForFirestore: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'> & { createdAt: any, updatedAt: any } = {
        userId: finalUserId,
        talentName: talentName || null,
        ownerType: ownerType,
        ownerId: ownerId,
        brand: currentParsedDetails.brand || "Unknown Brand",
        amount: currentParsedDetails.amount || 0,
        dueDate: currentParsedDetails.dueDate || new Date().toISOString().split('T')[0],
        status: 'pending' as Contract['status'],
        contractType: 'other' as Contract['contractType'],
        contractText: sfdtString,
        fileName: fileName.trim() || (selectedFile ? selectedFile.name : (editorRef.current.documentEditor.text.trim() ? "Pasted Contract" : "Untitled Contract")),
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

  const renderAiAnalysis = () => (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI-Extracted Details
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><strong>Brand:</strong> {parsedDetails?.brand || '...'}</p>
          <p><strong>Amount:</strong> ${parsedDetails?.amount ? parsedDetails.amount.toLocaleString() : '...'}</p>
          <p><strong>Due Date:</strong> {parsedDetails?.dueDate || '...'}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">AI Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{summary?.summary || "No summary available."}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Negotiation Suggestions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          {negotiationSuggestions?.paymentTerms && <div><p className="font-semibold">Payment Terms</p><p className="text-muted-foreground">{negotiationSuggestions.paymentTerms}</p></div>}
          {negotiationSuggestions?.exclusivity && <div><p className="font-semibold">Exclusivity</p><p className="text-muted-foreground">{negotiationSuggestions.exclusivity}</p></div>}
          {negotiationSuggestions?.ipRights && <div><p className="font-semibold">IP Rights</p><p className="text-muted-foreground">{negotiationSuggestions.ipRights}</p></div>}
          {!negotiationSuggestions?.paymentTerms && !negotiationSuggestions?.exclusivity && !negotiationSuggestions?.ipRights && <p className="text-muted-foreground">No specific negotiation points were flagged.</p>}
        </CardContent>
      </Card>
    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <UploadCloud className="mr-2 h-4 w-4" /> Add Contract
        </Button>
      </DialogTrigger>
      <DialogContent 
        className="w-[95vw] max-w-[95vw] max-h-[90vh] flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Add New Contract
          </DialogTitle>
          <DialogDescription>
            Upload a contract file or paste text to automatically extract details and analyze with AI.
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

        <div className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-hidden p-1">
          {/* Left Column */}
          <ScrollArea className="h-full">
            <div className="space-y-6 pr-6">
              {user?.role === 'agency_owner' && agency && (
                <div>
                  <Label htmlFor="contractOwner">Contract For</Label>
                  <Select value={selectedOwner} onValueChange={setSelectedOwner} disabled={isSaving}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select who this contract is for..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">My Agency ({agency.name})</SelectItem>
                      {agency.talent?.filter(t => t.status === 'active').map(t => (
                        <SelectItem key={t.userId} value={t.userId}>{t.displayName} (Talent)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="fileName">File Name (Optional - auto-fills on upload)</Label>
                <Input
                  id="fileName"
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="e.g., BrandX_Sponsorship_Q4.pdf"
                  className="mt-1"
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
                />
              </div>
              <div>
                <Label htmlFor="contractFile">Upload Contract File</Label>
                <Input
                  id="contractFile"
                  type="file"
                  accept=".pdf,.doc,.docx,image/*"
                  className="mt-1"
                  onChange={handleFileChange}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Uploading will use OCR to extract text into the editor on the right.
                </p>
              </div>
              <Card>
                <CardHeader><CardTitle className="text-lg">Client & Payment Details (for Invoicing)</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="clientName">Client Name</Label>
                    <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client Company Inc." className="mt-1" disabled={isProcessingAi} />
                  </div>
                  <div>
                    <Label htmlFor="clientEmail">Client Email</Label>
                    <Input id="clientEmail" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="contact@client.com" className="mt-1" disabled={isProcessingAi} />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="clientAddress">Client Address</Label>
                    <Textarea id="clientAddress" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="123 Client St, City, Country" className="mt-1" rows={3} disabled={isProcessingAi}/>
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="paymentInstructions">Payment Instructions (Bank details, PayPal, etc.)</Label>
                    <Textarea id="paymentInstructions" value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} placeholder="Bank: XYZ, Account: 12345, Swift: ABCDE..." className="mt-1" rows={3} disabled={isProcessingAi}/>
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
            </div>
          </ScrollArea>

          {/* Right Column */}
          <div className="flex flex-col gap-6 overflow-hidden">
            <div className="flex-shrink-0">
              <Label>Contract Text & AI Analysis</Label>
              <div className="flex items-center gap-2 mt-1">
                  <Button onClick={handlePastedText} variant="outline" size="sm" disabled={isProcessingAi}>
                  <Wand2 className="mr-2 h-4 w-4" /> Run AI Analysis on Text
                  </Button>
                  <p className="text-xs text-muted-foreground">Paste text into the editor below and click to analyze.</p>
              </div>
            </div>
            
            <div className="flex-grow min-h-0 relative">
              <div style={{ display: (isProcessingAi || parseError) ? 'flex' : 'none', height: '100%', alignItems: 'center', justifyContent: 'center' }} className="bg-muted/50 rounded-md">
                {isProcessingAi && (
                    <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                    <p className="mt-2 text-muted-foreground">AI processing... Please wait.</p>
                    </div>
                )}
                {parseError && (
                    <div className="p-4">
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>AI Processing Error</AlertTitle>
                        <AlertDescription>{parseError}</AlertDescription>
                    </Alert>
                    </div>
                )}
              </div>
              
              <div style={{ display: !(isProcessingAi || parseError) ? 'block' : 'none', height: '100%' }}>
                {!parsedDetails ? (
                  <DocumentEditorContainerComponent 
                    id="upload-editor"
                    ref={editorRef} 
                    style={{ display: "block" }}
                    height="100%"
                    serviceUrl="https://ej2services.syncfusion.com/production/web-services/api/documenteditor/"
                    enableToolbar={true}
                    showPropertiesPane={false}
                  >
                    <Inject services={[Toolbar]} />
                  </DocumentEditorContainerComponent>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="space-y-4 pr-4">{renderAiAnalysis()}</div>
                  </ScrollArea>
                )}
              </div>
            </div>

          </div>
        </div>
        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>Cancel</Button>
          <Button 
            onClick={handleSaveContract} 
            disabled={isProcessingAi || isSaving || !canPerformProAction}
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Contract
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

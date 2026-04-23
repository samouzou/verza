"use client";
import { useState, useTransition, useEffect, useRef, useMemo } from "react";
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
import { ocrDocument } from "@/ai/flows/ocr-flow";
import { extractContractDetails, type ExtractContractDetailsOutput } from "@/ai/flows/extract-contract-details";
import { summarizeContractTerms, type SummarizeContractTermsOutput } from "@/ai/flows/summarize-contract-terms";
import { getNegotiationSuggestions, type NegotiationSuggestionsOutput } from "@/ai/flows/negotiation-suggestions-flow";
import { Loader2, UploadCloud, FileText, Wand2, AlertTriangle, ExternalLink, Sparkles, Users, PlusCircle, Trash2, DollarSign, Save } from "lucide-react";
import type { Agency, Contract, PaymentMilestone, Talent, UserProfile } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, addDoc, serverTimestamp as firebaseServerTimestamp, Timestamp, storage, query, where, getDoc, doc, updateDoc, getDocs, writeBatch, arrayUnion, arrayRemove } from '@/lib/firebase';
import { ref as storageRefOriginal, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DocumentEditorContainerComponent, Inject, Toolbar, Ribbon } from '@syncfusion/ej2-react-documenteditor';
import { registerLicense } from '@syncfusion/ej2-base';
import { v4 as uuidv4 } from 'uuid';
import { trackEvent } from "@/lib/analytics";
import mammoth from 'mammoth';
import { generateContractFromPrompt } from "@/ai/flows/generate-contract-from-prompt-flow";

if (process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY) {
  registerLicense(process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY);
}

DocumentEditorContainerComponent.Inject(Toolbar, Ribbon);

interface UploadContractDialogProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialSFDT?: string;
  initialSelectedOwner?: string;
  initialFileName?: string;
  affiliatedCreator?: UserProfile;
}

export function UploadContractDialog({ isOpen: controlledIsOpen, onOpenChange: controlledOnOpenChange, initialSFDT, initialSelectedOwner, initialFileName, affiliatedCreator }: UploadContractDialogProps) {
  const [isInternalOpen, setInternalOpen] = useState(false);
  
  const isOpen = controlledIsOpen ?? isInternalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;

  const [fileName, setFileName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { user, refreshAuthUser } = useAuth();
  
  const [agency, setAgency] = useState<Agency | null>(null);
  const [selectedOwner, setSelectedOwner] = useState<string>("personal");

  const [parsedDetails, setParsedDetails] = useState<ExtractContractDetailsOutput | null>(null);
  const [summary, setSummary] = useState<SummarizeContractTermsOutput | null>(null);
  const [negotiationSuggestions, setNegotiationSuggestions] = useState<NegotiationSuggestionsOutput | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [agencyOwnerProfile, setAgencyOwnerProfile] = useState<any>(null);
  
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");

  const [milestones, setMilestones] = useState<Omit<PaymentMilestone, 'status'>[]>([{ id: uuidv4(), description: "", amount: 0, dueDate: "" }]);

  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<Contract['recurrenceInterval'] | undefined>(undefined);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  
  const editorRef = useRef<DocumentEditorContainerComponent | null>(null);
  const hasInitializedRef = useRef(false);

  const subscriptionHolder = agencyOwnerProfile || user;
  const now = Date.now();
  const isIndividualCreator = user?.role === 'individual_creator';
  const canPerformProAction =
    isIndividualCreator ||
    subscriptionHolder?.subscriptionStatus === 'active' ||
    (subscriptionHolder?.subscriptionStatus === 'trialing' &&
      subscriptionHolder.trialEndsAt &&
      (typeof subscriptionHolder.trialEndsAt.toMillis === 'function'
        ? subscriptionHolder.trialEndsAt.toMillis()
        : subscriptionHolder.trialEndsAt.seconds * 1000) > now);

  const isAgencyManager = user?.role === 'agency_owner' || user?.role === 'agency_admin' || user?.role === 'agency_member';

  const talentOptions = useMemo(() => {
    if (!agency) return [];
    const currentTalent = agency.talent || [];
    if (affiliatedCreator && !currentTalent.some(t => t.userId === affiliatedCreator.uid)) {
        const newTalentFromAffiliation: Talent = {
            userId: affiliatedCreator.uid,
            displayName: affiliatedCreator.displayName || 'Creator',
            email: affiliatedCreator.email || '',
            status: 'active' 
        };
        return [...currentTalent, newTalentFromAffiliation].filter(t => t.status === 'active');
    }
    return currentTalent.filter(t => t.status === 'active');
  }, [agency, affiliatedCreator]);

  const resetState = () => {
      if (editorRef.current?.documentEditor) {
          const emptySfdt = JSON.stringify({ sections: [{ blocks: [{ inlines: [{ text: "" }] }], sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 } }] });
          editorRef.current.documentEditor.open(emptySfdt);
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
      setMilestones([{ id: uuidv4(), description: "", amount: 0, dueDate: "" }]);
      setIsRecurring(false);
      setRecurrenceInterval(undefined);
      setGenerationPrompt("");
      setIsGenerating(false);
      setAgency(null);
      setSelectedOwner("personal");
      hasInitializedRef.current = false;
  };

  useEffect(() => {
    if (!isOpen) {
      resetState();
      return;
    }

    if (hasInitializedRef.current) return;

    const initializeDialog = async () => {
        if (isAgencyManager && user?.primaryAgencyId) {
            try {
                const agencyDocRef = doc(db, "agencies", user.primaryAgencyId);
                const docSnap = await getDoc(agencyDocRef);
                if (docSnap.exists()) {
                    const agencyData = { id: docSnap.id, ...docSnap.data() } as Agency;
                    setAgency(agencyData);
                    
                    if (agencyData.ownerId !== user.uid) {
                        const ownerDocRef = doc(db, "users", agencyData.ownerId);
                        const ownerSnap = await getDoc(ownerDocRef);
                        if (ownerSnap.exists()) {
                            setAgencyOwnerProfile(ownerSnap.data());
                        }
                    }

                    if (initialSelectedOwner) {
                      setSelectedOwner(initialSelectedOwner);
                    } else if (user.isAgencyOwner) {
                      setSelectedOwner('personal');
                    }
                }
            } catch (e) {
                console.error("Error fetching agency info:", e);
            }
        }

        if (initialSFDT) {
            if (editorRef.current?.documentEditor) {
                editorRef.current.documentEditor.open(initialSFDT);
                handleFullAnalysis(initialSFDT);
            } else {
                setTimeout(() => {
                    if (editorRef.current?.documentEditor) {
                      editorRef.current.documentEditor.open(initialSFDT);
                      handleFullAnalysis(initialSFDT);
                    }
                }, 500);
            }
        }

        if (initialFileName) {
            setFileName(initialFileName);
        }
        
        hasInitializedRef.current = true;
    };

    initializeDialog();
  }, [isOpen, initialSFDT, initialSelectedOwner, initialFileName, isAgencyManager]);

  const handleFullAnalysis = async (textToAnalyze: string) => {
    toast({ title: "Analyzing Contract", description: "AI is extracting details, summarizing, and providing suggestions..." });
    setIsProcessingAi(true);
    setParseError(null);
    setParsedDetails(null);
    setSummary(null);
    setNegotiationSuggestions(null);

    try {
      const [details, summaryOutput, negSuggestions] = await Promise.all([
        extractContractDetails({ contractText: textToAnalyze }),
        summarizeContractTerms({ contractText: textToAnalyze }),
        getNegotiationSuggestions({ contractText: textToAnalyze }),
      ]);
      setParsedDetails(details);
      setSummary(summaryOutput);
      setNegotiationSuggestions(negSuggestions);
      
      if (details.amount) {
        setMilestones([{
            id: uuidv4(),
            description: projectName || details.brand || "Initial Payment",
            amount: details.amount,
            dueDate: details.dueDate || new Date().toISOString().split('T')[0]
        }]);
      }

      trackEvent({ action: 'analyze_contract', category: 'ai_tool', label: details.brand });

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

  const handleGenerateContract = async () => {
    if (!generationPrompt.trim() || !editorRef.current) return;
    setIsGenerating(true);
    toast({ title: "Generating Contract", description: "AI is drafting your contract..." });
    try {
      const result = await generateContractFromPrompt({
        prompt: generationPrompt,
        creatorName: user?.displayName || undefined,
        clientName: clientName.trim() || undefined,
      });
      const sfdtPayload = {
        sections: [{
          blocks: result.contractText.split('\n').map(paragraph => ({
            inlines: [{ text: paragraph, characterFormat: { fontSize: 11, fontFamily: 'Arial' } }],
            paragraphFormat: { styleName: 'Normal' },
          })),
          sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 },
        }],
      };
      editorRef.current.documentEditor.open(JSON.stringify(sfdtPayload));
      toast({ title: "Contract Generated", description: "Your contract has been loaded into the editor. Review and edit as needed." });
      trackEvent({ action: 'generate_contract_from_prompt', category: 'ai_tool' });
    } catch (error) {
      console.error("Contract generation error:", error);
      toast({ title: "Generation Failed", description: error instanceof Error ? error.message : "Could not generate contract.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editorRef.current) return;
  
    setSelectedFile(file);
    if (!fileName.trim()) {
      setFileName(file.name);
    }
  
    setIsProcessingAi(true);
    setParseError(null);
    toast({ title: "File Uploaded", description: "Processing document..." });
  
    try {
      const isWordDoc = file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.endsWith('.docx');
      const isPdfOrImage = file.type.startsWith('application/pdf') || file.type.startsWith('image/');

      if (isWordDoc) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            
            const sfdtPayload = {
              sections: [
                 {
                   blocks: result.value.split('\n').map(paragraph => ({
                     inlines: [{ 
                        text: paragraph, 
                        characterFormat: { fontSize: 11, fontFamily: 'Arial' } 
                     }],
                     paragraphFormat: { styleName: 'Normal' }
                   })),
                   sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 }
                 }
              ]
            };
            
            const sfdtString = JSON.stringify(sfdtPayload);
            editorRef.current.documentEditor.open(sfdtString);
            
            setTimeout(async () => {
                await handleFullAnalysis(sfdtString);
            }, 1000);
        } catch (editorError) {
          console.error("Error parsing DOCX with Mammoth:", editorError);
          throw new Error("The editor could not process this .docx file.");
        }

      } else if (isPdfOrImage) {
        const reader = new FileReader();
        const dataUri = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        const ocrResult = await ocrDocument({ documentDataUri: dataUri });
        
        const sfdtPayload = {
          sections: [
             {
               blocks: ocrResult.extractedText.split('\n').map(paragraph => ({
                 inlines: [{ 
                    text: paragraph, 
                    characterFormat: { fontSize: 11, fontFamily: 'Arial' } 
                 }],
                 paragraphFormat: { styleName: 'Normal' }
               })),
               sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 }
             }
          ]
        };
        
        const sfdtString = JSON.stringify(sfdtPayload);
        editorRef.current.documentEditor.open(sfdtString);

        await handleFullAnalysis(sfdtString);

      } else {
        throw new Error("Unsupported file type. Please upload a .docx, PDF, or image file.");
      }
    } catch (error) {
      console.error("Error during file processing:", error);
      const errorMessage = error instanceof Error ? error.message : "Could not process file.";
      setParseError(errorMessage);
      toast({
        title: "File Processing Failed",
        description: errorMessage,
        variant: "destructive",
      });
      setIsProcessingAi(false);
    }
  };
  
  const handlePastedText = async () => {
    if (!editorRef.current) return;
    const sfdtString = editorRef.current.documentEditor.serialize();
    await handleFullAnalysis(sfdtString);
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
    if (!editorRef.current) {
      toast({ title: "Editor Not Ready", description: "The document processor is not ready. Please wait a moment and try again.", variant: "destructive"});
      return;
    }

    const totalAmountValue = milestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    if (totalAmountValue <= 0) {
      toast({ title: "Invalid Amount", description: "Total amount from milestones must be greater than zero.", variant: "destructive"});
      return;
    }

    setIsSaving(true);
    let fileUrlToSave: string | null = null;
    
    let ownerType: 'user' | 'agency' = 'user';
    let ownerId = user.uid;
    let finalUserId = user.uid;
    let talentName: string | undefined | null = undefined;
    const accessMap: { [key: string]: 'owner' | 'viewer' | 'talent' } = {};
    accessMap[user.uid] = 'owner';

    if (!isAgencyManager) {
        ownerType = 'user';
        ownerId = user.uid;
        finalUserId = user.uid;
    } else if (agency) {
        if (selectedOwner === 'personal') {
            ownerType = 'agency';
            ownerId = agency.id;
            finalUserId = user.uid; 
        } else {
            ownerType = 'agency';
            ownerId = agency.id;
            finalUserId = selectedOwner; 
            talentName = talentOptions.find(t => t.userId === finalUserId)?.displayName;
            accessMap[finalUserId] = 'talent';
        }
        agency.team?.forEach(member => {
            if (member.userId !== user.uid) {
                accessMap[member.userId] = member.role === 'admin' ? 'owner' : 'viewer';
            }
        });
        if(agency.ownerId !== user.uid) {
          accessMap[agency.ownerId] = 'owner';
        }
    }

    try {
      const batch = writeBatch(db);

      if (selectedFile) {
        const filePath = `contracts/${ownerId}/${Date.now()}_${selectedFile.name}`;
        const fileStorageRef = storageRefOriginal(storage, filePath);
        const uploadResult = await uploadBytes(fileStorageRef, selectedFile);
        fileUrlToSave = await getDownloadURL(uploadResult.ref);
      }
      
      const sfdtString = await editorRef.current.documentEditor.serialize();
      const finalMilestones: PaymentMilestone[] = milestones.map(m => ({ ...m, status: 'pending' }));

      const contractDataForFirestore: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'> & { createdAt: any, updatedAt: any, access: any } = {
        userId: finalUserId,
        talentName: talentName || null,
        ownerType: ownerType,
        ownerId: ownerId,
        brand: parsedDetails?.brand || "Unknown Brand",
        amount: totalAmountValue,
        dueDate: milestones.reduce((latest, m) => m.dueDate > latest ? m.dueDate : latest, "1970-01-01"),
        status: 'pending' as Contract['status'],
        contractType: 'other' as Contract['contractType'],
        contractText: sfdtString,
        fileName: fileName.trim() || (selectedFile ? selectedFile.name : (sfdtString.trim() ? "Pasted Contract" : "Untitled Contract")),
        fileUrl: fileUrlToSave || null,
        summary: summary?.summary || (sfdtString.trim() ? "Summary not generated by AI." : "No summary available."),
        extractedTerms: parsedDetails?.extractedTerms ? JSON.parse(JSON.stringify(parsedDetails.extractedTerms)) : {},
        negotiationSuggestions: negotiationSuggestions ? JSON.parse(JSON.stringify(negotiationSuggestions)) : null,
        milestones: finalMilestones,
        invoiceStatus: 'none', 
        access: accessMap,
        createdAt: firebaseServerTimestamp(),
        updatedAt: firebaseServerTimestamp(),
      };
      
      const trimmedProjectName = projectName.trim();
      if (trimmedProjectName) { contractDataForFirestore.projectName = trimmedProjectName; }
      const trimmedClientName = clientName.trim();
      if (trimmedClientName) { contractDataForFirestore.clientName = trimmedClientName; }
      const trimmedClientEmail = clientEmail.trim();
      if (trimmedClientEmail) { contractDataForFirestore.clientEmail = trimmedClientEmail; }
      const trimmedClientAddress = clientAddress.trim();
      if (trimmedClientAddress) { contractDataForFirestore.clientAddress = trimmedClientAddress; }
      const trimmedPaymentInstructions = paymentInstructions.trim();
      if (trimmedPaymentInstructions) { contractDataForFirestore.paymentInstructions = trimmedPaymentInstructions; }
      if (isRecurring) { contractDataForFirestore.isRecurring = true; if (recurrenceInterval) { contractDataForFirestore.recurrenceInterval = recurrenceInterval; }}

      const newContractRef = doc(collection(db, 'contracts'));
      batch.set(newContractRef, contractDataForFirestore);
      
      const userDocRef = doc(db, 'users', user.uid);
      batch.update(userDocRef, { hasCreatedContract: true });
      
      await batch.commit();
      
      trackEvent({ action: 'save_contract', category: 'engagement', label: ownerType });

      onOpenChange(false);
      await refreshAuthUser();
      toast({ title: "Contract Saved", description: `${contractDataForFirestore.brand} contract added successfully.` });
    } catch (error) {
      console.error("Error saving contract:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      toast({ title: "Save Failed", description: `Could not save contract: ${errorMessage}`, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleMilestoneChange = (id: string, field: keyof Omit<PaymentMilestone, 'id' | 'status'>, value: string | number) => {
    setMilestones(currentMilestones => 
      currentMilestones.map(m => m.id === id ? { ...m, [field]: value } : m)
    );
  };
  
  const addMilestone = () => {
    setMilestones([...milestones, { id: uuidv4(), description: "", amount: 0, dueDate: "" }]);
  };
  
  const removeMilestone = (id: string) => {
    if (milestones.length > 1) {
      setMilestones(milestones.filter(m => m.id !== id));
    } else {
      toast({ title: "Cannot Remove", description: "You must have at least one payment milestone."});
    }
  };

  const currentTotalAmount = milestones.reduce((sum, m) => sum + Number(m.amount || 0), 0);

  const renderAiAnalysis = () => (
    <>
      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />AI-Extracted Details</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><strong>Brand:</strong> {parsedDetails?.brand || '...'}</p>
          <p><strong>Total Amount:</strong> ${currentTotalAmount.toLocaleString()}</p>
          <p><strong>Final Due Date:</strong> {milestones.reduce((latest, m) => m.dueDate > latest ? m.dueDate : latest, "N/A")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">AI Summary</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{summary?.summary || "No summary available."}</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">Negotiation Suggestions</CardTitle></CardHeader>
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
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {!controlledIsOpen && (
        <DialogTrigger asChild>
          <Button id="add-contract-button"><UploadCloud className="mr-2 h-4 w-4" /> Add Contract</Button>
        </DialogTrigger>
      )}
      <DialogContent 
        className="w-[95vw] max-w-[95vw] max-h-[90vh] flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-6 w-6 text-primary" /> Add New Contract</DialogTitle>
          <DialogDescription>Generate a contract with AI, upload a file, or paste text to extract details and analyze.</DialogDescription>
        </DialogHeader>
        
        {!canPerformProAction && (
          <Alert variant="default" className="border-primary/50 bg-primary/5 text-primary-foreground [&>svg]:text-primary">
            <Sparkles className="h-5 w-5" />
            <AlertTitle className="font-semibold text-primary">Upgrade to Verza Pro</AlertTitle>
            <AlertDescription className="text-primary/90">Adding new contracts is a Pro feature. Please upgrade your plan to continue.</AlertDescription>
            <div className="mt-3"><Button variant="default" size="sm" asChild className="bg-primary text-primary-foreground hover:bg-primary/90"><Link href="/settings">Manage Subscription <ExternalLink className="ml-2 h-4 w-4" /></Link></Button></div>
          </Alert>
        )}

        <div className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-hidden p-1">
          <ScrollArea className="h-full"><div className="space-y-6 pr-6">
            {isAgencyManager && agency && (
              <div>
                <Label htmlFor="contractOwner">Contract For</Label>
                <Select value={selectedOwner} onValueChange={setSelectedOwner} disabled={isSaving}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select who this contract is for..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">My Agency ({agency.name})</SelectItem>
                    {talentOptions.map(t => (
                      <SelectItem key={t.userId} value={t.userId}>{t.displayName} (Talent)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label htmlFor="fileName">File Name (Optional)</Label><Input id="fileName" type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="e.g., BrandX_Sponsorship_Q4.pdf" className="mt-1" /></div>
            <div><Label htmlFor="projectName">Project Name (Optional)</Label><Input id="projectName" type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g., Q3 YouTube Campaign" className="mt-1" /></div>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center justify-between"><span className="flex items-center gap-2"><Wand2 className="h-5 w-5 text-primary" />Contract Co-Pilot</span><span className="text-sm font-normal text-muted-foreground">Generate with AI</span></CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  id="generationPrompt"
                  value={generationPrompt}
                  onChange={(e) => setGenerationPrompt(e.target.value)}
                  placeholder="e.g., Draft a 6-month sponsorship agreement with Brand X for $5,000, covering 4 YouTube videos per month with 30-day payment terms and no exclusivity."
                  rows={4}
                  disabled={isGenerating || isProcessingAi}
                />
                <Button
                  type="button"
                  onClick={handleGenerateContract}
                  disabled={!generationPrompt.trim() || isGenerating || isProcessingAi}
                  className="w-full"
                >
                  {isGenerating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Sparkles className="mr-2 h-4 w-4" />Generate Contract</>}
                </Button>
              </CardContent>
            </Card>

            <div><Label htmlFor="contractFile">Upload Contract File</Label><Input id="contractFile" type="file" accept=".pdf,.doc,.docx,image/*" className="mt-1" onChange={handleFileChange} /><p className="text-xs text-muted-foreground mt-1">Supports DOCX, PDF, PNG, JPG. Text will be loaded into the editor.</p></div>

            <Card><CardHeader><CardTitle className="text-lg">Client & Payment Details (for Invoicing)</CardTitle></CardHeader><CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label htmlFor="clientName">Client Name</Label><Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client Company Inc." className="mt-1" /></div>
                <div><Label htmlFor="clientEmail">Client Email</Label><Input id="clientEmail" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="contact@client.com" className="mt-1" /></div>
                <div className="md:col-span-2"><Label htmlFor="clientAddress">Client Address</Label><Textarea id="clientAddress" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="123 Client St, City, Country" className="mt-1" rows={3} /></div>
                <div className="md:col-span-2"><Label htmlFor="paymentInstructions">Payment Instructions</Label><Textarea id="paymentInstructions" value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} placeholder="Bank: XYZ, Account: 12345, Swift: ABCDE..." className="mt-1" rows={3} /></div>
            </CardContent></Card>

            <Card><CardHeader><CardTitle className="text-lg flex items-center gap-2"><DollarSign className="h-5 w-5 text-primary" />Payment Milestones</CardTitle></CardHeader><CardContent className="space-y-4">
              {milestones.map((milestone, index) => (
                <div key={milestone.id} className="grid grid-cols-12 gap-2 items-end p-2 border rounded-md relative">
                  <div className="col-span-12"><Label htmlFor={`milestone-desc-${index}`}>Description</Label><Input id={`milestone-desc-${index}`} value={milestone.description} onChange={(e) => handleMilestoneChange(milestone.id, 'description', e.target.value)} placeholder="e.g., 50% Upfront" className="mt-1"/></div>
                  <div className="col-span-6"><Label htmlFor={`milestone-amount-${index}`}>Amount</Label><Input id={`milestone-amount-${index}`} type="number" value={milestone.amount} onChange={(e) => handleMilestoneChange(milestone.id, 'amount', Number(e.target.value))} placeholder="5000" className="mt-1"/></div>
                  <div className="col-span-6"><Label htmlFor={`milestone-due-${index}`}>Due Date</Label><Input id={`milestone-due-${index}`} type="date" value={milestone.dueDate} onChange={(e) => handleMilestoneChange(milestone.id, 'dueDate', e.target.value)} className="mt-1"/></div>
                  {milestones.length > 1 && <Button type="button" size="icon" variant="ghost" className="absolute top-1 right-1 h-6 w-6 text-destructive" onClick={() => removeMilestone(milestone.id)}><Trash2 className="h-4 w-4"/></Button>}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addMilestone}><PlusCircle className="mr-2 h-4 w-4"/>Add Milestone</Button>
              <div className="text-right font-semibold">Total Amount: ${currentTotalAmount.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground text-right">A 15% Verza fee + payment processing fees apply on invoice payments.</p>
            </CardContent></Card>
            
            <Card><CardHeader><CardTitle className="text-lg">Contract Recurrence (Optional)</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="flex items-center space-x-2"><Checkbox id="isRecurring" checked={isRecurring} onCheckedChange={(checked) => setIsRecurring(checked as boolean)} /><Label htmlFor="isRecurring" className="font-normal">Is this a recurring contract?</Label></div>
              {isRecurring && (<div><Label htmlFor="recurrenceInterval">Recurrence Interval</Label><Select value={recurrenceInterval} onValueChange={(value) => setRecurrenceInterval(value as Contract['recurrenceInterval'])}><SelectTrigger id="recurrenceInterval" className="mt-1"><SelectValue placeholder="Select interval" /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annually">Annually</SelectItem></SelectContent></Select></div>)}
            </CardContent></Card>
          </div></ScrollArea>

          <div className="flex flex-col gap-6 overflow-hidden">
            <div className="flex-shrink-0"><Label>Contract Text & AI Analysis</Label><div className="flex items-center gap-2 mt-1"><Button onClick={handlePastedText} variant="outline" size="sm" disabled={isProcessingAi}><Wand2 className="mr-2 h-4 w-4" /> Run AI Analysis</Button><p className="text-xs text-muted-foreground">Paste text into the editor below and click to analyze.</p></div></div>
            <div className="flex-grow min-h-0 relative">
               <div style={{ display: isProcessingAi || parseError ? 'flex' : 'none', zIndex: 10 }} className="absolute inset-0 bg-muted/50 rounded-md items-center justify-center">
                {isProcessingAi && (<div className="text-center p-4 bg-background rounded-lg shadow-lg"><Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" /><p className="mt-2 text-muted-foreground">AI processing... Please wait.</p></div>)}
                {parseError && (<div className="p-4 bg-background rounded-lg shadow-lg"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>AI Error</AlertTitle><AlertDescription>{parseError}</AlertDescription></Alert></div>)}
              </div>
              <div id="container" style={{ height: '100%' }} className="border rounded-md">
                  <DocumentEditorContainerComponent id="editor" ref={editorRef} height="100%" serviceUrl="https://ej2services.syncfusion.com/production/web-services/api/documenteditor/" showPropertiesPane={false} enableToolbar={true} toolbarMode={'Ribbon'} ribbonLayout={'Simplified'} currentUser={user?.displayName || "Guest"} locale="en-US" />
              </div>
              {parsedDetails && (<div style={{ display: parsedDetails ? 'block' : 'none', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'hsl(var(--background))' }}><ScrollArea className="h-full"><div className="space-y-4 pr-4">{renderAiAnalysis()}</div></ScrollArea></div>)}
            </div>
          </div>
        </div>
        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSaveContract} disabled={isProcessingAi || isSaving || !canPerformProAction}><Save className="mr-2 h-4 w-4" />{isSaving ? 'Saving...' : 'Save Contract'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


"use client";

import { useEffect, useState, FormEvent, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { db, doc, getDoc, updateDoc, Timestamp, functions as firebaseAppFunctions } from '@/lib/firebase';
import { httpsCallableFromURL } from 'firebase/functions';
import type { Contract, NegotiationSuggestionsOutput } from '@/types';
import { ArrowLeft, Save, Loader2, AlertTriangle, Wand2, Copy, Check, Lightbulb, Send as SendIcon } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { diffChars } from 'diff';

import { extractContractDetails } from "@/ai/flows/extract-contract-details";
import { summarizeContractTerms } from "@/ai/flows/summarize-contract-terms";
import { getNegotiationSuggestions } from "@/ai/flows/negotiation-suggestions-flow";
import { DocumentEditorContainerComponent, Toolbar, Ribbon } from '@syncfusion/ej2-react-documenteditor';
import { registerLicense } from '@syncfusion/ej2-base';
import { useSidebar } from '@/components/ui/sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const INITIATE_HELLOSIGN_REQUEST_FUNCTION_URL = "https://initiatehellosignrequest-cpmccwbluq-uc.a.run.app";


if (process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY) {
  registerLicense(process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY);
}

// Inject the required modules for the Document Editor
DocumentEditorContainerComponent.Inject(Toolbar, Ribbon);


export default function EditContractPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, isLoading: authLoading, getUserIdToken } = useAuth();
  const { toast } = useToast();

  let editorRef = useRef<DocumentEditorContainerComponent | null>(null);

  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoadingContract, setIsLoadingContract] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReparsingAi, setIsReparsingAi] = useState(false);

  // E-Signature State
  const [isSendingForSignature, setIsSendingForSignature] = useState(false);
  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [signerEmailOverride, setSignerEmailOverride] = useState("");
  
  // State for editable contract text and its AI-derived data
  const [currentSummary, setCurrentSummary] = useState<string | undefined>(undefined);
  const [currentNegotiationSuggestions, setCurrentNegotiationSuggestions] = useState<NegotiationSuggestionsOutput | null | undefined>(null);

  const [copiedSuggestion, setCopiedSuggestion] = useState<string | null>(null);
  const { setOpen } = useSidebar();

  useEffect(() => {
    // Collapse sidebar by default on this page
    setOpen(false);
  }, [setOpen]);


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

          if (contractSnap.exists()) {
            const data = contractSnap.data() as Contract;
            const agencyId = user.agencyMemberships?.find(m => m.role === 'owner')?.agencyId;
            const isOwner = data.userId === user.uid;
            const isAgencyOwner = user.role === 'agency_owner' && data.ownerType === 'agency' && data.ownerId === agencyId;
            
            if (isOwner || isAgencyOwner) {
                const contractWithId = { ...data, id: contractSnap.id };
                setContract(contractWithId);
                setCurrentSummary(data.summary);
                setCurrentNegotiationSuggestions(data.negotiationSuggestions);
            } else {
                 toast({ title: "Error", description: "Contract not found or access denied.", variant: "destructive" });
                 router.push('/contracts');
            }
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

  useEffect(() => {
    if (isSignatureDialogOpen && contract) {
      setSignerEmailOverride(contract.clientEmail || "");
    }
  }, [isSignatureDialogOpen, contract]);

  const onEditorCreated = () => {
    if (editorRef.current && contract?.contractText) {
        try {
            editorRef.current.documentEditor.open(contract.contractText);
        } catch (e) {
            console.error("Failed to load SFDT content, opening empty document:", e);
            editorRef.current.documentEditor.open(JSON.stringify({ sfdt: '' }));
        }
    }
  };

  const handleAiReparse = async () => {
    if (!editorRef.current) return;
    
    const sfdtString = editorRef.current.documentEditor.serialize();

    if (!sfdtString.trim()) {
      toast({ title: "Cannot Parse", description: "Contract text is empty.", variant: "destructive" });
      return;
    }
    setIsReparsingAi(true);
    try {
      const [details, summaryOutput, suggestions] = await Promise.all([
        extractContractDetails({ contractText: sfdtString }),
        summarizeContractTerms({ contractText: sfdtString }),
        getNegotiationSuggestions({ contractText: sfdtString }),
      ]);
      
      setCurrentSummary(summaryOutput.summary);
      setCurrentNegotiationSuggestions(suggestions ? JSON.parse(JSON.stringify(suggestions)) : null);
      
      // Update the contract in Firestore with the new AI data without affecting metadata
      const contractDocRef = doc(db, 'contracts', id);
      await updateDoc(contractDocRef, {
          brand: details.brand || "Unknown Brand",
          amount: details.amount || 0,
          dueDate: details.dueDate ? new Date(details.dueDate + 'T00:00:00Z').toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          summary: summaryOutput.summary || null,
          negotiationSuggestions: suggestions ? JSON.parse(JSON.stringify(suggestions)) : null,
          updatedAt: Timestamp.now(),
      });
      
      toast({ title: "AI Re-processing Complete", description: "Contract summary and suggestions updated." });
    } catch (error) {
      console.error("Error re-parsing with AI:", error);
      toast({ title: "AI Error", description: "Could not re-process contract text.", variant: "destructive" });
    } finally {
      setIsReparsingAi(false);
    }
  };
  
  const handleSaveTextChanges = async (event?: MouseEvent) => {
    event?.preventDefault(); 
    if (!contract || !user || !editorRef.current) {
      toast({ title: "Error", description: "Contract, user, or editor data missing.", variant: "destructive" });
      return false;
    }
    setIsSaving(true);

    const newContractText = await editorRef.current.documentEditor.serialize();

    try {
      const contractDocRef = doc(db, 'contracts', id);
      
      const updates: Partial<Contract> = {
        previousContractText: contract.contractText,
        contractText: newContractText,
        updatedAt: Timestamp.now(),
      };

      await updateDoc(contractDocRef, updates);
      toast({ title: "Contract Text Saved", description: "Changes to the document text have been saved." });
      setContract(prev => prev ? { ...prev, ...updates } as Contract : null);
      setIsSaving(false);
      return true;
    } catch (error) {
      console.error("Error updating contract text:", error);
      toast({ title: "Update Failed", description: "Could not save text changes.", variant: "destructive" });
      setIsSaving(false);
      return false;
    }
  };

  const handleInitiateSignatureRequest = async () => {
    if (!contract || !user) {
      toast({ title: "Error", description: "Contract or user data missing.", variant: "destructive" });
      return;
    }
    
    // First, save any pending text changes to ensure the latest version is used.
    toast({ title: "Saving...", description: "Ensuring latest version is saved before sending." });
    const isSaveSuccessful = await handleSaveTextChanges();
    if (!isSaveSuccessful) {
        toast({ title: "E-Signature Canceled", description: "Could not send for signature because changes could not be saved.", variant: "destructive" });
        return;
    }
    
    if (!signerEmailOverride.trim()) {
      toast({ title: "Email Required", description: "Please enter the signer's email address.", variant: "destructive" });
      return;
    }
    if (!contract.fileUrl && !contract.contractText) {
      toast({ title: "File or Text Missing", description: "This contract does not have an uploaded file or text to send for signature.", variant: "destructive" });
      return;
    }
  
    setIsSendingForSignature(true);
    try {
      const idToken = await getUserIdToken();
      if (!idToken) {
        throw new Error("Authentication token is not available.");
      }
      
      const initiateRequestCallable = httpsCallableFromURL(
        firebaseAppFunctions, 
        INITIATE_HELLOSIGN_REQUEST_FUNCTION_URL
      );
  
      const result = await initiateRequestCallable({
        contractId: contract.id,
        signerEmailOverride: signerEmailOverride.trim(),
      });
  
      const data = result.data as { success: boolean; message: string; helloSignRequestId?: string };
  
      if (data.success) {
        toast({ title: "E-Signature Request Sent", description: data.message });
        setIsSignatureDialogOpen(false); 
        router.push(`/contracts/${id}`); // Navigate back to details page after successful send
      } else {
        throw new Error(data.message || "Failed to send e-signature request.");
      }
    } catch (error: any) {
      console.error("Error initiating Dropbox Sign request:", error);
      toast({
        title: "E-Signature Error",
        description: error.message || "Could not initiate e-signature request.",
        variant: "destructive",
      });
    } finally {
      setIsSendingForSignature(false);
    }
  };
  
  const canSendSignatureRequest = !contract?.signatureStatus || 
                                   contract.signatureStatus === 'none' || 
                                   contract.signatureStatus === 'error' || 
                                   contract.signatureStatus === 'declined' ||
                                   contract.signatureStatus === 'canceled';


  const getSignatureButtonText = () => {
    if (!contract?.signatureStatus || contract.signatureStatus === 'none') return "Send for E-Signature";
    if (contract.signatureStatus === 'sent') return "Signature Request Sent";
    if (contract.signatureStatus === 'signed') return "Document Signed";
    if (contract.signatureStatus === 'viewed_by_signer') return "Viewed by Signer";
    if (contract.signatureStatus === 'declined') return "Signature Declined - Resend?";
    if (contract.signatureStatus === 'canceled') return "Request Canceled - Resend?";
    if (contract.signatureStatus === 'error') return "Error Sending - Retry?";
    return "Manage E-Signature";
  };
  
  const renderSidebarContent = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lightbulb className="text-yellow-400"/> AI Negotiation Assistant</CardTitle>
          <CardDescription>AI-generated summary and negotiation points.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh_-_12rem)] pr-3">
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
    </div>
  );

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
    <>
      <div className="h-full flex flex-col">
        <PageHeader
          title={`Edit: ${contract.brand || 'Contract'}`}
          description="Modify the contract text and details. Your changes will be saved to a new version."
          actions={
            <div className="flex items-center gap-2">
              <Dialog open={isSignatureDialogOpen} onOpenChange={setIsSignatureDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" disabled={!canSendSignatureRequest || isSendingForSignature}>
                    {getSignatureButtonText()}
                  </Button>
                </DialogTrigger>
                {canSendSignatureRequest && (
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Send for E-Signature</DialogTitle>
                      <DialogDescription>
                        This will first save any unsaved changes, then send the updated contract to the client for signature via Dropbox Sign. You will also be required to sign.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div>
                        <Label htmlFor="signer-email">Client's Email</Label>
                        <Input 
                          id="signer-email"
                          type="email"
                          value={signerEmailOverride}
                          onChange={(e) => setSignerEmailOverride(e.target.value)}
                          placeholder="client@example.com"
                          disabled={isSendingForSignature}
                        />
                        <p className="text-xs text-muted-foreground mt-1">Defaults to client email on contract, if available.</p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsSignatureDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleInitiateSignatureRequest} disabled={isSendingForSignature || isSaving || !signerEmailOverride.trim()}>
                        {isSendingForSignature ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SendIcon className="mr-2 h-4 w-4" />}
                        Save & Send Request
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                )}
              </Dialog>
              <Button variant="outline" type="button" onClick={() => router.push(`/contracts/${id}`)} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="button" onClick={(e) => handleSaveTextChanges(e as any)} disabled={isSaving || isReparsingAi}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Text Changes
              </Button>
            </div>
          }
        />
        <div className="flex-grow grid grid-cols-1 lg:grid-cols-3 gap-8 mt-4 min-h-0">
          <div className="lg:col-span-2 min-h-0">
              <Card className="h-full flex flex-col">
                 <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Contract Editor</CardTitle>
                      <CardDescription>Make changes to the full text of the contract below.</CardDescription>
                    </div>
                     <Button
                      type="button"
                      onClick={handleAiReparse}
                      disabled={isReparsingAi || isSaving}
                      variant="outline"
                      size="sm"
                    >
                      {isReparsingAi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                      Re-process with AI
                    </Button>
                </CardHeader>
                <CardContent className="flex-grow">
                  <div id="container" style={{ height: '100%' }}>
                    <DocumentEditorContainerComponent 
                      id="editor"
                      ref={editorRef} 
                      created={onEditorCreated}
                      height={'100%'} 
                      showPropertiesPane={false}
                      enableToolbar={true}
                      toolbarMode={'Ribbon'}
                      ribbonLayout={'Simplified'}
                      currentUser={user?.displayName || "Guest"}
                      locale="en-US"
                    />
                  </div>
                </CardContent>
              </Card>
          </div>
          <div className="lg:col-span-1 space-y-6">
              {renderSidebarContent()}
          </div>
        </div>
      </div>
    </>
  );
}

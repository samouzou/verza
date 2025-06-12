
"use client";

import { useState } from "react";
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
import { Loader2, Share2, Copy, Check } from "lucide-react";
import { getFunctions, httpsCallableFromURL } from "firebase/functions";
import { functions } from "@/lib/firebase"; // Your initialized firebase functions

interface ShareContractDialogProps {
  contractId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const CREATE_SHAREABLE_CONTRACT_VERSION_FUNCTION_URL = "https://createshareablecontractversion-cpmccwbluq-uc.a.run.app";


export function ShareContractDialog({ contractId, isOpen, onOpenChange }: ShareContractDialogProps) {
  const [notesForBrand, setNotesForBrand] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCreateShareLink = async () => {
    setIsLoading(true);
    setGeneratedLink(null);
    setCopied(false);

    try {
      const firebaseFunctions = getFunctions();
      const createShareableVersion = httpsCallableFromURL(
        firebaseFunctions,
        CREATE_SHAREABLE_CONTRACT_VERSION_FUNCTION_URL
      );
      
      const result = await createShareableVersion({
        contractId: contractId,
        notesForBrand: notesForBrand.trim() || undefined,
      });

      const data = result.data as { sharedVersionId: string; shareLink: string };

      if (data.shareLink) {
        setGeneratedLink(data.shareLink);
        toast({
          title: "Share Link Created!",
          description: "A unique link has been generated for this contract version.",
        });
      } else {
        throw new Error("Share link was not returned from the function.");
      }
    } catch (error: any) {
      console.error("Error creating shareable link:", error);
      toast({
        title: "Error Creating Link",
        description: error.message || "Could not generate a shareable link. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyToClipboard = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink).then(() => {
        setCopied(true);
        toast({ title: "Copied!", description: "Share link copied to clipboard." });
        setTimeout(() => setCopied(false), 2000);
      }).catch(err => {
        console.error("Failed to copy link: ", err);
        toast({ title: "Copy Failed", description: "Could not copy link to clipboard.", variant: "destructive" });
      });
    }
  };

  const resetAndClose = () => {
    setNotesForBrand("");
    setGeneratedLink(null);
    setCopied(false);
    setIsLoading(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); else onOpenChange(true);}}>
      <DialogTrigger asChild>
        <Button variant="default">
          <Share2 className="mr-2 h-4 w-4" /> Share for Feedback
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Contract Version</DialogTitle>
          <DialogDescription>
            Generate a unique, read-only link to share this version of the contract with the brand for feedback.
          </DialogDescription>
        </DialogHeader>
        
        {!generatedLink ? (
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="notesForBrand">Notes for Brand (Optional)</Label>
              <Textarea
                id="notesForBrand"
                value={notesForBrand}
                onChange={(e) => setNotesForBrand(e.target.value)}
                placeholder="e.g., Please review Section 3 regarding usage rights."
                className="mt-1"
                rows={3}
                disabled={isLoading}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Your shareable link is ready:</p>
            <div className="flex items-center space-x-2">
              <Input
                id="shareLinkInput"
                value={generatedLink}
                readOnly
                className="flex-1"
              />
              <Button type="button" size="icon" onClick={handleCopyToClipboard} variant="outline" disabled={copied}>
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
             <p className="text-xs text-muted-foreground">
              Anyone with this link can view this version of the contract. You can revoke access later if needed.
            </p>
          </div>
        )}

        <DialogFooter className="mt-2">
          {!generatedLink ? (
            <Button onClick={handleCreateShareLink} disabled={isLoading} type="button">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
              Create Share Link
            </Button>
          ) : (
            <Button onClick={resetAndClose} variant="outline" type="button">
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

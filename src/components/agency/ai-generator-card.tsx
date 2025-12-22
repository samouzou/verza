
"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateTalentContract } from '@/ai/flows/generate-talent-contract-flow';
import type { Agency, Talent } from '@/types';
import { UploadContractDialog } from '@/components/contracts/upload-contract-dialog';

interface AIGeneratorCardProps {
  agency: Agency;
  disabled: boolean;
}

export function AIGeneratorCard({ agency, disabled }: AIGeneratorCardProps) {
  const { toast } = useToast();
  const [aiContractPrompt, setAiContractPrompt] = useState("");
  const [aiContractTalentId, setAiContractTalentId] = useState("");
  const [isGeneratingContract, setIsGeneratingContract] = useState(false);
  const [generatedContractData, setGeneratedContractData] = useState<{ sfdt: string; talent: Talent } | null>(null);
  const [isContractDialogOpen, setIsContractDialogOpen] = useState(false);

  const handleGenerateContract = async () => {
    const selectedTalent = agency.talent.find(t => t.userId === aiContractTalentId);
    if (!aiContractPrompt.trim() || !selectedTalent) {
        toast({ title: "Missing Information", description: "Please provide a prompt and select a talent.", variant: "destructive" });
        return;
    }
    setIsGeneratingContract(true);
    try {
        const result = await generateTalentContract({
            prompt: aiContractPrompt,
            agencyName: agency.name,
            talentName: selectedTalent.displayName || 'The Talent',
        });
        setGeneratedContractData({ sfdt: result.contractSfdt, talent: selectedTalent });
        setIsContractDialogOpen(true);
        toast({ title: "Contract Generated", description: "Review and save the AI-generated contract." });
    } catch (error: any) {
        console.error("Error generating AI contract:", error);
        toast({ title: "Generation Failed", description: error.message || "Could not generate the contract.", variant: "destructive" });
    } finally {
        setIsGeneratingContract(false);
    }
  };

  return (
    <>
      <Card id="ai-contract-generator-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="text-primary"/> AI Talent Contract Generator</CardTitle>
          <CardDescription>Generate a standardized talent management agreement using AI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="ai-contract-prompt">Contract Prompt</Label>
            <Textarea 
              id="ai-contract-prompt"
              value={aiContractPrompt}
              onChange={(e) => setAiContractPrompt(e.target.value)}
              placeholder="e.g., Draft a 1-year exclusive management contract with a 20% commission on all brand deals."
              rows={3}
              disabled={isGeneratingContract || disabled}
            />
          </div>
          <div>
            <Label htmlFor="ai-contract-talent">For Talent</Label>
            <Select value={aiContractTalentId} onValueChange={setAiContractTalentId} disabled={isGeneratingContract || disabled}>
              <SelectTrigger id="ai-contract-talent"><SelectValue placeholder="Select a talent..." /></SelectTrigger>
              <SelectContent>
                {agency.talent.filter(t => t.status === 'active').map(t => (
                  <SelectItem key={t.userId} value={t.userId}>{t.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleGenerateContract} disabled={isGeneratingContract || !aiContractPrompt || !aiContractTalentId || disabled}>
            {isGeneratingContract ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate Contract
          </Button>
        </CardContent>
      </Card>
      
      {generatedContractData && (
        <UploadContractDialog 
          isOpen={isContractDialogOpen} 
          onOpenChange={setIsContractDialogOpen}
          initialSFDT={generatedContractData.sfdt}
          initialSelectedOwner={generatedContractData.talent.userId}
          initialFileName={`Talent Agreement - ${generatedContractData.talent.displayName}.docx`}
        />
      )}
    </>
  );
}

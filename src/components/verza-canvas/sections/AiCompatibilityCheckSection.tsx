"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2 } from "lucide-react";
import { resolveCompatibilityIssues, type ResolveCompatibilityIssuesInput, type ResolveCompatibilityIssuesOutput } from '@/ai/flows/resolve-compatibility-issues';
import { AiResponseDisplay } from '@/components/verza-canvas/AiResponseDisplay';
import { useToast } from '@/hooks/use-toast';

const defaultVerzaConfig = `{
  "projectName": "Verza E-commerce",
  "version": "1.2.0",
  "firebaseConfig": {
    "apiKey": "VERZA_API_KEY",
    "authDomain": "verza-project.firebaseapp.com",
    "projectId": "verza-project"
  },
  "dependencies": {
    "next": "^13.0.0",
    "firebase": "^9.0.0"
  },
  "customComponents": ["ProductCard_v1", "CheckoutForm_v2"]
}`;

const defaultWorkspaceConfig = `{
  "workspaceName": "Verza Canvas Prototyping",
  "supportedFrameworks": ["Next.js"],
  "nodeVersion": "18.x",
  "firebaseSDKVersion": "^10.0.0",
  "globalStyles": "Tailwind CSS v3.3"
}`;

export function AiCompatibilityCheckSection() {
  const [verzaConfig, setVerzaConfig] = useState(defaultVerzaConfig);
  const [workspaceConfig, setWorkspaceConfig] = useState(defaultWorkspaceConfig);
  const [knownIssues, setKnownIssues] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<ResolveCompatibilityIssuesOutput | null>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setReport(null);

    const input: ResolveCompatibilityIssuesInput = {
      verzaProjectConfig: verzaConfig,
      workspaceConfig: workspaceConfig,
      knownIssues: knownIssues || undefined,
    };

    try {
      const result = await resolveCompatibilityIssues(input);
      setReport(result);
      toast({
        title: "Compatibility Check Complete",
        description: "AI has analyzed the configurations for compatibility issues.",
      });
    } catch (error) {
      console.error("Error resolving compatibility issues:", error);
       toast({
        title: "Error",
        description: "Failed to run compatibility check. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-2 md:p-0">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl flex items-center">
            <ShieldCheck className="mr-2 h-6 w-6 text-primary" />
            AI Compatibility Check Tool
          </CardTitle>
          <CardDescription>
            Provide project and workspace configurations to identify potential compatibility issues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="verzaConfig">Verza Project Configuration</Label>
              <Textarea
                id="verzaConfig"
                value={verzaConfig}
                onChange={(e) => setVerzaConfig(e.target.value)}
                placeholder="Paste Verza project configuration JSON here..."
                rows={8}
                required
                className="font-code"
              />
            </div>
            <div>
              <Label htmlFor="workspaceConfig">Prototyping Workspace Configuration</Label>
              <Textarea
                id="workspaceConfig"
                value={workspaceConfig}
                onChange={(e) => setWorkspaceConfig(e.target.value)}
                placeholder="Paste workspace configuration JSON here..."
                rows={8}
                required
                className="font-code"
              />
            </div>
            <div>
              <Label htmlFor="knownIssues">Known Issues (Optional)</Label>
              <Textarea
                id="knownIssues"
                value={knownIssues}
                onChange={(e) => setKnownIssues(e.target.value)}
                placeholder="Describe any known compatibility issues or concerns."
                rows={3}
              />
            </div>
            <Button type="submit" disabled={isLoading} className="w-full md:w-auto bg-primary hover:bg-primary/90">
              {isLoading ? (
                 <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-5 w-5" />
              )}
              {isLoading ? 'Analyzing...' : 'Check Compatibility'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {(isLoading || report) && (
        <div className="animate-in fade-in-50 duration-500">
          <AiResponseDisplay
            title="Compatibility Report"
            isLoading={isLoading && !report}
            details={report ? {
              "Identified Issues": report.identifiedIssues,
              "Suggested Solutions": report.suggestedSolutions,
            } : undefined}
            summary={report?.summary}
          />
        </div>
      )}
    </div>
  );
}

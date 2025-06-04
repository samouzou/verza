"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadCloud, CheckCircle, Loader2 } from "lucide-react";
import { generateProjectSummary, type GenerateProjectSummaryOutput } from '@/ai/flows/generate-project-summary';
import { AiResponseDisplay } from '@/components/verza-canvas/AiResponseDisplay';
import { useToast } from '@/hooks/use-toast';

export function ProjectImportSection() {
  const [isImporting, setIsImporting] = useState(false);
  const [isImported, setIsImported] = useState(false);
  const [projectSummary, setProjectSummary] = useState<GenerateProjectSummaryOutput | null>(null);
  const { toast } = useToast();

  const handleImportProject = async () => {
    setIsImporting(true);
    setProjectSummary(null); // Clear previous summary

    // Simulate project import delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      // Placeholder project description for AI summary generation
      const placeholderProjectDescription = `
        Verza is a Firebase Studio project aimed at creating a dynamic e-commerce platform.
        Key features include user authentication, product catalog, shopping cart, and order management.
        The architecture relies on Firebase Firestore for data storage, Firebase Authentication for user management,
        and Cloud Functions for backend logic. Frontend is built with Next.js and Tailwind CSS.
        Dependencies include 'firebase', 'next', 'react', 'tailwindcss', and 'lucide-react'.
      `;
      
      const summaryOutput = await generateProjectSummary({ projectDescription: placeholderProjectDescription });
      setProjectSummary(summaryOutput);
      setIsImported(true);
      toast({
        title: "Project Imported Successfully",
        description: "Verza project summary has been generated.",
        variant: "default",
      });
    } catch (error) {
      console.error("Error generating project summary:", error);
      toast({
        title: "Import Failed",
        description: "Could not generate project summary. Please try again.",
        variant: "destructive",
      });
      setIsImported(false);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6 p-2 md:p-0">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">Import Verza Project</CardTitle>
          <CardDescription>
            Import your existing Verza project from Firebase Studio to begin prototyping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isImported && (
            <Button onClick={handleImportProject} disabled={isImporting} size="lg" className="w-full md:w-auto bg-primary hover:bg-primary/90">
              {isImporting ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <UploadCloud className="mr-2 h-5 w-5" />
              )}
              {isImporting ? 'Importing Project...' : 'Import Verza Project'}
            </Button>
          )}
          {isImported && !isImporting && (
            <div className="flex items-center text-green-600 p-4 bg-green-50 border border-green-200 rounded-md">
              <CheckCircle className="mr-2 h-6 w-6" />
              <p className="font-medium">Project imported successfully! Summary below.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {isImporting && !projectSummary && (
         <AiResponseDisplay 
          title="Project Summary"
          description="Generating summary for the imported Verza project..."
          isLoading={true}
        />
      )}

      {projectSummary && (
        <div className="animate-in fade-in-50 duration-500">
          <AiResponseDisplay 
            title="Project Summary"
            description="Overview of the imported Verza project."
            summary={projectSummary.summary}
          />
        </div>
      )}
    </div>
  );
}

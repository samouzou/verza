"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BotMessageSquare, Loader2 } from "lucide-react";
import { generateCodeSnippets, type GenerateCodeSnippetsInput, type GenerateCodeSnippetsOutput } from '@/ai/flows/generate-code-snippets';
import { AiResponseDisplay } from '@/components/verza-canvas/AiResponseDisplay';
import { useToast } from '@/hooks/use-toast';

export function AiCodeGenerationSection() {
  const [taskDescription, setTaskDescription] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<GenerateCodeSnippetsOutput | null>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setGeneratedCode(null);

    const input: GenerateCodeSnippetsInput = {
      projectContext: "Verza E-commerce Platform (Next.js, Firebase, Tailwind CSS)", // Placeholder
      taskDescription,
      userPrompt,
    };

    try {
      const result = await generateCodeSnippets(input);
      setGeneratedCode(result);
      toast({
        title: "Code Snippet Generated",
        description: "AI has generated a code snippet based on your prompt.",
      });
    } catch (error) {
      console.error("Error generating code snippets:", error);
      toast({
        title: "Error",
        description: "Failed to generate code snippet. Please try again.",
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
            <BotMessageSquare className="mr-2 h-6 w-6 text-primary" />
            AI Code Snippet Generator
          </CardTitle>
          <CardDescription>
            Describe your task and get AI-generated code snippets relevant to your Verza project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="taskDescription">Task Description</Label>
              <Input
                id="taskDescription"
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="e.g., Implement a product review component"
                required
              />
            </div>
            <div>
              <Label htmlFor="userPrompt">User Prompt for Code</Label>
              <Textarea
                id="userPrompt"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="e.g., Generate a React component for displaying product stars and a submit button."
                rows={4}
                required
                className="font-code"
              />
            </div>
            <Button type="submit" disabled={isLoading} className="w-full md:w-auto bg-primary hover:bg-primary/90">
              {isLoading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <BotMessageSquare className="mr-2 h-5 w-5" />
              )}
              {isLoading ? 'Generating...' : 'Generate Code Snippet'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {(isLoading || generatedCode) && (
        <div className="animate-in fade-in-50 duration-500">
          <AiResponseDisplay 
            title="Generated Code"
            isLoading={isLoading && !generatedCode}
            codeSnippet={generatedCode?.codeSnippet}
            explanation={generatedCode?.explanation}
          />
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Lightbulb, Loader2 } from "lucide-react";
import { suggestUIImprovements, type SuggestUIImprovementsInput, type SuggestUIImprovementsOutput } from '@/ai/flows/suggest-ui-improvements';
import { AiResponseDisplay } from '@/components/verza-canvas/AiResponseDisplay';
import { useToast } from '@/hooks/use-toast';

export function AiUiSuggestionsSection() {
  const [currentUIDesign, setCurrentUIDesign] = useState('');
  const [userFeedback, setUserFeedback] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestUIImprovementsOutput | null>(null);
  const { toast } = useToast();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setSuggestions(null);

    const input: SuggestUIImprovementsInput = {
      projectDescription: "Verza E-commerce Platform: Focus on clean, modern user experience for online shopping.", // Placeholder
      currentUIDesign: currentUIDesign || "Standard e-commerce layout: Header with navigation, product grid, item details page, cart, checkout flow. Using deep blue primary, light gray background, and vibrant purple accents.", // Default if empty
      userFeedback: userFeedback || undefined,
    };

    try {
      const result = await suggestUIImprovements(input);
      setSuggestions(result);
      toast({
        title: "UI Suggestions Generated",
        description: "AI has provided UI improvement suggestions.",
      });
    } catch (error) {
      console.error("Error suggesting UI improvements:", error);
      toast({
        title: "Error",
        description: "Failed to generate UI suggestions. Please try again.",
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
            <Lightbulb className="mr-2 h-6 w-6 text-primary" />
            AI UI Improvement Suggester
          </CardTitle>
          <CardDescription>
            Describe your current UI or provide feedback to get AI-powered improvement suggestions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="currentUIDesign">Current UI Design Description (Optional)</Label>
              <Textarea
                id="currentUIDesign"
                value={currentUIDesign}
                onChange={(e) => setCurrentUIDesign(e.target.value)}
                placeholder="Describe your current UI layout, color scheme, key components, etc. (Defaults to project theme if left blank)"
                rows={4}
              />
            </div>
            <div>
              <Label htmlFor="userFeedback">User Feedback / Pain Points (Optional)</Label>
              <Textarea
                id="userFeedback"
                value={userFeedback}
                onChange={(e) => setUserFeedback(e.target.value)}
                placeholder="e.g., Users find the checkout process confusing."
                rows={3}
              />
            </div>
            <Button type="submit" disabled={isLoading} className="w-full md:w-auto bg-primary hover:bg-primary/90">
              {isLoading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Lightbulb className="mr-2 h-5 w-5" />
              )}
              {isLoading ? 'Generating...' : 'Get UI Suggestions'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {(isLoading || suggestions) && (
         <div className="animate-in fade-in-50 duration-500">
          <AiResponseDisplay 
            title="UI Improvement Suggestions"
            isLoading={isLoading && !suggestions}
            details={suggestions ? {
              "Suggested Improvements": suggestions.suggestedImprovements,
              "Rationale": suggestions.rationale,
            } : undefined}
          />
        </div>
      )}
    </div>
  );
}

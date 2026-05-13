"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Target, Rocket, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { CreatorCareerGuide } from "@/components/onboarding/creator-career-guide";
import { Badge } from "@/components/ui/badge";

export function CareerPathCard() {
  const { user } = useAuth();
  const [showGuide, setShowGuide] = useState(false);

  if (!user || (user.role !== 'individual_creator' && user.role !== 'talent')) {
    return null;
  }

  const currentPath = user.careerPathResult;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Zap className="h-5 w-5 text-indigo-600" />
                Creator Career Path
              </CardTitle>
              <CardDescription>
                Redefine your journey and explore tools tailored to your current stage.
              </CardDescription>
            </div>
            {currentPath && (
              <Badge variant="secondary" className="px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 border-indigo-200">
                {currentPath === 'monetized' ? (
                  <div className="flex items-center gap-1.5">
                    <Target className="h-3 w-3" />
                    Deal Hunter
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Rocket className="h-3 w-3" />
                    Content Architect
                  </div>
                )}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-center gap-6 p-6 rounded-2xl bg-muted/30 border">
            <div className="flex-1 space-y-2">
              <h4 className="font-bold text-lg">Want to change your focus?</h4>
              <p className="text-sm text-muted-foreground">
                Whether you're shifting from audience growth to brand monetization, or back to building, 
                re-running the guide will help you find the right tools.
              </p>
            </div>
            <Button 
              className="w-full md:w-auto h-12 px-8 rounded-xl font-bold group" 
              onClick={() => setShowGuide(true)}
            >
              Redefine My Path
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {showGuide && (
        <CreatorCareerGuide onClose={() => setShowGuide(false)} />
      )}
    </>
  );
}

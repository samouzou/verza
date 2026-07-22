"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Target, Rocket, ArrowRight, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { CreatorCareerGuide } from "@/components/onboarding/creator-career-guide";
import { Badge } from "@/components/ui/badge";
import type { UserProfile } from "@/hooks/use-auth";

function pathBadge(path: UserProfile['careerPathResult']) {
  if (path === 'monetized') {
    return (
      <div className="flex items-center gap-1.5">
        <Target className="h-3 w-3" />
        Deal Hunter
      </div>
    );
  }
  if (path === 'community') {
    return (
      <div className="flex items-center gap-1.5">
        <Users className="h-3 w-3" />
        Community Builder
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Rocket className="h-3 w-3" />
      Content Architect
    </div>
  );
}

export function CareerPathCard() {
  const { user } = useAuth();
  const [showGuide, setShowGuide] = useState(false);

  if (!user || (user.role !== 'individual_creator' && user.role !== 'talent')) {
    return null;
  }

  const currentPath = user.careerPathResult;
  const badgeClass =
    currentPath === 'community'
      ? "bg-violet-600/10 text-violet-600 border-violet-300"
      : "bg-emerald-600/10 text-emerald-600 border-emerald-300";

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Zap className="h-5 w-5 text-emerald-600" />
                Creator Career Path
              </CardTitle>
              <CardDescription>
                Redefine your journey and explore tools tailored to your current stage.
              </CardDescription>
            </div>
            {currentPath && (
              <Badge variant="secondary" className={`px-3 py-1 rounded-full ${badgeClass}`}>
                {pathBadge(currentPath)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-center gap-6 p-6 rounded-2xl bg-muted/30 border">
            <div className="flex-1 space-y-2">
              <h4 className="font-bold text-lg">Want to change your focus?</h4>
              <p className="text-sm text-muted-foreground">
                Sell tips, courses, and downloads to your community, hunt brand deals, or grow your audience —
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

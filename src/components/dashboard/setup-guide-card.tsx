
"use client";

import { useSetupSteps, type Step } from "@/components/layout/setup-guide";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, Rocket, CheckCircle, Circle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function SetupGuideCard() {
  const { steps, isLoading, completedStepsCount, totalSteps } = useSetupSteps();
  const progressPercentage = totalSteps > 0 ? (completedStepsCount / totalSteps) * 100 : 0;

  if (!isLoading && progressPercentage === 100) {
    return null; // Hide the component if all steps are completed
  }

  return (
    <Card className="mb-6 shadow-lg border-primary/20 bg-gradient-to-br from-primary/10 to-background">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Rocket className="h-6 w-6 text-primary" />
              Get Started with Verza
            </CardTitle>
            <CardDescription>Follow these steps to get your account fully set up.</CardDescription>
          </div>
          <div className="text-right">
             <p className="font-bold text-xl">{Math.round(progressPercentage)}%</p>
             <p className="text-xs text-muted-foreground">{completedStepsCount} of {totalSteps} completed</p>
          </div>
        </div>
        <Progress value={progressPercentage} className="w-full mt-2 h-2" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map(step => (
              <Link key={step.id} href={step.href} className="block group">
                <div className={cn(
                  "h-full p-4 rounded-lg border-2 transition-all flex flex-col items-start gap-2 text-left",
                  step.isCompleted 
                    ? "border-green-500/50 bg-green-500/10" 
                    : "border-border hover:border-primary/80 hover:bg-primary/5"
                )}>
                  <div className="flex justify-between w-full">
                    <step.icon className={cn(
                      "h-6 w-6 mb-2",
                      step.isCompleted ? "text-green-500" : "text-muted-foreground group-hover:text-primary"
                    )} />
                    {step.isCompleted ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary" />
                    )}
                  </div>
                  <p className={cn(
                    "font-semibold",
                    step.isCompleted ? "text-green-800 dark:text-green-300" : "text-foreground"
                  )}>{step.label}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, getDocs, limit } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Circle, FileText, Banknote, DollarSign, Loader2, Send, Rocket } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import Link from 'next/link';
import { cn } from "@/lib/utils";

export interface Step {
  id: string;
  label: string;
  isCompleted: boolean;
  href: string;
  icon: React.ElementType;
}

export function useSetupSteps() {
  const { user } = useAuth();
  const [steps, setSteps] = useState<Step[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [completedStepsCount, setCompletedStepsCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    const checkStatuses = async () => {
      setIsLoading(true);
      try {
        const contractsCol = collection(db, 'contracts');
        
        const createdQuery = query(contractsCol, where('userId', '==', user.uid), limit(1));
        const sentQuery = query(contractsCol, where('userId', '==', user.uid), where('invoiceStatus', 'in', ['sent', 'viewed', 'paid']), limit(1));
        const paidQuery = query(contractsCol, where('userId', '==', user.uid), where('invoiceStatus', '==', 'paid'), limit(1));

        const [createdSnapshot, sentSnapshot, paidSnapshot] = await Promise.all([
          getDocs(createdQuery),
          getDocs(sentQuery),
          getDocs(paidQuery),
        ]);

        const definedSteps: Step[] = [
          { id: 'stripe', label: 'Connect Stripe for payouts', isCompleted: user.stripePayoutsEnabled || false, href: '/settings', icon: Banknote },
          { id: 'contract', label: 'Create your first contract', isCompleted: !createdSnapshot.empty, href: '/contracts', icon: FileText },
          { id: 'invoice', label: 'Send your first invoice', isCompleted: !sentSnapshot.empty, href: '/contracts', icon: Send },
          { id: 'payment', label: 'Receive your first payment', isCompleted: !paidSnapshot.empty, href: '/dashboard', icon: DollarSign },
        ];
        
        setSteps(definedSteps);
        setCompletedStepsCount(definedSteps.filter(s => s.isCompleted).length);

      } catch (error) {
        console.error("Error checking contract statuses:", error);
        setSteps([]);
        setCompletedStepsCount(0);
      } finally {
        setIsLoading(false);
      }
    };

    checkStatuses();
  }, [user]);

  return { steps, isLoading, completedStepsCount, totalSteps: 4 };
}


export function SetupGuide() {
  const { open } = useSidebar();
  const { steps, isLoading, completedStepsCount, totalSteps } = useSetupSteps();

  const progressPercentage = totalSteps > 0 ? (completedStepsCount / totalSteps) * 100 : 0;

  if (progressPercentage === 100 && !isLoading) {
    return null; // Hide the component if all steps are completed
  }
  
  if (open) { // Expanded view in sidebar
    return (
      <Card className="mx-2 my-2 bg-sidebar-accent/50 border-sidebar-border shadow-inner">
        <CardHeader className="p-3">
          <CardTitle className="text-sm font-semibold">Setup Guide</CardTitle>
          <div className="flex items-center gap-2 pt-1">
            <Progress value={progressPercentage} className="h-2 w-full" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">{completedStepsCount} / {totalSteps}</span>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0 text-sm">
          {isLoading ? (
            <div className="flex justify-center items-center h-16">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <ul className="space-y-2">
              {steps.map(step => (
                <li key={step.id}>
                  <Link href={step.href} className="flex items-center gap-2 p-1 rounded-md hover:bg-sidebar-accent transition-colors">
                    {step.isCompleted ? (
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className={cn('transition-colors', step.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground')}>
                      {step.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  // Collapsed view in sidebar
  return (
    <div className="mx-auto my-2 p-2">
       <Progress value={progressPercentage} className="h-1.5 w-8 mx-auto" />
       <p className="text-xs text-muted-foreground text-center mt-1">{completedStepsCount}/{totalSteps}</p>
    </div>
  );
}


"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, getDocs, limit } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Circle, FileText, Banknote, DollarSign, Loader2, Send } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import Link from 'next/link';

interface Step {
  id: string;
  label: string;
  isCompleted: boolean;
  href: string;
  icon: React.ElementType;
}

export function SetupGuide() {
  const { user } = useAuth();
  const { open } = useSidebar();
  const [hasCreatedContract, setHasCreatedContract] = useState(false);
  const [hasSentInvoice, setHasSentInvoice] = useState(false);
  const [hasPaidContract, setHasPaidContract] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    const checkStatuses = async () => {
      setIsLoading(true);
      try {
        const contractsCol = collection(db, 'contracts');
        
        // Query 1: Check for any contract created by the user
        const createdQuery = query(
          contractsCol,
          where('userId', '==', user.uid),
          limit(1)
        );

        // Query 2: Check for any invoice sent by the user
        const sentQuery = query(
          contractsCol,
          where('userId', '==', user.uid),
          where('invoiceStatus', 'in', ['sent', 'viewed', 'paid']),
          limit(1)
        );
        
        // Query 3: Check for any paid contract
        const paidQuery = query(
          contractsCol,
          where('userId', '==', user.uid),
          where('invoiceStatus', '==', 'paid'),
          limit(1)
        );

        const [createdSnapshot, sentSnapshot, paidSnapshot] = await Promise.all([
          getDocs(createdQuery),
          getDocs(sentQuery),
          getDocs(paidQuery),
        ]);

        setHasCreatedContract(!createdSnapshot.empty);
        setHasSentInvoice(!sentSnapshot.empty);
        setHasPaidContract(!paidSnapshot.empty);
        
      } catch (error) {
        console.error("Error checking contract statuses:", error);
        // Reset on error
        setHasCreatedContract(false);
        setHasSentInvoice(false);
        setHasPaidContract(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkStatuses();
  }, [user]);

  const isStripeConnected = user?.stripePayoutsEnabled || false;

  const steps: Step[] = [
    {
      id: 'stripe',
      label: 'Connect Stripe for payouts',
      isCompleted: isStripeConnected,
      href: '/settings',
      icon: Banknote
    },
    {
      id: 'contract',
      label: 'Create your first contract',
      isCompleted: hasCreatedContract,
      href: '/contracts',
      icon: FileText
    },
    {
      id: 'invoice',
      label: 'Send your first invoice',
      isCompleted: hasSentInvoice,
      href: '/contracts',
      icon: Send
    },
    {
      id: 'payment',
      label: 'Receive your first payment',
      isCompleted: hasPaidContract,
      href: '/dashboard',
      icon: DollarSign
    },
  ];

  const completedSteps = steps.filter(step => step.isCompleted).length;
  const progressPercentage = (completedSteps / steps.length) * 100;

  if (progressPercentage === 100) {
    return null; // Hide the component if all steps are completed
  }
  
  if (open) { // Expanded view
    return (
      <Card className="mx-2 my-2 bg-sidebar-accent/50 border-sidebar-border shadow-inner">
        <CardHeader className="p-3">
          <CardTitle className="text-sm font-semibold">Setup Guide</CardTitle>
          <div className="flex items-center gap-2 pt-1">
            <Progress value={progressPercentage} className="h-2 w-full" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">{completedSteps} / {steps.length}</span>
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

  // Collapsed view
  return (
    <div className="mx-auto my-2 p-2">
       <Progress value={progressPercentage} className="h-1.5 w-8 mx-auto" />
       <p className="text-xs text-muted-foreground text-center mt-1">{completedSteps}/{steps.length}</p>
    </div>
  );
}

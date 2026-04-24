
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, getDocs, limit } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle, 
  Circle, 
  Banknote, 
  DollarSign, 
  Loader2, 
  PlusCircle, 
  UserCircle, 
  Sparkles,
  Building,
  Users
} from "lucide-react";
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
  const { user, isAgency } = useAuth();
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
        if (isAgency) {
          // --- AGENCY FLOW CHECKS ---
          const isProfileComplete = !!user.displayName && !!user.companyLogoUrl && !!user.address;
          
          let hasTalent = false;
          if (user.primaryAgencyId) {
            const agencyDocSnap = await getDocs(query(collection(db, 'agencies'), where('id', '==', user.primaryAgencyId), limit(1)));
            if (!agencyDocSnap.empty) {
              const data = agencyDocSnap.docs[0].data();
              hasTalent = data.talent && data.talent.length > 0;
            }
          }

          const gigQuery = user.primaryAgencyId ? query(
            collection(db, 'gigs'),
            where('brandId', '==', user.primaryAgencyId),
            limit(1)
          ) : null;
          const gigSnapshot = gigQuery ? await getDocs(gigQuery) : null;

          const definedSteps: Step[] = [
            { id: 'profile', label: 'Complete agency profile', isCompleted: isProfileComplete, href: '/profile', icon: Building },
            { id: 'talent', label: 'Invite your first talent', isCompleted: hasTalent, href: '/agency', icon: Users },
            { id: 'bank', label: 'Connect agency bank account', isCompleted: !!user.stripePayoutsEnabled, href: '/settings', icon: Banknote },
            { id: 'post', label: 'Fund your first campaign', isCompleted: !!(gigSnapshot && !gigSnapshot.empty), href: '/campaigns/post', icon: PlusCircle },
          ];
          setSteps(definedSteps);
          setCompletedStepsCount(definedSteps.filter(s => s.isCompleted).length);
        } else {
          // --- CREATOR FLOW CHECKS ---
          const isProfileComplete = !!user.displayName && user.displayName !== 'New User' && !!user.avatarUrl && !!user.address;
          const isSocialConnected = !!(user.instagramConnected || user.tiktokConnected || user.youtubeConnected);
          
          const payoutQuery = query(
            collection(db, 'submissions'),
            where('creatorId', '==', user.uid),
            where('status', '==', 'approved'),
            limit(1)
          );
          const payoutSnapshot = await getDocs(payoutQuery);

          const definedSteps: Step[] = [
            { id: 'profile', label: 'Complete creator profile', isCompleted: isProfileComplete, href: '/profile', icon: UserCircle },
            { id: 'social', label: 'Verify your social reach', isCompleted: isSocialConnected, href: '/insights', icon: Sparkles },
            { id: 'bank', label: 'Connect bank for payouts', isCompleted: !!user.stripePayoutsEnabled, href: '/settings', icon: Banknote },
            { id: 'payout', label: 'Claim your first campaign', isCompleted: !payoutSnapshot.empty, href: '/campaigns', icon: DollarSign },
          ];
          setSteps(definedSteps);
          setCompletedStepsCount(definedSteps.filter(s => s.isCompleted).length);
        }
      } catch (error) {
        console.error("Error checking setup statuses:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkStatuses();
  }, [user, isAgency]);

  return { steps, isLoading, completedStepsCount, totalSteps: steps.length };
}

export function SetupGuide() {
  const { open } = useSidebar();
  const { steps, isLoading, completedStepsCount, totalSteps } = useSetupSteps();

  const progressPercentage = totalSteps > 0 ? (completedStepsCount / totalSteps) * 100 : 0;

  if (!isLoading && progressPercentage === 100) {
    return null;
  }
  
  if (open) {
    return (
      <Card className="mx-2 my-2 bg-sidebar-accent/50 border-sidebar-border shadow-inner">
        <CardHeader className="p-3">
          <CardTitle className="text-sm font-semibold">Setup Guide</CardTitle>
          <div className="flex items-center gap-2 pt-1">
            <Progress value={progressPercentage} className="h-2 w-full" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {completedStepsCount} / {totalSteps}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0 text-sm">
          {isLoading ? (
            <div className="flex justify-center items-center h-16">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <ul className="space-y-2">
              {steps.map(step => (
                <li key={step.id}>
                  <Link 
                    href={step.href} 
                    className="flex items-center gap-2 p-1 rounded-md hover:bg-sidebar-accent transition-colors"
                  >
                    {step.isCompleted ? (
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className={cn(
                      'transition-colors', 
                      step.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground'
                    )}>
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

  return (
    <div className="mx-auto my-2 p-2">
       <Progress value={progressPercentage} className="h-1.5 w-8 mx-auto" />
       <p className="text-xs text-muted-foreground text-center mt-1">
         {completedStepsCount}/{totalSteps}
       </p>
    </div>
  );
}

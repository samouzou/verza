
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { db, collection, query, where, getDocs, limit } from '@/lib/firebase';
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
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
  Store,
  Users,
  ListChecks,
  Minus,
  X
} from "lucide-react";
import Link from 'next/link';
import { cn } from "@/lib/utils";

const SETUP_GUIDE_COLLAPSED_KEY = "verza.setupGuide.collapsed";

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

          const isBrand = !!user.isBrandAccount;
          const profileLabel = isBrand ? 'Complete brand profile' : 'Complete agency profile';
          const talentLabel = isBrand ? 'Invite your first team member' : 'Invite your first talent';
          const bankLabel = isBrand ? 'Connect brand bank account' : 'Connect agency bank account';

          const definedSteps: Step[] = [
            { id: 'profile', label: profileLabel, isCompleted: isProfileComplete, href: '/agency/brand-guide', icon: isBrand ? Store : Building },
            { id: 'talent', label: talentLabel, isCompleted: hasTalent, href: '/agency', icon: Users },
            { id: 'bank', label: bankLabel, isCompleted: !!user.stripePayoutsEnabled, href: '/settings', icon: Banknote },
            { id: 'post', label: 'Fund your first campaign', isCompleted: !!(gigSnapshot && !gigSnapshot.empty), href: '/campaigns/post', icon: PlusCircle },
          ];
          setSteps(definedSteps);
          setCompletedStepsCount(definedSteps.filter(s => s.isCompleted).length);
        } else {
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
  const { user } = useAuth();
  const { steps, isLoading, completedStepsCount, totalSteps } = useSetupSteps();
  const [collapsed, setCollapsed] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SETUP_GUIDE_COLLAPSED_KEY) !== "false");
    } catch {
      setCollapsed(true);
    }
  }, []);

  const persistCollapsed = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(SETUP_GUIDE_COLLAPSED_KEY, next ? "true" : "false");
    } catch {
      // ignore
    }
  };

  const progressPercentage = totalSteps > 0 ? (completedStepsCount / totalSteps) * 100 : 0;
  const isComplete = !isLoading && totalSteps > 0 && progressPercentage === 100;

  if (!user || dismissed || isComplete || (!isLoading && totalSteps === 0)) {
    return null;
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => persistCollapsed(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 hover:bg-accent transition-colors"
        aria-label="Open setup guide"
      >
        <ListChecks className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Setup</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {isLoading ? "…" : `${completedStepsCount}/${totalSteps}`}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-background/95 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Setup Guide</p>
          <div className="flex items-center gap-2 pt-1">
            <Progress value={isLoading ? 0 : progressPercentage} className="h-2 w-full" />
            <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
              {completedStepsCount} / {totalSteps}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => persistCollapsed(true)} aria-label="Collapse setup guide">
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDismissed(true)} aria-label="Hide setup guide">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="p-3 pt-0 text-sm">
        {isLoading ? (
          <div className="flex justify-center items-center h-16">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <ul className="space-y-1">
            {steps.map(step => (
              <li key={step.id}>
                <Link 
                  href={step.href} 
                  className="flex items-center gap-2 p-1.5 rounded-md hover:bg-accent transition-colors"
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
      </div>
    </div>
  );
}

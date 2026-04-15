
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Building, User, Store, Tv, Instagram, Twitter, Youtube, Users, Search, Mic, Mail, CalendarDays, MessageCircle, HelpCircle } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';

type Role = 'creator' | 'agency' | 'brand';

const referralOptions = [
  { value: 'TikTok', icon: Tv },
  { value: 'Instagram', icon: Instagram },
  { value: 'Twitter / X', icon: Twitter },
  { value: 'YouTube', icon: Youtube },
  { value: 'A friend or colleague', icon: Users },
  { value: 'Google / search', icon: Search },
  { value: 'Podcast', icon: Mic },
  { value: 'Newsletter or email', icon: Mail },
  { value: 'Event or conference', icon: CalendarDays },
  { value: 'The founder reached out', icon: MessageCircle },
  { value: 'Other', icon: HelpCircle },
];

export default function OnboardingPage() {
  const { user, refreshAuthUser } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleRoleSelection = (role: Role) => {
    setSelectedRole(role);
    setStep(2);
  };

  const handleReferralSelection = async (referralSource: string) => {
    if (!user || !selectedRole || isUpdating) return;
    setIsUpdating(true);

    const role = selectedRole === 'creator' ? 'individual_creator' : 'agency_owner';
    const redirectPath = selectedRole === 'creator' ? '/deployments' : '/agency';

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        hasCompletedOnboarding: true,
        role,
        referralSource,
      });

      await refreshAuthUser();
      toast({ title: "Welcome!", description: "Your profile has been updated." });
      router.push(redirectPath);
    } catch (error) {
      console.error("Error updating onboarding status:", error);
      toast({ title: "Error", description: "Could not save your selection. Please try again.", variant: "destructive" });
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
      <div className="mb-8 flex items-center gap-3 text-center">
        <Image src="/verza-icon.svg" alt="Verza Icon" width={48} height={48} />
        <h1 className="text-4xl font-bold">Welcome to Verza</h1>
      </div>

      {step === 1 && (
        <Card className="w-full max-w-4xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">How are you planning to use Verza?</CardTitle>
            <CardDescription>Select your role to personalize your experience.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button onClick={() => handleRoleSelection('agency')} className="group text-left p-0">
              <Card className="h-full hover:border-primary hover:shadow-lg transition-all">
                <CardHeader>
                  <Building className="h-8 w-8 mb-2 text-primary" />
                  <CardTitle>I run an Agency</CardTitle>
                  <CardDescription>I want to manage my roster of talent, facilitate payments, and streamline contracts.</CardDescription>
                </CardHeader>
              </Card>
            </button>
            <button onClick={() => handleRoleSelection('brand')} className="group text-left p-0">
              <Card className="h-full hover:border-primary hover:shadow-lg transition-all">
                <CardHeader>
                  <Store className="h-8 w-8 mb-2 text-primary" />
                  <CardTitle>I'm a Brand</CardTitle>
                  <CardDescription>I want to collaborate with creators and manage influencer marketing campaigns.</CardDescription>
                </CardHeader>
              </Card>
            </button>
            <button onClick={() => handleRoleSelection('creator')} className="group text-left p-0">
              <Card className="h-full hover:border-primary hover:shadow-lg transition-all">
                <CardHeader>
                  <User className="h-8 w-8 mb-2 text-primary" />
                  <CardTitle>I'm a Creator</CardTitle>
                  <CardDescription>I want to use AI tools to create content, manage my own brand deals, and get paid.</CardDescription>
                </CardHeader>
              </Card>
            </button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card className="w-full max-w-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">One last thing</CardTitle>
            <CardDescription>How did you hear about Verza?</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {referralOptions.map(({ value, icon: Icon }) => (
              <button
                key={value}
                onClick={() => handleReferralSelection(value)}
                disabled={isUpdating}
                className="group text-left p-0"
              >
                <Card className="h-full hover:border-primary hover:shadow-lg transition-all">
                  <CardHeader className="p-4">
                    <Icon className="h-5 w-5 mb-1 text-primary" />
                    <CardTitle className="text-sm font-medium leading-snug">{value}</CardTitle>
                  </CardHeader>
                </Card>
              </button>
            ))}
          </CardContent>
          {isUpdating && (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">Setting up your account...</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

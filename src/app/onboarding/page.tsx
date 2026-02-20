
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Building, User, Store } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';

export default function OnboardingPage() {
  const { user, refreshAuthUser } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSelection = async (selection: 'creator' | 'agency' | 'brand') => {
    if (!user || isUpdating) return;
    setIsUpdating(true);

    let role: string;
    let redirectPath: string;

    if (selection === 'creator') {
      role = 'individual_creator';
      redirectPath = '/scene-spawner';
    } else {
      // For both 'agency' and 'brand', we direct to the agency page.
      // We can set the role to 'agency_owner' to prompt them to create one.
      role = 'agency_owner';
      redirectPath = '/agency';
    }
    
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        hasCompletedOnboarding: true,
        role: role,
      });

      // Refresh user context to reflect the change
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
      <Card className="w-full max-w-4xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">How are you planning to use Verza?</CardTitle>
          <CardDescription>Select your role to personalize your experience.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => handleSelection('agency')}
            disabled={isUpdating}
            className="group text-left p-0"
          >
            <Card className="h-full hover:border-primary hover:shadow-lg transition-all">
              <CardHeader>
                <Building className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>I run an Agency</CardTitle>
                <CardDescription>I want to manage my roster of talent, facilitate payments, and streamline contracts.</CardDescription>
              </CardHeader>
            </Card>
          </button>
          <button
            onClick={() => handleSelection('brand')}
            disabled={isUpdating}
            className="group text-left p-0"
          >
            <Card className="h-full hover:border-primary hover:shadow-lg transition-all">
              <CardHeader>
                <Store className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>I'm a Brand</CardTitle>
                <CardDescription>I want to collaborate with creators and manage influencer marketing campaigns.</CardDescription>
              </CardHeader>
            </Card>
          </button>
          <button
            onClick={() => handleSelection('creator')}
            disabled={isUpdating}
            className="group text-left p-0"
          >
            <Card className="h-full hover:border-primary hover:shadow-lg transition-all">
              <CardHeader>
                <User className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>I'm a Creator</CardTitle>
                <CardDescription>I want to manage my own brand deals, get paid, and use AI tools to create content.</CardDescription>
              </CardHeader>
            </Card>
          </button>
        </CardContent>
        {isUpdating && (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">Saving your selection...</p>
          </div>
        )}
      </Card>
    </div>
  );
}
